import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  audit,
  getDonorProfile,
  requireOrganization,
  requireRole,
  requireUser,
  roleOf,
  safeError,
  type AppUser,
} from "./lib/helpers";
import {
  medicalDocumentKindValidator,
} from "./validators";

const ALLOWED = ["application/pdf", "image/jpeg", "image/png"];
const MAX_BYTES = 5 * 1024 * 1024;
const DOC_TITLE_MAX = 180;
const DOC_NOTES_MAX = 600;

function requireText(value: string, label: string, min = 2, max = DOC_TITLE_MAX) {
  const trimmed = (value ?? "").trim();
  if (trimmed.length < min) throw new Error(`${label} must be at least ${min} characters.`);
  if (trimmed.length > max) throw new Error(`${label} must be under ${max} characters.`);
  return trimmed;
}

/** Public mutation for recording access events that originate from queries
 * (search and view), since queries cannot write to the database directly.
 * The UI calls this after fetching donor records or performing a search.
 */
export const recordMedicalAccess = mutation({
  args: {
    actorUserId: v.id("users"),
    actorRole: v.string(),
    hospitalOrgId: v.optional(v.id("organizations")),
    donorUserId: v.id("users"),
    donorProfileId: v.optional(v.id("donorProfiles")),
    action: v.union(v.literal("search"), v.literal("view")),
    recordId: v.optional(v.id("documentMetadata")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("medicalRecordAccessLogs", {
      recordId: args.recordId,
      donorUserId: args.donorUserId,
      donorProfileId: args.donorProfileId,
      actorUserId: args.actorUserId,
      actorRole: args.actorRole,
      hospitalOrgId: args.hospitalOrgId,
      action: args.action,
      detail: args.detail,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Hospital-facing: looks up a donor by their permanent LifeLink ID.
 * Returns the donor row plus a hint the UI can pass to recordMedicalAccess
 * so the search is durably logged (queries cannot write directly).
 */
export const lookupDonorByLifeLinkId = query({
  args: { lifeLinkId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["hospital", "red_cross", "admin"]);
    const entry = await ctx.db
      .query("lifeLinkIds")
      .withIndex("by_life_link_id", (q) => q.eq("lifeLinkId", args.lifeLinkId))
      .unique();
    if (!entry) throw safeError("No donor matches that LifeLink ID.");
    const donor = await getDonorProfile(ctx, entry.userId);
    if (!donor) throw safeError("That LifeLink ID is not linked to a donor profile.");
    const canSeeContact = donor.shareContact && roleOf(user) === "red_cross";
    return {
      _id: donor._id,
      donorId: donor.donorId,
      lifeLinkId: entry.lifeLinkId,
      fullName: canSeeContact ? donor.fullName : "Donor (contact protected)",
      bloodGroup: donor.bloodGroup,
      city: donor.city,
      area: donor.area ?? null,
      available: donor.available,
      lastDonationDate: donor.lastDonationDate ?? null,
      preferredCenter: donor.preferredCenter ?? null,
      phone: canSeeContact ? donor.phone : null,
      email: canSeeContact ? donor.email ?? null : null,
      shareContact: donor.shareContact,
      isDemo: donor.isDemo ?? false,
      _accessLogHint: {
        actorUserId: user._id,
        actorRole: roleOf(user),
        hospitalOrgId: user.organizationId as Id<"organizations"> | undefined,
        donorUserId: donor.userId,
        donorProfileId: donor._id,
        lookedUp: args.lifeLinkId,
      },
    };
  },
});

/** Every document the authenticated donor owns, surfaced for their own dashboard.
 * The donor always sees everything they own. Consent filtering is applied by other
 * hospitals (see donorMedicalRecordsForHospital), not here.
 */
export const myMedicalRecords = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) return { records: [], lifeLinkId: null };

    const idEntry = await ctx.db
      .query("lifeLinkIds")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    const records = await ctx.db
      .query("documentMetadata")
      .withIndex("by_donor", (q) => q.eq("donorUserId", donor.userId))
      .filter((q) => q.eq(q.field("purpose"), "donor_medical_record"))
      .collect();

    const orgById = new Map((await ctx.db.query("organizations").collect()).map((o) => [o._id, o]));

    return {
      lifeLinkId: idEntry?.lifeLinkId ?? donor.donorId,
      records: records
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .map((r) => {
          const uploaderOrg = r.uploadedByUserId ? orgById.get(r.uploadedByUserId) : null;
          return {
            _id: r._id,
            documentId: r._id,
            fileName: r.fileName,
            contentType: r.contentType,
            size: r.size,
            documentKind: r.documentKind ?? "other_medical",
            title: r.fileName,
            documentDate: r.expiryDate ?? null,
            uploadedAt: r.createdAt,
            scanStatus: r.scanStatus ?? "pending",
            status: r.scanStatus === "clean" ? "available" :
                    r.scanStatus === "infected" ? "quarantined" : "pending_scan",
            uploadedBy: uploaderOrg?.name ?? "A LifeLink hospital",
            hospitalOrgId: uploaderOrg ? String(uploaderOrg._id) : null,
            hospitalOrgName: uploaderOrg?.name ?? null,
            canDownload: r.scanStatus === "clean",
          };
        }),
      total: records.length,
    };
  },
});

/** Hospitals upload a medical document linked to a specific donor LifeLink ID. */
export const uploadDonorMedicalRecord = mutation({
  args: {
    lifeLinkId: v.string(),
    title: v.optional(v.string()),
    documentKind: medicalDocumentKindValidator,
    documentDate: v.optional(v.string()),
    doctorName: v.optional(v.string()),
    notes: v.optional(v.string()),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["hospital", "red_cross", "admin"]);
    const org = await requireOrganization(ctx, user, ["hospital", "red_cross", "blood_bank"]);
    const donorEntry = await ctx.db
      .query("lifeLinkIds")
      .withIndex("by_life_link_id", (q) => q.eq("lifeLinkId", args.lifeLinkId))
      .unique();
    if (!donorEntry) throw safeError("No donor matches that LifeLink ID.");
    const donor = await getDonorProfile(ctx, donorEntry.userId);
    if (!donor) throw safeError("That LifeLink ID is not linked to a donor profile.");

    if (!ALLOWED.includes(args.contentType)) throw new Error("Only PDF, JPEG and PNG documents are accepted.");
    if (args.size <= 0 || args.size > MAX_BYTES) throw new Error("Documents must be under 5 MB.");

    const title = requireText(args.title ?? args.fileName, "Document title", 2, DOC_TITLE_MAX);
    const notes = args.notes ? requireText(args.notes, "Notes", 0, DOC_NOTES_MAX) : undefined;
    const documentDate = args.documentDate ? requireText(args.documentDate, "Document date", 4, 10) : undefined;
    const doctorName = args.doctorName ? requireText(args.doctorName, "Doctor name", 0, 120) : undefined;

    const now = Date.now();
    const documentId = await ctx.db.insert("documentMetadata", {
      storageId: args.storageId,
      uploadedByUserId: user._id,
      fileName: Array.from(args.fileName).filter((c) => c.charCodeAt(0) >= 32).join("").slice(0, 160),
      contentType: args.contentType,
      size: args.size,
      purpose: "donor_medical_record",
      donorUserId: donor.userId,
      documentKind: args.documentKind,
      expiryDate: documentDate,
      doctorName: doctorName,
      notes: notes,
      scanStatus: "pending",
      scanAttempts: 0,
      createdAt: now,
    });

    await audit(ctx, {
      actor: user,
      action: "medical_record.upload",
      entityType: "documentMetadata",
      entityId: String(documentId),
      detail: `Hospital ${org.name} uploaded medical record "${title}" for donor LifeLink ID ${args.lifeLinkId} (${args.documentKind}).`,
      organizationId: org._id,
    });

    await logMedicalAccess(ctx, user, org._id, donor, "upload", {
      documentId: String(documentId),
      title,
      documentKind: args.documentKind,
    });

    return { documentId, lifeLinkId: args.lifeLinkId };
  },
});

