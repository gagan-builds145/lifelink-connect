import { v } from "convex/values";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { audit, getDonorProfile, requireStaff, requireUser } from "./lib/helpers";
import { queueForDonors, queueForOrganization } from "./lib/messaging";
import { DONOR_FALLBACK_NOTE } from "../lib/supply";
import type { DonorEscalationResult } from "./donorPrediction";

/**
 * Temporary, revocable location-sharing consent. No donor location is exposed
 * without an active, unexpired consent row.
 */
export const setLocationConsent = mutation({
  args: { shareLocation: v.boolean(), hours: v.number() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) throw new Error("Only registered donors can manage donation-location consent.");
    const hours = Math.max(1, Math.min(168, Math.round(args.hours)));
    const now = Date.now();
    const existing = await ctx.db
      .query("donorConsents")
      .withIndex("by_donor", (q) => q.eq("donorUserId", user._id))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        shareLocation: args.shareLocation,
        expiresAt: args.shareLocation ? now + hours * 3_600_000 : existing.expiresAt,
        revokedAt: args.shareLocation ? undefined : now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("donorConsents", {
        donorUserId: user._id,
        donorProfileId: donor._id,
        shareLocation: args.shareLocation,
        grantedAt: now,
        expiresAt: now + hours * 3_600_000,
        revokedAt: args.shareLocation ? undefined : now,
        updatedAt: now,
      });
    }
    await audit(ctx, {
      actor: user,
      action: "donor.consentUpdated",
      entityType: "donorProfile",
      entityId: donor.donorId,
      detail: args.shareLocation
        ? `Location-sharing consent granted for ${hours} hour(s).`
        : "Location-sharing consent revoked.",
    });
    return { shareLocation: args.shareLocation, hours };
  },
});

export const myConsent = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const consent = await ctx.db
      .query("donorConsents")
      .withIndex("by_donor", (q) => q.eq("donorUserId", user._id))
      .first();
    const now = Date.now();
    return {
      shareLocation:
        consent?.shareLocation === true &&
        consent.revokedAt == null &&
        consent.expiresAt > now,
      expiresAt: consent?.expiresAt ?? null,
      revokedAt: consent?.revokedAt ?? null,
      note: DONOR_FALLBACK_NOTE,
    };
  },
});

export const myInvitations = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) return [];
    const invitations = await ctx.db
      .query("donorInvitations")
      .withIndex("by_donor", (q) => q.eq("donorUserId", user._id))
      .collect();
    const orgs = await ctx.db.query("organizations").collect();
    const centers = new Map(orgs.map((o) => [o._id, o]));
    return invitations
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((invite) => {
        const requesting = centers.get(invite.requestingOrgId);
        const center = invite.donationCenterOrgId
          ? centers.get(invite.donationCenterOrgId)
          : null;
        return {
          _id: invite._id,
          bloodGroup: invite.bloodGroup,
          component: invite.component,
          units: invite.units,
          status: invite.status,
          distanceKm: invite.distanceKm ?? null,
          responseProbability: invite.responseProbability ?? null,
          responseModel: invite.responseModel ?? null,
          responseModelVersion: invite.responseModelVersion ?? null,
          responseModelSynthetic: invite.responseModelSynthetic ?? null,
          responseExplanation: invite.responseExplanation ?? null,
          predictedAt: invite.predictedAt ?? null,
          createdAt: invite.createdAt,
          respondedAt: invite.respondedAt ?? null,
          appointmentAt: invite.appointmentAt ?? null,
          facilityName: requesting?.name ?? "Network facility",
          facilityCity: requesting?.city ?? null,
          // Contact details unlock only after the donor accepts.
          facilityPhone: invite.status === "accepted" ? requesting?.phone ?? null : null,
          facilityAddress: invite.status === "accepted" ? requesting?.address ?? null : null,
          centerName: center?.name ?? null,
          centerPhone: center?.phone ?? null,
          centerAddress: center?.address ?? null,
        };
      });
  },
});

