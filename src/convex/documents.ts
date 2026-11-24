import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
  audit,
  enforceRateLimit,
  requireRole,
  requireUser,
  roleOf,
} from "./lib/helpers";
import {
  guardianDocumentKindValidator,
  guardianDocumentStatusValidator,
} from "./validators";
import { guardianComplianceIssues } from "../lib/guardian";

const ALLOWED = ["application/pdf", "image/jpeg", "image/png"];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Verify the file's real signature, not just the browser-supplied MIME type.
 * PDF: %PDF, JPEG: FF D8 FF, PNG: 89 50 4E 47 0D 0A 1A 0A.
 */
async function hasValidSignature(blob: Blob, contentType: string): Promise<boolean> {
  const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (contentType === "application/pdf") {
    return (
      header[0] === 0x25 &&
      header[1] === 0x50 &&
      header[2] === 0x44 &&
      header[3] === 0x46
    );
  }
  if (contentType === "image/jpeg") {
    return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (contentType === "image/png") {
    return (
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47 &&
      header[4] === 0x0d &&
      header[5] === 0x0a &&
      header[6] === 0x1a &&
      header[7] === 0x0a
    );
  }
  return false;
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    await enforceRateLimit(ctx, `upload:${user._id}`, 20);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Records metadata only after checking the real uploaded file. */
export const attachDocument = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    purpose: v.optional(
      v.union(v.literal("blood_request"), v.literal("guardian_onboarding")),
    ),
    documentKind: v.optional(guardianDocumentKindValidator),
    expiryDate: v.optional(v.string()),
    ambulanceId: v.optional(v.id("ambulances")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const stored = await ctx.db.system.get(args.storageId);
    if (!stored) throw new Error("The uploaded file could not be found.");
    if (!ALLOWED.includes(args.contentType)) {
      throw new Error("Only PDF, JPEG and PNG documents are accepted.");
    }
    if (args.size <= 0 || args.size > MAX_BYTES) {
      throw new Error("Documents must be under 5 MB.");
    }
    if (stored.size !== args.size) {
      throw new Error("Uploaded file size did not match. Please try again.");
    }

    // Backend-only signature check. Never trust the browser content type alone.
    const blob = await ctx.storage.get(args.storageId);
    if (!blob || !(await hasValidSignature(blob, args.contentType))) {
      throw new Error("The file content does not match its declared PDF/JPEG/PNG type.");
    }

    let expiryDate: string | undefined;
    if (args.expiryDate) {
      const parsed = new Date(args.expiryDate);
      if (Number.isNaN(parsed.getTime())) throw new Error("Document expiry date is invalid.");
      expiryDate = parsed.toISOString().slice(0, 10);
    }

    if (args.ambulanceId) {
      const vehicle = await ctx.db.get(args.ambulanceId);
      if (!vehicle || vehicle.guardianUserId !== user._id) {
        throw new Error("That vehicle does not belong to your account.");
      }
    }
    if (args.purpose === "guardian_onboarding" && !args.documentKind) {
      throw new Error("Choose which onboarding document this file is.");
    }

    await enforceRateLimit(ctx, `doc-meta:${user._id}`, 30);
    const documentId = await ctx.db.insert("documentMetadata", {
      storageId: args.storageId,
      uploadedByUserId: user._id,
      fileName: Array.from(args.fileName)
        .filter((character) => character.charCodeAt(0) >= 32)
        .join("")
        .slice(0, 160),
      contentType: args.contentType,
      size: args.size,
      purpose: args.purpose,
      guardianUserId: args.purpose === "guardian_onboarding" ? user._id : undefined,
      ambulanceId: args.ambulanceId,
      documentKind: args.documentKind,
      expiryDate,
      status: args.purpose === "guardian_onboarding" ? "pending" : undefined,
      scanStatus: "pending",
      scanAttempts: 0,
      createdAt: Date.now(),
    });
    return { documentId };
  },
});

