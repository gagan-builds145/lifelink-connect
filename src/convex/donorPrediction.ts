import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { audit, roleOf } from "./lib/helpers";
import { cityCoords, haversineKm } from "../lib/blood";
import { donorInviteEligibility } from "../lib/supply";
import { rankScoredDonors } from "../lib/donorRanking";
import { queueNotification } from "./lib/messaging";
import { mlFetch, mlServiceConfigured } from "./lib/mlClient";

const OPEN_STATUSES = new Set([
  "pending",
  "under_verification",
  "approved",
  "dispatched",
  "received",
]);
const STAFF_ROLES = new Set(["red_cross", "hospital", "admin"]);
const MAX_CANDIDATES = 50;
const MAX_INVITES = 25;

type DonorCandidate = {
  donorProfileId: Id<"donorProfiles">;
  donorUserId: Id<"users">;
  distanceKm: number;
  daysSinceDonation: number;
  previousDonations: number;
  priorResponseRate: number;
  idempotencyKey: string;
};

type PreparedDonorEscalation = {
  covered: boolean;
  shortfall: number;
  requestCode: string;
  requestingOrgId: Id<"organizations">;
  organizationName: string;
  organizationCity: string;
  bloodGroup: string;
  component: string;
  urgency: string;
  isDemo: boolean;
  eligible: number;
  skippedNoConsent: number;
  skippedMedicalInterval: number;
  candidates: DonorCandidate[];
};

type FallbackModel =
  | "python_random_forest"
  | "distance_only_fallback"
  | "ml_not_configured";

export type DonorEscalationResult = {
  invited: number;
  eligible: number;
  skippedNoConsent: number;
  skippedMedicalInterval: number;
  model: FallbackModel;
  note: string;
};

const candidateValidator = v.object({
  donorProfileId: v.id("donorProfiles"),
  donorUserId: v.id("users"),
  distanceKm: v.number(),
  daysSinceDonation: v.number(),
  previousDonations: v.number(),
  priorResponseRate: v.number(),
  idempotencyKey: v.string(),
});

const scoreValidator = v.object({
  donorProfileId: v.id("donorProfiles"),
  responseProbability: v.number(),
  modelVersion: v.union(v.string(), v.null()),
  synthetic: v.boolean(),
  explanation: v.string(),
});

const fallbackModelValidator = v.union(
  v.literal("python_random_forest"),
  v.literal("distance_only_fallback"),
  v.literal("ml_not_configured"),
);

function pointForOrg(org: Doc<"organizations">) {
  if (org.latitude != null && org.longitude != null) {
    return { lat: org.latitude, lng: org.longitude };
  }
  return cityCoords(org.city);
}

function assertStaff(actor: Doc<"users"> | null) {
  if (!actor || actor.suspended || !STAFF_ROLES.has(roleOf(actor))) {
    throw new Error("Only authorised facility staff can contact donors.");
  }
  return actor;
}

async function assertRequestScope(
  ctx: QueryCtx | MutationCtx,
  requestId: Id<"bloodRequests">,
  actorUserId: Id<"users">,
) {
  const actor = assertStaff(await ctx.db.get(actorUserId));
  const request = await ctx.db.get(requestId);
  if (!request) throw new Error("Request not found.");
  if (roleOf(actor) !== "admin" && actor.organizationId !== request.hospitalOrgId) {
    throw new Error("Only the requesting hospital can escalate this request to donors.");
  }
  if (!OPEN_STATUSES.has(request.status)) {
    throw new Error("This request is closed; donor invitations cannot be sent.");
  }
  const reservations = await ctx.db
    .query("inventoryReservations")
    .withIndex("by_request", (q) => q.eq("requestId", request._id))
    .collect();
  const activeUnits = reservations
    .filter((row) => row.status === "active")
    .reduce((sum, row) => sum + row.units, 0);
  const org = request.hospitalOrgId
    ? await ctx.db.get(request.hospitalOrgId)
    : null;
  if (!org) throw new Error("The requesting hospital record could not be found.");
  return {
    actor,
    request,
    org,
    activeUnits,
    shortfall: Math.max(0, request.units - activeUnits),
  };
}

/**
 * Builds the deterministic candidate set. Eligibility and consent are decided
 * here, before any model is called. The Python service only receives consented,
 * already-eligible donors and can only change the ordering.
 */
