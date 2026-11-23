import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server";
import {
  audit,
  enforceRateLimit,
  getDonorProfile,
  requireRole,
} from "./lib/helpers";
import { identityVerificationStatusValidator } from "./validators";
import {
  AADHAAR_CONSENT_VERSION,
  getAadhaarProvider,
  liveVerificationConfigured,
  sandboxEnabled,
} from "./lib/aadhaarProvider";

const DONOR_ROLES = ["community", "donor", "requestor"] as const;
const ACTIVE_STATUSES = ["PENDING", "VERIFIED", "REQUIRES_REVIEW"] as const;

/**
 * Donor-facing identity verification status.
 *
 * Returns only the latest session plus a short history. The full Aadhaar
 * number, OTPs and provider payloads are never stored and therefore cannot be
 * returned here.
 */
export const myVerification = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, [...DONOR_ROLES]);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) return null;
    const rows = await ctx.db
      .query("donorIdentityVerifications")
      .withIndex("by_donor", (q) => q.eq("donorUserId", user._id))
      .collect();
    rows.sort((a, b) => b.createdAt - a.createdAt);
    const latest = rows[0] ?? null;
    return {
      donorId: donor.donorId,
      bloodGroup: donor.bloodGroup,
      bloodGroupSource: donor.bloodGroupSource ?? "self_declared",
      bloodGroupUpdatedAt: donor.bloodGroupUpdatedAt ?? null,
      consentVersion: AADHAAR_CONSENT_VERSION,
      liveEnabled: liveVerificationConfigured(),
      sandbox: sandboxEnabled(),
      latest: latest
        ? {
            id: latest._id,
            provider: latest.provider,
            status: latest.status,
            sandbox: latest.sandbox,
            consentVersion: latest.consentVersion,
            consentTimestamp: latest.consentTimestamp,
            consentWithdrawnAt: latest.consentWithdrawnAt ?? null,
            verificationTimestamp: latest.verificationTimestamp ?? null,
            expiryTimestamp: latest.expiryTimestamp,
            verifiedName: latest.verifiedName ?? null,
            verifiedAddress: latest.verifiedAddress ?? null,
            failureReason: latest.failureReason ?? null,
            reviewNote: latest.reviewNote ?? null,
            permittedMaskedReference: latest.permittedMaskedReference ?? null,
          }
        : null,
      history: rows.slice(0, 8).map((row) => ({
        id: row._id,
        status: row.status,
        provider: row.provider,
        sandbox: row.sandbox,
        createdAt: row.createdAt,
        verificationTimestamp: row.verificationTimestamp ?? null,
      })),
    };
  },
});

/** Explicit consent is mandatory; no checkbox is preselected in the UI. */
export const startVerification = mutation({
  args: { consent: v.boolean(), consentVersion: v.string() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [...DONOR_ROLES]);
    if (args.consent !== true) {
      throw new Error("Explicit consent is required before identity verification can start.");
    }
    if (args.consentVersion !== AADHAAR_CONSENT_VERSION) {
      throw new Error("The consent notice has changed. Review and accept the current version.");
    }
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) throw new Error("Complete your donor profile before verifying your identity.");

    await enforceRateLimit(ctx, `aadhaar-start:${user._id}`, 5);

    const existing = await ctx.db
      .query("donorIdentityVerifications")
      .withIndex("by_donor", (q) => q.eq("donorUserId", user._id))
      .collect();
    const active = existing.find(
      (row) => ACTIVE_STATUSES.includes(row.status as (typeof ACTIVE_STATUSES)[number]),
    );
    if (active?.status === "VERIFIED") {
      throw new Error("Your identity is already verified. Use the support process for corrections.");
    }
    if (active && active.expiryTimestamp > Date.now()) {
      throw new Error("A verification session is already in progress. Finish or cancel it first.");
    }

    const provider = getAadhaarProvider();
    const now = Date.now();
    const session = await provider.createVerificationSession({
      donorUserId: String(user._id),
      consentVersion: args.consentVersion,
      now,
    });

    const id = await ctx.db.insert("donorIdentityVerifications", {
      donorUserId: user._id,
      donorProfileId: donor._id,
      provider: session.provider,
      verificationReference: session.reference,
      status: "PENDING",
      sandbox: session.sandbox,
      consentVersion: args.consentVersion,
      consentTimestamp: now,
      expiryTimestamp: session.expiresAt,
      permittedMaskedReference: session.maskedReference,
      createdAt: now,
      updatedAt: now,
    });

    await audit(ctx, {
      actor: user,
      action: "identity.verification_started",
      entityType: "donorIdentityVerification",
      entityId: String(id),
      detail: `Identity verification session created with provider ${session.provider}${
        session.sandbox ? " (sandbox)" : ""
      }. No Aadhaar number, OTP or biometric data stored.`,
    });

    return {
      verificationId: id,
      provider: session.provider,
      sandbox: session.sandbox,
      expiresAt: session.expiresAt,
      reference: session.reference,
    };
  },
});