/** Administrators review onboarding documents individually. */
export const reviewDocument = mutation({
  args: {
    documentId: v.id("documentMetadata"),
    status: guardianDocumentStatusValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    const document = await ctx.db.get(args.documentId);
    if (!document) throw new Error("Document not found.");
    if (document.purpose !== "guardian_onboarding") {
      throw new Error("Only Guardian onboarding documents can be reviewed here.");
    }
    if (document.scanStatus !== "clean") {
      throw new Error("This document is quarantined until malware scanning succeeds.");
    }
    if (
      args.status === "approved" &&
      document.expiryDate &&
      document.expiryDate < new Date().toISOString().slice(0, 10)
    ) {
      throw new Error("An expired document cannot be approved. Upload a valid replacement.");
    }
    await ctx.db.patch(document._id, {
      status: args.status,
      reviewNote: args.note?.trim().slice(0, 300),
    });
    await audit(ctx, {
      actor: admin,
      action: `guardian.document_${args.status}`,
      entityType: "documentMetadata",
      entityId: String(document._id),
      detail: `${document.documentKind ?? "document"} marked ${args.status}${
        args.note ? `: ${args.note.slice(0, 200)}` : ""
      }`,
    });

    // A Guardian suspended for expiry becomes eligible again only after an
    // administrator approves a valid replacement and every mandatory record
    // passes the same compliance checks used for going online.
    if (args.status === "approved" && document.guardianUserId) {
      const profile = await ctx.db
        .query("guardianProfiles")
        .withIndex("by_user", (q) => q.eq("userId", document.guardianUserId!))
        .unique();
      if (profile?.status === "EXPIRED") {
        const [vehicles, documents] = await Promise.all([
          ctx.db
            .query("ambulances")
            .withIndex("by_guardian", (q) => q.eq("guardianUserId", document.guardianUserId!))
            .collect(),
          ctx.db
            .query("documentMetadata")
            .withIndex("by_guardian", (q) => q.eq("guardianUserId", document.guardianUserId!))
            .collect(),
        ]);
        const issues = guardianComplianceIssues({
          profile: { ...profile, status: "APPROVED" },
          vehicles: vehicles.map((vehicle) => ({
            id: String(vehicle._id),
            type: vehicle.type,
            insuranceExpiryDate: vehicle.insuranceExpiryDate,
            fitnessExpiryDate: vehicle.fitnessExpiryDate,
            pucExpiryDate: vehicle.pucExpiryDate,
            permitExpiryDate: vehicle.permitExpiryDate,
            ambulanceAuthorizationExpiryDate: vehicle.ambulanceAuthorizationExpiryDate,
          })),
          documents: documents.map((doc) => ({
            documentKind: doc.documentKind,
            expiryDate: doc.expiryDate,
            status: doc.status,
            ambulanceId: doc.ambulanceId ? String(doc.ambulanceId) : null,
          })),
        });
        if (issues.length === 0) {
          await ctx.db.patch(profile._id, {
            status: "APPROVED",
            documentsStatus: "verified",
            online: false,
            reviewNote: "Eligibility restored after an approved replacement document.",
            updatedAt: Date.now(),
          });
          await audit(ctx, {
            actor: admin,
            action: "guardian.eligibility_restored",
            entityType: "guardianProfile",
            entityId: String(profile._id),
            detail:
              "Guardian eligibility restored after an approved replacement document. The account remains offline until it explicitly goes online.",
          });
        }
      }
    }
    return { ok: true };
  },
});

export const getUrl = query({
  args: { documentId: v.id("documentMetadata") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const meta = await ctx.db.get(args.documentId);
    if (!meta) throw new Error("Document not found.");
    const role = roleOf(user);
    // Quarantined or failed documents are never available, even to an admin.
    if (meta.scanStatus !== "clean") {
      throw new Error("This document is quarantined until malware scanning succeeds.");
    }
    let allowed = meta.uploadedByUserId === user._id || role === "admin";
    if (!allowed && meta.requestId) {
      const request = await ctx.db.get(meta.requestId);
      if (
        request &&
        role === "hospital" &&
        user.organizationId &&
        (request.hospitalOrgId === user.organizationId ||
          request.assignedOrgId === user.organizationId)
      ) {
        allowed = true;
      }
    }
    if (!allowed) throw new Error("You are not authorized to open this document.");
    return await ctx.storage.getUrl(meta.storageId);
  },
});

export const remove = mutation({
  args: { documentId: v.id("documentMetadata") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["community", "requestor", "hospital", "donor", "red_cross", "guardian", "admin"]);
    const meta = await ctx.db.get(args.documentId);
    if (!meta) throw new Error("Document not found.");
    if (meta.uploadedByUserId !== user._id) {
      throw new Error("Only the uploader can remove this document.");
    }
    if (meta.requestId) {
      throw new Error("Documents attached to a request cannot be removed.");
    }
    if (
      meta.purpose === "guardian_onboarding" &&
      meta.status &&
      meta.status !== "pending"
    ) {
      throw new Error("Reviewed onboarding documents cannot be deleted; upload a replacement instead.");
    }
    await ctx.storage.delete(meta.storageId);
    await ctx.db.delete(meta._id);
    return { ok: true };
  },
});

/** Server-only scan context. File bytes are never returned by a public query. */
export const getScanContext = internalQuery({
  args: { documentId: v.id("documentMetadata") },
  handler: async (ctx, args) => {
    const meta = await ctx.db.get(args.documentId);
    if (!meta) return null;
    const uploader = await ctx.db.get(meta.uploadedByUserId);
    return {
      id: meta._id,
      uploadedByUserId: meta.uploadedByUserId,
      uploaderRole: uploader?.role ?? "user",
      storageId: meta.storageId,
      fileName: meta.fileName,
      contentType: meta.contentType,
      size: meta.size,
      scanStatus: meta.scanStatus ?? "pending",
      scanAttempts: meta.scanAttempts ?? 0,
    };
  },
});

export const beginScan = internalMutation({
  args: { documentId: v.id("documentMetadata") },
  handler: async (ctx, args) => {
    const meta = await ctx.db.get(args.documentId);
    if (!meta) throw new Error("Document not found.");
    await ctx.db.patch(meta._id, {
      scanStatus: "scanning",
      scanError: undefined,
      scanAttempts: (meta.scanAttempts ?? 0) + 1,
    });
    return { ok: true };
  },
});

export const recordScanResult = internalMutation({
  args: {
    documentId: v.id("documentMetadata"),
    status: v.union(
      v.literal("clean"),
      v.literal("infected"),
      v.literal("error"),
    ),
    engine: v.optional(v.string()),
    signature: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const meta = await ctx.db.get(args.documentId);
    if (!meta) throw new Error("Document not found.");
    await ctx.db.patch(meta._id, {
      scanStatus: args.status,
      scanEngine: args.engine?.slice(0, 80),
      scanSignature: args.signature?.slice(0, 120),
      scanError: args.error?.slice(0, 240),
      scannedAt: Date.now(),
    });
    return { ok: true };
  },
});