export const prepareDonorEscalation = internalQuery({
  args: {
    requestId: v.id("bloodRequests"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args): Promise<PreparedDonorEscalation> => {
    const scope = await assertRequestScope(ctx, args.requestId, args.actorUserId);
    if (scope.shortfall <= 0) {
      return {
        covered: true,
        shortfall: 0,
        requestCode: scope.request.requestId,
        requestingOrgId: scope.org._id,
        organizationName: scope.org.name,
        organizationCity: scope.org.city,
        bloodGroup: scope.request.bloodGroup,
        component: scope.request.component,
        urgency: scope.request.urgency,
        isDemo: scope.request.isDemo ?? false,
        eligible: 0,
        skippedNoConsent: 0,
        skippedMedicalInterval: 0,
        candidates: [],
      };
    }

    const now = Date.now();
    const orgPoint = pointForOrg(scope.org);
    const [donors, consents, donations, invitations] = await Promise.all([
      ctx.db
        .query("donorProfiles")
        .withIndex("by_availability", (q) => q.eq("available", true))
        .collect(),
      ctx.db.query("donorConsents").collect(),
      ctx.db.query("donations").collect(),
      ctx.db.query("donorInvitations").collect(),
    ]);
    const consentByProfile = new Map(consents.map((row) => [row.donorProfileId, row]));
    const donationsByProfile = new Map<string, number>();
    for (const donation of donations) {
      const key = String(donation.donorProfileId);
      donationsByProfile.set(key, (donationsByProfile.get(key) ?? 0) + 1);
    }
    const responsesByProfile = new Map<string, { accepted: number; total: number }>();
    const existingKeys = new Set(invitations.map((row) => row.idempotencyKey));
    for (const invitation of invitations) {
      if (invitation.status !== "accepted" && invitation.status !== "declined") continue;
      const key = String(invitation.donorProfileId);
      const current = responsesByProfile.get(key) ?? { accepted: 0, total: 0 };
      current.total += 1;
      if (invitation.status === "accepted") current.accepted += 1;
      responsesByProfile.set(key, current);
    }

    const candidates: Array<{
      donorProfileId: Id<"donorProfiles">;
      donorUserId: Id<"users">;
      distanceKm: number;
      daysSinceDonation: number;
      previousDonations: number;
      priorResponseRate: number;
      idempotencyKey: string;
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
          bloodGroup: scope.request.bloodGroup,
          component: scope.request.component,
          city: scope.org.city,
          urgency: scope.request.urgency,
        },
        { now },
      );
      if (!eligibility.eligible) {
        if (eligibility.blockers.some((blocker) => blocker.includes("interval"))) {
          skippedMedicalInterval += 1;
        }
        continue;
      }
      const idempotencyKey = `${scope.request._id}:${donor._id}`;
      if (existingKeys.has(idempotencyKey)) continue;

      const donorPoint = cityCoords(donor.city);
      const distanceKm =
        donorPoint && orgPoint
          ? Math.round(haversineKm(donorPoint, orgPoint) * 10) / 10
          : 25;
      const daysSinceDonation = donor.lastDonationDate
        ? Math.max(
            0,
            Math.floor(
              (now - new Date(donor.lastDonationDate).getTime()) / 86_400_000,
            ),
          )
        : 365;
      const responses = responsesByProfile.get(String(donor._id));
      candidates.push({
        donorProfileId: donor._id,
        donorUserId: donor.userId,
        distanceKm,
        daysSinceDonation,
        previousDonations: donationsByProfile.get(String(donor._id)) ?? 0,
        priorResponseRate:
          responses && responses.total > 0
            ? Math.round((responses.accepted / responses.total) * 1000) / 1000
            : 0.5,
        idempotencyKey,
      });
    }

    candidates.sort((a, b) => a.distanceKm - b.distanceKm);
    const limited = candidates.slice(0, MAX_CANDIDATES);
    return {
      covered: false,
      shortfall: scope.shortfall,
      requestCode: scope.request.requestId,
      requestingOrgId: scope.org._id,
      organizationName: scope.org.name,
      organizationCity: scope.org.city,
      bloodGroup: scope.request.bloodGroup,
      component: scope.request.component,
      urgency: scope.request.urgency,
      isDemo: scope.request.isDemo ?? false,
      eligible: candidates.length,
      skippedNoConsent,
      skippedMedicalInterval,
      candidates: limited,
    };
  },
});

/**
 * Revalidates consent and deterministic eligibility before writing invitations.
 * Model scores are optional; when absent, the distance fallback is explicit and
 * no probability is fabricated.
 */