/** Documents viewable by a hospital that has valid (non-revoked, unexpired) consent. */
export const donorMedicalRecordsForHospital = query({
  args: { lifeLinkId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["hospital", "red_cross", "admin"]);
    const orgId = user.organizationId as Id<"organizations"> | undefined;
    if (!orgId) throw safeError("Your organization is not set.");

    const entry = await ctx.db
      .query("lifeLinkIds")
      .withIndex("by_life_link_id", (q) => q.eq("lifeLinkId", args.lifeLinkId))
      .unique();
    if (!entry) throw safeError("No donor matches that LifeLink ID.");
    const donor = await getDonorProfile(ctx, entry.userId);
    if (!donor) throw safeError("That LifeLink ID is not linked to a donor profile.");

    const now = Date.now();
    const allConsent = await ctx.db
      .query("donorMedicalConsents")
      .withIndex("by_donor", (q) => q.eq("donorUserId", donor.userId))
      .filter((q) => q.eq(q.field("hospitalOrgId"), orgId))
      .filter((q) => q.eq(q.field("scope"), "all_records"))
      .first();
    if (!allConsent || allConsent.revokedAt != null || allConsent.expiresAt <= now) {
      throw safeError("You do not have permission to view this donor's medical records.");
    }

    // Search access is durably logged via recordMedicalAccess (a mutation) that
    // the UI calls after this query returns. We return the ids needed to do so.
    const records = await ctx.db
      .query("documentMetadata")
      .withIndex("by_donor", (q) => q.eq("donorUserId", donor.userId))
      .filter((q) => q.eq(q.field("purpose"), "donor_medical_record"))
      .collect();

    const orgById = new Map((await ctx.db.query("organizations").collect()).map((o) => [o._id, o]));

    return {
      lifeLinkId: entry.lifeLinkId,
      donor: {
        _id: donor._id,
        donorId: donor.donorId,
        lifeLinkId: entry.lifeLinkId,
        fullName: donor.shareContact && roleOf(user) === "red_cross" ? donor.fullName : "Donor (contact protected)",
        bloodGroup: donor.bloodGroup,
        city: donor.city,
      },
      records: records
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .map((r) => {
          const uploaderOrg = r.uploadedByUserId ? orgById.get(r.uploadedByUserId) : null;
          return {
            _id: r._id,
            documentId: r._id,
            fileName: r.fileName,
            contentType: r.contentType,
            size: r.size,
            documentKind: r.documentKind ?? "other_medical",
            title: r.fileName,
            documentDate: r.expiryDate ?? null,
            uploadedAt: r.createdAt,
            scanStatus: r.scanStatus ?? "pending",
            status: r.scanStatus === "clean" ? "available" :
                    r.scanStatus === "infected" ? "quarantined" : "pending_scan",
            uploadedBy: uploaderOrg?.name ?? "A LifeLink hospital",
            hospitalOrgId: uploaderOrg ? String(uploaderOrg._id) : null,
            hospitalOrgName: uploaderOrg?.name ?? null,
            canDownload: r.scanStatus === "clean",
          };
        }),
      _accessLogHint: {
        actorUserId: user._id,
        actorRole: roleOf(user),
        hospitalOrgId: orgId,
        donorUserId: donor.userId,
        donorProfileId: donor._id,
        lookedUp: args.lifeLinkId,
      },
    };
  },
});