export const cancelVerification = mutation({
  args: { verificationId: v.id("donorIdentityVerifications") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [...DONOR_ROLES]);
    const row = await ctx.db.get(args.verificationId);
    if (!row || row.donorUserId !== user._id) {
      throw new Error("Verification session not found.");
    }
    if (row.status !== "PENDING") {
      throw new Error("Only a pending verification can be cancelled.");
    }
    try {
      const provider = getAadhaarProvider();
      await provider.cancelVerificationSession(row.verificationReference);
    } catch {
      // Provider cancellation failure must not leave a stuck local session.
    }
    await ctx.db.patch(row._id, {
      status: "EXPIRED",
      failureReason: "Cancelled by the donor.",
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const withdrawConsent = mutation({
  args: { verificationId: v.id("donorIdentityVerifications") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [...DONOR_ROLES]);
    const row = await ctx.db.get(args.verificationId);
    if (!row || row.donorUserId !== user._id) {
      throw new Error("Verification record not found.");
    }
    if (row.consentWithdrawnAt) return { ok: true, alreadyWithdrawn: true };
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "REVOKED",
      consentWithdrawnAt: now,
      // Data minimisation on withdrawal: remove the permitted identity copy.
      // The lifecycle record (status, timestamps) is retained for audit.
      verifiedName: undefined,
      verifiedAddress: undefined,
      updatedAt: now,
    });
    await audit(ctx, {
      actor: user,
      action: "identity.consent_withdrawn",
      entityType: "donorIdentityVerification",
      entityId: String(row._id),
      detail:
        "Donor withdrew identity-verification consent. Identity copy erased; lifecycle record retained for audit.",
    });
    return { ok: true };
  },
});

/**
 * Sandbox-only switch. This is not a UIDAI verification and never claims to be:
 * the row is stored with sandbox=true and every surface labels it. It exists so
 * the integration and dashboards can be exercised without an authorised
 * provider in development.
 */
export const completeSandboxVerification = mutation({
  args: { verificationId: v.id("donorIdentityVerifications") },
  handler: async (ctx, args) => {
    if (!sandboxEnabled() || liveVerificationConfigured()) {
      throw new Error(
        "Sandbox completion is only available when the sandbox provider is explicitly enabled.",
      );
    }
    const user = await requireRole(ctx, [...DONOR_ROLES]);
    const row = await ctx.db.get(args.verificationId);
    if (!row || row.donorUserId !== user._id) throw new Error("Verification session not found.");
    if (!row.sandbox) throw new Error("This session is not a sandbox session.");
    if (row.status !== "PENDING") throw new Error("This verification session is not pending.");
    if (row.expiryTimestamp <= Date.now()) {
      await ctx.db.patch(row._id, {
        status: "EXPIRED",
        failureReason: "Session expired before completion.",
        updatedAt: Date.now(),
      });
      throw new Error("This verification session has expired. Start a new session.");
    }
    const donor = await ctx.db.get(row.donorProfileId);
    if (!donor) throw new Error("Donor profile not found.");

    await ctx.db.patch(row._id, {
      status: "VERIFIED",
      verifiedName: donor.fullName,
      verifiedAddress: donor.address,
      verificationTimestamp: Date.now(),
      callbackReceivedAt: Date.now(),
      providerTransactionReference: `sandbox_${row.verificationReference.slice(-12)}`,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: user,
      action: "identity.sandbox_verified",
      entityType: "donorIdentityVerification",
      entityId: String(row._id),
      detail:
        "Sandbox verification completed. This is NOT a UIDAI Aadhaar verification and must not be presented as one.",
    });
    return { ok: true, sandbox: true };
  },
});

/** Administrators may flag a session for review; they can never set VERIFIED. */
export const reviewVerification = mutation({
  args: {
    verificationId: v.id("donorIdentityVerifications"),
    status: v.union(
      v.literal("REQUIRES_REVIEW"),
      v.literal("FAILED"),
      v.literal("REVOKED"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    const row = await ctx.db.get(args.verificationId);
    if (!row) throw new Error("Verification record not found.");
    const reason = args.reason.trim();
    if (reason.length < 5) throw new Error("A review reason is required.");
    await ctx.db.patch(row._id, {
      status: args.status,
      reviewNote: reason.slice(0, 300),
      reviewedByUserId: admin._id,
      reviewedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: admin,
      action: `identity.review_${args.status.toLowerCase()}`,
      entityType: "donorIdentityVerification",
      entityId: String(row._id),
      detail: `Administrator set verification to ${args.status}: ${reason.slice(0, 200)}`,
    });
    return { ok: true };
  },
});

export const adminVerifications = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const rows = await ctx.db.query("donorIdentityVerifications").collect();
    const donors = await ctx.db.query("donorProfiles").collect();
    const donorById = new Map(donors.map((donor) => [String(donor._id), donor]));
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map((row) => {
        const donor = donorById.get(String(row.donorProfileId));
        return {
          id: row._id,
          donorId: donor?.donorId ?? "unknown",
          donorCity: donor?.city ?? null,
          provider: row.provider,
          status: row.status,
          sandbox: row.sandbox,
          consentVersion: row.consentVersion,
          consentTimestamp: row.consentTimestamp,
          consentWithdrawnAt: row.consentWithdrawnAt ?? null,
          verificationTimestamp: row.verificationTimestamp ?? null,
          expiryTimestamp: row.expiryTimestamp,
          // Only a permitted masked reference is exposed, never an Aadhaar number.
          maskedReference: row.permittedMaskedReference ?? null,
          reviewNote: row.reviewNote ?? null,
          createdAt: row.createdAt,
        };
      });
  },
});