export const respond = mutation({
  args: {
    invitationId: v.id("donorInvitations"),
    action: v.union(v.literal("accept"), v.literal("decline")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) throw new Error("Only registered donors can respond to an invitation.");
    const invite = await ctx.db.get(args.invitationId);
    if (!invite || invite.donorUserId !== user._id) {
      throw new Error("That invitation could not be found for your account.");
    }
    if (invite.status !== "sent") {
      throw new Error("This invitation has already been answered.");
    }

    const now = Date.now();
    if (args.action === "decline") {
      await ctx.db.patch(invite._id, {
        status: "declined",
        respondedAt: now,
        note: args.note,
      });
      await queueForOrganization(ctx, invite.requestingOrgId, {
        title: "Donor declined the invitation",
        body: `A compatible donor near ${donor.city} declined. The request will keep looking for other eligible donors.`,
        kind: "match",
        dedupeKey: `donor-decline:${invite._id}`,
        requestId: invite.requestId,
        link: "/supply",
      });
      return { ok: true, status: "declined" as const };
    }

    const orgs = await ctx.db.query("organizations").collect();
    const requesting = orgs.find((o) => o._id === invite.requestingOrgId) ?? null;
    const centers = orgs.filter(
      (o) =>
        o.status === "verified" &&
        (o.type === "red_cross" || o.type === "blood_bank"),
    );
    const sameCity = centers.filter((o) => o.city === donor.city);
    const center =
      sameCity[0] ??
      centers.find((o) => o._id === invite.requestingOrgId) ??
      (requesting && requesting.type !== "hospital" ? requesting : null);
    const appointmentAt = now + 24 * 3_600_000;

    await ctx.db.patch(invite._id, {
      status: "accepted",
      respondedAt: now,
      appointmentAt,
      donationCenterOrgId: center?._id,
      note: args.note,
    });

    // Basic contact details are shared only after the donor accepts.
    const donorDetails = `${donor.fullName} · ${donor.phone} · ${donor.city}${donor.area ? `, ${donor.area}` : ""}`;

    await queueForOrganization(ctx, invite.requestingOrgId, {
      title: "Donor accepted the invitation",
      body: `${donorDetails} accepted your ${invite.bloodGroup} ${invite.component.replace(/_/g, " ")} invitation. Final eligibility, screening and collection happen at the licensed centre.`,
      kind: "match",
      requestId: invite.requestId,
      dedupeKey: `donor-accept:${invite._id}`,
      link: "/supply",
    });

    if (center) {
      await queueForDonors(ctx, center._id, {
        title: "Donor appointment to confirm",
        body: `${donorDetails} accepted an invitation from ${requesting?.name ?? "a network facility"} and selected ${center.name}. Confirm the appointment, screen the donor and record only released units as stock.`,
        kind: "match",
        dedupeKey: `donor-appointment:${invite._id}`,
        link: "/red-cross/dashboard",
      });
    }

    await audit(ctx, {
      actor: user,
      action: "donor.invitationAccepted",
      entityType: "donorInvitation",
      entityId: String(invite._id),
      detail: `Donor accepted an invitation for ${invite.units} unit(s) of ${invite.bloodGroup} ${invite.component}. Appointment at ${center?.name ?? "unassigned centre"}.`,
      organizationId: invite.requestingOrgId,
    });

    return {
      ok: true,
      status: "accepted" as const,
      centerName: center?.name ?? null,
      appointmentAt,
    };
  },
});

export const invitationsForOrg = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireStaff(ctx);
    const organizationId = user.organizationId;
    if (!organizationId) return [];
    const invitations = await ctx.db
      .query("donorInvitations")
      .withIndex("by_status", (q) => q.eq("status", "accepted"))
      .collect();
    const scoped = invitations.filter((i) => i.requestingOrgId === organizationId);
    const donors = await ctx.db.query("donorProfiles").collect();
    const byId = new Map(donors.map((d) => [d._id, d]));
    return scoped
      .sort((a, b) => (b.respondedAt ?? 0) - (a.respondedAt ?? 0))
      .map((invite) => {
        const donor = byId.get(invite.donorProfileId);
        return {
          _id: invite._id,
          bloodGroup: invite.bloodGroup,
          component: invite.component,
          status: invite.status,
          respondedAt: invite.respondedAt ?? null,
          appointmentAt: invite.appointmentAt ?? null,
          donorName: donor?.fullName ?? "Donor",
          donorPhone: donor?.phone ?? null,
          donorCity: donor?.city ?? null,
        };
      });
  },
});

export const currentEscalationActor = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await requireStaff(ctx);
    return { actorUserId: user._id };
  },
});

/**
 * Manual donor fallback. Deterministic eligibility is checked in the mutation,
 * while the Python Random Forest only orders already-eligible, consented donors.
 * If the ML service is unavailable, invitations still proceed by distance only.
 */
export const escalateRequest = action({
  args: { requestId: v.id("bloodRequests"), note: v.optional(v.string()) },
  handler: async (ctx, args): Promise<DonorEscalationResult> => {
    const { actorUserId } = await ctx.runQuery(
      internal.donorFallback.currentEscalationActor,
      {},
    );
    return await ctx.runAction(internal.donorPrediction.escalateForRequest, {
      requestId: args.requestId,
      actorUserId,
      note: args.note,
    });
  },
});

export type DonorInvitationDoc = Doc<"donorInvitations">;