/** Authorized download URL. Generated by a mutation so the access can be durably logged. */
export const getMedicalRecordUrl = mutation({
  args: { documentId: v.id("documentMetadata") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const meta = await ctx.db.get(args.documentId);
    if (!meta) throw new Error("Document not found.");
    if (meta.purpose !== "donor_medical_record") throw safeError("That is not a donor medical record.");
    if (meta.scanStatus !== "clean") throw safeError("This document is quarantined until malware scanning succeeds.");

    const donor = await getDonorProfile(ctx, meta.donorUserId);
    if (!donor) throw new Error("Donor profile not found.");

    const organizationId = user.organizationId as Id<"organizations"> | undefined;

    if (user._id === meta.uploadedByUserId || user._id === donor.userId) {
      await logMedicalAccess(ctx, user, organizationId, donor, "download", { documentId: String(args.documentId) });
      return await ctx.storage.getUrl(meta.storageId);
    }

    if (roleOf(user) === "hospital" || roleOf(user) === "red_cross") {
      if (!organizationId) throw safeError("Your organization is not set.");
      const consent = await ctx.db
        .query("donorMedicalConsents")
        .withIndex("by_donor", (q) => q.eq("donorUserId", donor.userId))
        .filter((q) => q.eq(q.field("hospitalOrgId"), organizationId))
        .first();
      if (!consent || consent.revokedAt != null || consent.expiresAt <= Date.now()) {
        throw safeError("Your access to this record has expired or been revoked.");
      }
      if (consent.scope === "specific_document" && consent.documentId !== args.documentId) {
        throw safeError("You do not have permission to view this record.");
      }
      await logMedicalAccess(ctx, user, organizationId, donor, "download", { documentId: String(args.documentId) });
      return await ctx.storage.getUrl(meta.storageId);
    }

    throw safeError("You are not authorized to open this document.");
  },
});

