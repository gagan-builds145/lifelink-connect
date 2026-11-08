import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { cityCoords, haversineKm } from "../../lib/blood";
import {
  donorInviteEligibility,
  donorResponseProbability,
  type DonorResponseModel,
} from "../../lib/supply";
import { queueNotification } from "./messaging";

function pointForOrg(org: Doc<"organizations"> | null | undefined) {
  if (!org) return null;
  if (org.latitude != null && org.longitude != null) {
    return { lat: org.latitude, lng: org.longitude };
  }
  return cityCoords(org.city);
}

function parseModel(payload: string): DonorResponseModel | null {
  try {
    const parsed = JSON.parse(payload) as DonorResponseModel;
    if (!Array.isArray(parsed.weights) || !Array.isArray(parsed.means)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function activeDonorResponseModel(ctx: MutationCtx) {
  const record = await ctx.db
    .query("mlModels")
    .withIndex("by_kind", (q) => q.eq("kind", "donor_response").eq("active", true))
    .first();
  return record ? parseModel(record.payload) : null;
}

export type DonorEscalationResult = {
  invited: number;
  eligible: number;
  skippedNoConsent: number;
  skippedMedicalInterval: number;
  model: "trained_logistic" | "untrained";
  note: string;
};

/**
 * Donor fallback. Called only after the institutional shortfall has been
 * recalculated and is still positive. Donors are invited, never counted as
 * stock, and only donors with an active, unexpired location-sharing consent
 * are eligible.
 */
export async function escalateDonorsForNeed(
  ctx: MutationCtx,
  input: {
    requestingOrg: Doc<"organizations">;
    bloodGroup: Doc<"bloodRequests">["bloodGroup"];
    component: Doc<"bloodRequests">["component"];
    units: number;
    urgency: Doc<"bloodRequests">["urgency"];
    requestId?: Id<"bloodRequests">;
    stockAlertId?: Id<"stockAlerts">;
    actorUserId?: Id<"users">;
  },
): Promise<DonorEscalationResult> {
  const now = Date.now();
  const model = await activeDonorResponseModel(ctx);
  const orgPoint = pointForOrg(input.requestingOrg);

  const donors = await ctx.db
    .query("donorProfiles")
    .withIndex("by_availability", (q) => q.eq("available", true))
    .collect();
  const consents = await ctx.db.query("donorConsents").collect();
  const consentByProfile = new Map(consents.map((c) => [c.donorProfileId, c]));

  const ranked: Array<{
    donor: Doc<"donorProfiles">;
    distanceKm: number | null;
    probability: number | null;
    center: Doc<"organizations"> | null;
  }> = [];
  let skippedNoConsent = 0;
  let skippedMedicalInterval = 0;

  for (const donor of donors) {
    const consent = consentByProfile.get(donor._id);
    const shareLocation =
      consent?.shareLocation === true &&
      consent.revokedAt == null &&
      consent.expiresAt > now;
    if (!shareLocation) {
      skippedNoConsent += 1;
      continue;
    }

    const eligibility = donorInviteEligibility(
      {
        donorId: donor.donorId,
        city: donor.city,
        bloodGroup: donor.bloodGroup,
        available: donor.available,
        lastDonationDate: donor.lastDonationDate,
        shareLocationConsent: shareLocation,
        consentExpiresAt: consent?.expiresAt ?? null,
      },
      {
        bloodGroup: input.bloodGroup,
        component: input.component,
        city: input.requestingOrg.city,
        urgency: input.urgency,
      },
      { now },
    );
    if (!eligibility.eligible) {
      if (eligibility.blockers.some((b) => b.includes("interval"))) {
        skippedMedicalInterval += 1;
      }
      continue;
    }

    const donorPoint = cityCoords(donor.city);
    const distanceKm =
      donorPoint && orgPoint
        ? Math.round(haversineKm(donorPoint, orgPoint) * 10) / 10
        : null;

    const daysSinceDonation = donor.lastDonationDate
      ? Math.max(0, Math.floor((now - new Date(donor.lastDonationDate).getTime()) / 86_400_000))
      : 365;
    const probability = donorResponseProbability(
      {
        distanceKm: distanceKm ?? 25,
        daysSinceDonation,
        previousDonations: 0,
        priorResponseRate: 0.5,
      },
      model,
    ).probability;

    // Nearest licensed collection centre in the same city, falling back to the
    // requesting facility when it is itself a blood centre.
    const centers = (
      await ctx.db
        .query("organizations")
        .withIndex("by_city", (q) => q.eq("city", donor.city))
        .collect()
    ).filter(
      (o) =>
        o.status === "verified" &&
        (o.type === "red_cross" || o.type === "blood_bank"),
    );
    const center =
      centers.find((o) => o._id === input.requestingOrg._id) ??
      centers[0] ??
      (input.requestingOrg.type !== "hospital" ? input.requestingOrg : null);

    ranked.push({ donor, distanceKm, probability, center });
  }

  ranked.sort((a, b) => {
    const pa = a.probability ?? 0;
    const pb = b.probability ?? 0;
    if (pb !== pa) return pb - pa;
    return (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999);
  });

  let invited = 0;
  for (const entry of ranked.slice(0, 25)) {
    const idempotencyKey = `${input.requestId ?? input.stockAlertId ?? "need"}:${entry.donor._id}`;
    const existing = await ctx.db
      .query("donorInvitations")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
      .first();
    if (existing) continue;

    await ctx.db.insert("donorInvitations", {
      requestId: input.requestId,
      stockAlertId: input.stockAlertId,
      requestingOrgId: input.requestingOrg._id,
      donorUserId: entry.donor.userId,
      donorProfileId: entry.donor._id,
      bloodGroup: input.bloodGroup,
      component: input.component,
      units: input.units,
      distanceKm: entry.distanceKm ?? undefined,
      responseProbability: entry.probability ?? undefined,
      status: "sent",
      idempotencyKey,
      createdAt: now,
    });

    await queueNotification(ctx, {
      userId: entry.donor.userId,
      title: `Donation invitation: ${input.bloodGroup} ${input.component.replace(/_/g, " ")}`,
      body: `${input.requestingOrg.name} in ${input.requestingOrg.city} needs ${input.units} unit(s). Institutional supply could not cover it. If you can donate, open your dashboard to accept — the collection centre is notified only after you accept.`,
      kind: "match",
      link: "/donor/dashboard",
      requestId: input.requestId,
      dedupeKey: `donor-invite:${idempotencyKey}`,
      emailSubject: `Donation invitation near ${input.requestingOrg.city}`,
    });
    invited += 1;
  }

  await ctx.db.insert("auditLogs", {
    actorUserId: input.actorUserId,
    actorRole: input.actorUserId ? "system" : "automation",
    action: "donorFallback.invitations",
    entityType: input.requestId ? "bloodRequest" : "stockAlert",
    entityId: String(input.requestId ?? input.stockAlertId ?? "need"),
    detail: `${invited} donor invitation(s) sent after institutional shortfall of ${input.units} unit(s); ${skippedNoConsent} skipped for missing consent, ${skippedMedicalInterval} skipped for donation interval.`,
    organizationId: input.requestingOrg._id,
    createdAt: now,
  });

  return {
    invited,
    eligible: ranked.length,
    skippedNoConsent,
    skippedMedicalInterval,
    model: model ? "trained_logistic" : "untrained",
    note:
      invited === 0
        ? "No donors with active location consent were eligible. Institutional supply remains the only source."
        : "Donors are invited to donate. Blood is not counted as available until a licensed centre collects, screens and releases it.",
  };
}