export const commitDonorEscalation = internalMutation({
  args: {
    requestId: v.id("bloodRequests"),
    actorUserId: v.id("users"),
    note: v.optional(v.string()),
    prepared: v.object({
      covered: v.boolean(),
      shortfall: v.number(),
      requestCode: v.string(),
      requestingOrgId: v.id("organizations"),
      organizationName: v.string(),
      organizationCity: v.string(),
      bloodGroup: v.string(),
      component: v.string(),
      urgency: v.string(),
      isDemo: v.boolean(),
      eligible: v.number(),
      skippedNoConsent: v.number(),
      skippedMedicalInterval: v.number(),
      candidates: v.array(candidateValidator),
    }),
    scores: v.array(scoreValidator),
    model: fallbackModelValidator,
    fallbackReason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<DonorEscalationResult> => {
    const scope = await assertRequestScope(ctx, args.requestId, args.actorUserId);
    if (scope.shortfall <= 0 || args.prepared.covered) {
      return {
        invited: 0,
        eligible: args.prepared.eligible,
        skippedNoConsent: args.prepared.skippedNoConsent,
        skippedMedicalInterval: args.prepared.skippedMedicalInterval,
        model: args.model,
        note: "Institutional supply already covers this request. Donors are not contacted.",
      };
    }

    const now = Date.now();
    const scoreByProfile = new Map(
      args.scores.map((score) => [String(score.donorProfileId), score]),
    );
    const donors = await ctx.db
      .query("donorProfiles")
      .withIndex("by_availability", (q) => q.eq("available", true))
      .collect();
    const donorById = new Map(donors.map((donor) => [String(donor._id), donor]));
    const consents = await ctx.db.query("donorConsents").collect();
    const consentByProfile = new Map(
      consents.map((consent) => [String(consent.donorProfileId), consent]),
    );
    const existing = await ctx.db.query("donorInvitations").collect();
    const existingKeys = new Set(existing.map((row) => row.idempotencyKey));

    const ranked = rankScoredDonors(
      args.prepared.candidates.map((candidate) => {
        const score = scoreByProfile.get(String(candidate.donorProfileId));
        return {
          ...candidate,
          responseProbability: score?.responseProbability ?? null,
          score,
        };
      }),
    );

    let invited = 0;
    for (const entry of ranked.slice(0, MAX_INVITES)) {
      if (existingKeys.has(entry.idempotencyKey)) continue;
      const donor = donorById.get(String(entry.donorProfileId));
      if (!donor) continue;
      const consent = consentByProfile.get(String(donor._id));
      const shareLocation =
        consent?.shareLocation === true &&
        consent.revokedAt == null &&
        consent.expiresAt > now;
      if (!shareLocation) continue;
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
          bloodGroup: args.prepared.bloodGroup as Doc<"bloodRequests">["bloodGroup"],
          component: args.prepared.component as Doc<"bloodRequests">["component"],
          city: args.prepared.organizationCity,
          urgency: args.prepared.urgency as Doc<"bloodRequests">["urgency"],
        },
        { now },
      );
      if (!eligibility.eligible) continue;

      const score = entry.score;
      await ctx.db.insert("donorInvitations", {
        requestId: args.requestId,
        requestingOrgId: args.prepared.requestingOrgId,
        donorUserId: entry.donorUserId,
        donorProfileId: entry.donorProfileId,
        bloodGroup: args.prepared.bloodGroup as Doc<"bloodRequests">["bloodGroup"],
        component: args.prepared.component as Doc<"bloodRequests">["component"],
        units: args.prepared.shortfall,
        distanceKm: entry.distanceKm,
        responseProbability: entry.responseProbability ?? undefined,
        responseModel: score ? "random_forest_donor_response" : args.model,
        responseModelVersion: score?.modelVersion ?? undefined,
        responseModelSynthetic: score?.synthetic ?? false,
        responseExplanation:
          score?.explanation ??
          args.fallbackReason ??
          "ML scoring was unavailable. Invitations were ordered by distance only.",
        predictedAt: score ? now : undefined,
        status: "sent",
        idempotencyKey: entry.idempotencyKey,
        createdAt: now,
      });
      await queueNotification(ctx, {
        userId: entry.donorUserId,
        title: `Donation invitation: ${args.prepared.bloodGroup} ${args.prepared.component.replace(/_/g, " ")}`,
        body: `${args.prepared.organizationName} in ${args.prepared.organizationCity} needs ${args.prepared.shortfall} unit(s). Institutional supply could not cover it. If you can donate, open your dashboard to accept — the collection centre is notified only after you accept.`,
        kind: "match",
        link: "/donor/dashboard",
        requestId: args.requestId,
        dedupeKey: `donor-invite:${entry.idempotencyKey}`,
        emailSubject: `Donation invitation near ${args.prepared.organizationCity}`,
      });
      invited += 1;
    }

    await audit(ctx, {
      actor: scope.actor,
      action: "donorFallback.invitations",
      entityType: "bloodRequest",
      entityId: args.prepared.requestCode,
      detail: `${invited} donor invitation(s) sent after institutional shortfall of ${args.prepared.shortfall} unit(s); model ${args.model}; ${args.prepared.skippedNoConsent} skipped for missing consent, ${args.prepared.skippedMedicalInterval} skipped for donation interval.${args.note ? ` ${args.note}` : ""}`,
      organizationId: args.prepared.requestingOrgId,
      isDemo: args.prepared.isDemo,
    });

    return {
      invited,
      eligible: args.prepared.eligible,
      skippedNoConsent: args.prepared.skippedNoConsent,
      skippedMedicalInterval: args.prepared.skippedMedicalInterval,
      model: args.model,
      note:
        invited === 0
          ? "No donors with active location consent were eligible. Institutional supply remains the only source."
          : "Donors are invited to donate. Blood is not counted as available until a licensed centre collects, screens and releases it.",
    };
  },
});