/** Donor grants a hospital org consent to view their medical records. */
export const grantHospitalMedicalConsent = mutation({
  args: {
    hospitalOrgId: v.id("organizations"),
    scope: v.union(v.literal("all_records"), v.literal("specific_document")),
    documentId: v.optional(v.id("documentMetadata")),
    expiresInDays: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["community", "donor"]);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) throw new Error("Donor profile not found.");
    if (donor.userId !== user._id) throw new Error("That donor profile does not belong to you.");

    const hospital = await ctx.db.get(args.hospitalOrgId);
    if (!hospital || (hospital.type !== "hospital" && hospital.type !== "red_cross" && hospital.type !== "blood_bank")) {
      throw new Error("That organization is not a hospital or blood bank.");
    }

    if (!Number.isFinite(args.expiresInDays) || args.expiresInDays < 1 || args.expiresInDays > 365) {
      throw new Error("Consent expiry must be between 1 and 365 days.");
    }

    if (args.scope === "specific_document") {
      if (!args.documentId) throw safeError("No document selected.");
      const doc = await ctx.db.get(args.documentId);
      if (!doc || doc.purpose !== "donor_medical_record" || doc.donorUserId !== user._id) {
        throw safeError("That document does not belong to you.");
      }
    }

    const now = Date.now();
    const expiresAt = now + args.expiresInDays * 86_400_000;

    const existing = await ctx.db
      .query("donorMedicalConsents")
      .withIndex("by_donor", (q) => q.eq("donorUserId", user._id))
      .filter((q) => q.eq(q.field("hospitalOrgId"), args.hospitalOrgId))
      .filter((q) => q.eq(q.field("scope"), args.scope))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        expiresAt,
        revokedAt: args.scope === "specific_document" && existing.documentId !== args.documentId ? now : undefined,
        documentId: args.scope === "specific_document" ? args.documentId : existing.documentId,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("donorMedicalConsents", {
        donorUserId: user._id,
        donorProfileId: donor._id,
        hospitalOrgId: args.hospitalOrgId,
        scope: args.scope,
        documentId: args.scope === "specific_document" ? args.documentId : undefined,
        grantedAt: now,
        expiresAt,
        revokedAt: undefined,
        updatedAt: now,
      });
    }

    await logMedicalAccess(ctx, user, args.hospitalOrgId, donor, "consent_grant", {
      hospitalOrgId: String(args.hospitalOrgId),
      hospitalOrgName: hospital.name,
      scope: args.scope,
      documentId: args.scope === "specific_document" ? String(args.documentId) : undefined,
      expiresInDays: args.expiresInDays,
    });

    return { ok: true, expiresAt };
  },
});