/**
 * Internal callback ingestion. Called only by the signed HTTP route.
 * Enforces replay/idempotency: a non-pending session is left untouched.
 */
export const ingestProviderCallback = internalMutation({
  args: {
    reference: v.string(),
    status: identityVerificationStatusValidator,
    providerTransactionReference: v.optional(v.string()),
    verifiedName: v.optional(v.string()),
    verifiedAddress: v.optional(v.string()),
    maskedReference: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("donorIdentityVerifications")
      .withIndex("by_reference", (q) => q.eq("verificationReference", args.reference))
      .unique();
    if (!row) return { ok: false, reason: "unknown_reference" as const };
    if (row.status !== "PENDING") return { ok: true, duplicate: true as const };

    const now = Date.now();
    if (row.expiryTimestamp <= now && args.status !== "EXPIRED") {
      await ctx.db.patch(row._id, {
        status: "EXPIRED",
        failureReason: "Provider callback arrived after the session expiry.",
        callbackReceivedAt: now,
        updatedAt: now,
      });
      return { ok: true, expired: true as const };
    }

    await ctx.db.patch(row._id, {
      status: args.status,
      providerTransactionReference: args.providerTransactionReference?.slice(0, 120),
      permittedMaskedReference: args.maskedReference?.slice(0, 40),
      verifiedName: args.status === "VERIFIED" ? args.verifiedName?.slice(0, 160) : undefined,
      verifiedAddress:
        args.status === "VERIFIED" ? args.verifiedAddress?.slice(0, 300) : undefined,
      failureReason: args.status === "VERIFIED" ? undefined : args.failureReason?.slice(0, 300),
      verificationTimestamp: args.status === "VERIFIED" ? now : row.verificationTimestamp,
      callbackReceivedAt: now,
      updatedAt: now,
    });
    return { ok: true };
  },
});

/** Daily housekeeping: expire abandoned pending sessions. */
export const expirePendingSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("donorIdentityVerifications").collect();
    const now = Date.now();
    let expired = 0;
    for (const row of rows) {
      if (row.status === "PENDING" && row.expiryTimestamp <= now) {
        await ctx.db.patch(row._id, {
          status: "EXPIRED",
          failureReason: "Session expired without a provider response.",
          updatedAt: now,
        });
        expired += 1;
      }
    }
    return { expired };
  },
});

export const configuration = query({
  args: {},
  handler: async () => ({
    liveEnabled: liveVerificationConfigured(),
    sandbox: sandboxEnabled(),
    consentVersion: AADHAAR_CONSENT_VERSION,
  }),
});