/**
 * Internal action shared by manual escalation and automatic allocation.
 * Failures are explicit: invitations can still be created, but no ML score is
 * stored and the invitation records say distance-only fallback was used.
 */
export const escalateForRequest = internalAction({
  args: {
    requestId: v.id("bloodRequests"),
    actorUserId: v.id("users"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<DonorEscalationResult> => {
    const prepared: PreparedDonorEscalation = await ctx.runQuery(
      internal.donorPrediction.prepareDonorEscalation,
      { requestId: args.requestId, actorUserId: args.actorUserId },
    );
    const scores: Array<{
      donorProfileId: Id<"donorProfiles">;
      responseProbability: number;
      modelVersion: string | null;
      synthetic: boolean;
      explanation: string;
    }> = [];
    let model: FallbackModel = "ml_not_configured";
    let fallbackReason: string | undefined =
      "ML_SERVICE_URL is not configured; invitations were ranked by distance only.";

    if (mlServiceConfigured() && prepared.candidates.length > 0) {
      try {
        const response = await mlFetch(
          "/v1/predict/donor/batch",
          {
            method: "POST",
            body: JSON.stringify({
              donors: prepared.candidates.map((candidate) => ({
                donor_id: String(candidate.donorProfileId),
                distance_km: candidate.distanceKm,
                days_since_donation: candidate.daysSinceDonation,
                previous_donations: candidate.previousDonations,
                prior_response_rate: candidate.priorResponseRate,
                consented: true,
              })),
            }),
          },
          { timeoutMs: 12_000, attempts: 2 },
        );
        const payload = (await response.json()) as {
          model_ready?: boolean;
          results?: Array<{
            donor_id?: string;
            status?: string;
            response_probability?: number | null;
            model_version?: string | null;
            synthetic_training_data?: boolean;
            explanation?: string;
          }>;
        };
        if (!response.ok) {
          fallbackReason = `ML donor service returned HTTP ${response.status}; distance-only ordering was used.`;
        } else if (!payload.model_ready) {
          fallbackReason = "ML donor model is unavailable; distance-only ordering was used.";
        } else {
          const byId = new Map(
            (payload.results ?? [])
              .filter((row) => row.donor_id)
              .map((row) => [row.donor_id!, row]),
          );
          for (const candidate of prepared.candidates) {
            const row = byId.get(String(candidate.donorProfileId));
            if (row?.status !== "ok" || typeof row.response_probability !== "number") {
              continue;
            }
            scores.push({
              donorProfileId: candidate.donorProfileId,
              responseProbability: Math.min(1, Math.max(0, row.response_probability)),
              modelVersion: row.model_version ?? null,
              synthetic: row.synthetic_training_data === true,
              explanation:
                row.explanation ??
                "Random Forest response likelihood; not a medical eligibility decision.",
            });
          }
          if (scores.length > 0) {
            model = "python_random_forest";
            fallbackReason = undefined;
          } else {
            fallbackReason = "ML service returned no usable donor scores; distance-only ordering was used.";
          }
        }
      } catch (error) {
        fallbackReason = `ML donor service failed (${
          error instanceof Error ? error.message : "network error"
        }); distance-only ordering was used.`;
      }
    } else if (!mlServiceConfigured()) {
      fallbackReason = "ML_SERVICE_URL is not configured; invitations were ranked by distance only.";
    }

    return await ctx.runMutation(
      internal.donorPrediction.commitDonorEscalation,
      {
        requestId: args.requestId,
        actorUserId: args.actorUserId,
        note: args.note,
        prepared,
        scores,
        model: scores.length > 0 ? "python_random_forest" : model,
        fallbackReason,
      },
    );
  },
});