/** Donor revokes consent for a hospital. */
export const revokeMedicalConsent = mutation({
  args: {
    hospitalOrgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["community", "donor"]);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) throw new Error("Donor profile not found.");
    if (donor.userId !== user._id) throw new Error("That donor profile does not belong to you.");

    const hospital = await ctx.db.get(args.hospitalOrgId);
    if (!hospital) throw new Error("Hospital not found.");

    const existing = await ctx.db
      .query("donorMedicalConsents")
      .withIndex("by_donor", (q) => q.eq("donorUserId", user._id))
      .filter((q) => q.eq(q.field("hospitalOrgId"), args.hospitalOrgId))
      .first();
    if (!existing) throw safeError("No consent exists for that hospital.");

    await ctx.db.patch(existing._id, {
      revokedAt: Date.now(),
      updatedAt: Date.now(),
    });

    await logMedicalAccess(ctx, user, args.hospitalOrgId, donor, "consent_revoke", {
      hospitalOrgId: String(args.hospitalOrgId),
      hospitalOrgName: hospital.name,
    });

    return { ok: true };
  },
});

/** Hospital-side list of donors who have granted THIS hospital consent. */
export const consentedDonorsForHospital = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ["hospital", "red_cross", "admin"]);
    const orgId = user.organizationId;
    if (!orgId) return { donors: [], kind: roleOf(user) };

    const consents = await ctx.db
      .query("donorMedicalConsents")
      .withIndex("by_hospital", (q) => q.eq("hospitalOrgId", orgId))
      .collect();

    const now = Date.now();
    const active = consents.filter((c) => c.revokedAt == null && c.expiresAt > now);

    const donorRows = await Promise.all(
      active.map(async (c) => {
        const donor = await getDonorProfile(ctx, c.donorUserId);
        const idEntry = await ctx.db
          .query("lifeLinkIds")
          .withIndex("by_user", (q) => q.eq("userId", c.donorUserId))
          .unique();
        return donor ? {
          donorProfileId: c.donorProfileId,
          lifeLinkId: idEntry?.lifeLinkId ?? donor.donorId,
          fullName: donor.shareContact && roleOf(user) === "red_cross" ? donor.fullName : "Donor (contact protected)",
          bloodGroup: donor.bloodGroup,
          city: donor.city,
          consentedAt: c.grantedAt,
          expiresAt: c.expiresAt,
          scope: c.scope,
        } : null;
      })
    );

    return {
      donors: donorRows.filter((d): d is NonNullable<typeof d> => d != null) as Array<{
        donorProfileId: Id<"donorProfiles">;
        lifeLinkId: string;
        fullName: string;
        bloodGroup: string;
        city: string;
        consentedAt: number;
        expiresAt: number;
        scope: "all_records" | "specific_document";
      }>,
      kind: roleOf(user),
    };
  },
});

/** Internal helper used only by mutations to write an access log. */
async function logMedicalAccess(
  ctx: import("./_generated/server").MutationCtx,
  actor: AppUser,
  hospitalOrgId: Id<"organizations"> | undefined,
  donor: Doc<"donorProfiles"> | null,
  action: "upload" | "view" | "download" | "search" | "consent_grant" | "consent_revoke",
  detail: Record<string, unknown>,
) {
  const recordId = detail["documentId"] != null
    ? (detail["documentId"] as Id<"documentMetadata">)
    : undefined;
  const donorUserId = donor != null ? donor.userId : actor._id;
  const donorProfileId = donor != null ? donor._id : undefined;
  await ctx.db.insert("medicalRecordAccessLogs", {
    recordId,
    donorUserId,
    donorProfileId,
    actorUserId: actor._id,
    actorRole: roleOf(actor),
    hospitalOrgId,
    action,
    detail: JSON.stringify(detail),
    createdAt: Date.now(),
  });
}
