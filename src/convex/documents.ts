import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
    let allowed = meta.uploadedByUserId === user._id || role === "admin" || role === "red_cross";
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
    await ctx.storage.delete(meta.storageId);
    await ctx.db.delete(meta._id);
    return { ok: true };
  },
});
