import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  audit,
  nextSequentialId,
  optionalUser,
  requireAdmin,
  requireStaff,
  requireUser,
  roleOf,
  safeError,
  type AppUser,
} from "./lib/helpers";
import {
  authorizeSupplySideTransfer,
  authorizeReceiptSideTransfer,
  authorizeRequestSideTransfer,
  authorizeTransferOwnershipOrStaff,
} from "./lib/vault";
import { evaluateStockLevel } from "./lib/stockWatch";
import { queueForOrganization } from "./lib/messaging";
import {
  computeShortage,
  planAllocation,
  rankCandidates,
  type BatchCandidate,
  type GeoPoint,
  type RankedCandidate,
  type SupplyNeed,
  type SupplyScope,
} from "../lib/supply";
import { cityCoords, compatibility } from "../lib/blood";
import { reconcileRequestReceipt, requestCoverage } from "./lib/requestLifecycle";
import type { DonorEscalationResult } from "./donorPrediction";

type AllocationCoreResult = {
  allocated: number;
  shortfall: number;
  transfers: Array<{
    transferId: string;
    supplyingOrgId: string;
    supplyingName: string;
    units: number;
  }>;
  invitations: null;
  donorNeed: {
    requestId: Id<"bloodRequests">;
    actorUserId: Id<"users">;
  } | null;
  applied?: Array<{ batchId: string; units: number }>;
  message: string;
};

type AutoAllocateResult = Omit<AllocationCoreResult, "invitations" | "donorNeed"> & {
  invitations: DonorEscalationResult | null;
  donorNeed?: AllocationCoreResult["donorNeed"];
  donorFallbackError: string | null;
};

const scopeValidator = v.union(
  v.literal("city"),
  v.literal("district"),
  v.literal("state"),
  v.literal("country"),
);

const OPEN_FOR_ALLOCATION = new Set([
  "pending",
  "under_verification",
  "approved",
  "partially_fulfilled",
]);
const todayIso = () => new Date().toISOString().slice(0, 10);

function orgPoint(org: Doc<"organizations"> | null | undefined): GeoPoint | null {
  if (!org) return null;
  if (org.latitude != null && org.longitude != null) {
    return { lat: org.latitude, lng: org.longitude };
  }
  return cityCoords(org.city);
}

type ResolvedNeed = {
  request: Doc<"bloodRequests"> | null;
  need: SupplyNeed;
  requesterOrg: Doc<"organizations"> | null;
  requesterPoint: GeoPoint | null;
  remainingUnits: number;
  activeReserved: number;
  verifiedReceived: number;
};

async function resolveNeed(
  ctx: QueryCtx | MutationCtx,
  user: AppUser,
  args: {
    requestId?: Id<"bloodRequests">;
    bloodGroup?: Doc<"bloodRequests">["bloodGroup"];
    component?: Doc<"bloodRequests">["component"];
    units?: number;
    city?: string;
    urgency?: Doc<"bloodRequests">["urgency"];
    scope?: SupplyScope;
    maxDistanceKm?: number;
  },
): Promise<ResolvedNeed> {
  if (args.requestId) {
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found.");
    const role = roleOf(user);
    const canView =
      role === "admin" ||
      role === "red_cross" ||
      (user.organizationId != null && request.hospitalOrgId === user.organizationId);
    if (!canView) throw new Error("You are not authorized to allocate for this request.");
    const requesterOrg = request.hospitalOrgId
      ? await ctx.db.get(request.hospitalOrgId)
      : null;
    const coverage = await requestCoverage(ctx, request);
    return {
      request,
      need: {
        bloodGroup: request.bloodGroup,
        component: request.component,
        units: request.units,
        city: request.city,
        urgency: request.urgency,
        scope: args.scope ?? (request.urgency === "emergency" ? "state" : "city"),
        maxDistanceKm: args.maxDistanceKm ?? 75,
      },
      requesterOrg,
      requesterPoint: orgPoint(requesterOrg) ?? cityCoords(request.city),
      remainingUnits: coverage.remainingUnits,
      activeReserved: coverage.reservedUnits,
      verifiedReceived: coverage.receivedUnits,
    };
  }

  if (!args.bloodGroup || !args.component || !args.units || !args.city || !args.urgency) {
    throw new Error("Choose a request or provide blood group, component, units, city and urgency.");
  }
  const requesterOrg = user.organizationId
    ? await ctx.db.get(user.organizationId)
    : null;
  return {
    request: null,
    need: {
      bloodGroup: args.bloodGroup,
      component: args.component,
      units: args.units,
      city: args.city,
      urgency: args.urgency,
      scope: args.scope ?? (args.urgency === "emergency" ? "state" : "city"),
      maxDistanceKm: args.maxDistanceKm ?? 75,
    },
    requesterOrg,
    requesterPoint: orgPoint(requesterOrg) ?? cityCoords(args.city),
    remainingUnits: Math.max(0, Math.round(args.units)),
    activeReserved: 0,
    verifiedReceived: 0,
  };
}

type BuiltCandidates = {
  ranked: RankedCandidate[];
  authorizedRanked: RankedCandidate[];
  organizations: Map<Id<"organizations">, Doc<"organizations">>;
};

async function buildCandidates(
  ctx: QueryCtx | MutationCtx,
  resolved: ResolvedNeed,
): Promise<BuiltCandidates> {
  const organizations = new Map(
    (await ctx.db.query("organizations").collect())
      .filter((o) => o.status === "verified")
      .map((o) => [o._id, o]),
  );
  const agreements = (await ctx.db.query("transferAgreements").collect()).filter(
    (a) => a.status === "active" && a.requestingOrgId === resolved.requesterOrg?._id,
  );
  const agreementBySupplier = new Map(agreements.map((a) => [a.supplyingOrgId, a]));

  const inventory = await ctx.db.query("inventory").collect();
  const batches: BatchCandidate[] = [];
  for (const item of inventory) {
    if (item.component !== resolved.need.component) continue;
    const org = organizations.get(item.organizationId);
    if (!org) continue;
    batches.push({
      id: String(item._id),
      organizationId: String(org._id),
      organizationName: org.name,
      city: org.city,
      point: orgPoint(org),
      bloodGroup: item.bloodGroup,
      component: item.component,
      unitsAvailable: item.unitsAvailable,
      unitsReserved: item.unitsReserved,
      protectedReserve: Math.max(0, item.protectedReserve ?? org.protectedReserveDefault ?? 0),
      expiryDate: item.expiryDate,
      verified: item.verified,
      // Existing verified batches predate the release columns and are treated
      // as released. Imported batches must set these explicitly.
      screened: item.screened ?? true,
      released: item.released ?? true,
      isDemo: (item.isDemo ?? false) || (org.isDemo ?? false),
    });
  }

  const ranked = rankCandidates(batches, resolved.need, {
    today: todayIso(),
    needPoint: resolved.requesterPoint,
  });

  const authorizedRanked = ranked.filter((entry) => {
    if (String(entry.candidate.organizationId) === String(resolved.requesterOrg?._id)) return false;
    const org = organizations.get(entry.candidate.organizationId as Id<"organizations">);
    if (!org) return false;
    const agreement = agreementBySupplier.get(org._id);
    if (agreement?.autoAllocate) return true;
    return org.autoAllocate === true && org.transferAuthorized === true;
  });

  return { ranked, authorizedRanked, organizations };
}

/**
 * Geospatial institutional search. Advisory only: every result carries the
 * deterministic reasons and blockers used to rank it, and expired, unreleased
 * or protected units are excluded before distance is ever considered.
 */
export const searchSupply = query({
  args: {
    requestId: v.optional(v.id("bloodRequests")),
    bloodGroup: v.optional(
      v.union(
        v.literal("A+"),
        v.literal("A-"),
        v.literal("B+"),
        v.literal("B-"),
        v.literal("AB+"),
        v.literal("AB-"),
        v.literal("O+"),
        v.literal("O-"),
      ),
    ),
    component: v.optional(
      v.union(
        v.literal("whole_blood"),
        v.literal("red_cells"),
        v.literal("platelets"),
        v.literal("plasma"),
      ),
    ),
    units: v.optional(v.number()),
    city: v.optional(v.string()),
    urgency: v.optional(
      v.union(v.literal("routine"), v.literal("urgent"), v.literal("emergency")),
    ),
    scope: v.optional(scopeValidator),
    maxDistanceKm: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const resolved = await resolveNeed(ctx, user, args);
    if (resolved.request && !OPEN_FOR_ALLOCATION.has(resolved.request.status)) {
      throw new Error("This request is closed; institutional search is no longer needed.");
    }
    const { ranked, authorizedRanked, organizations } = await buildCandidates(ctx, resolved);

    const eligible = ranked.filter((entry) => entry.eligibility.eligible);
    const eligibleUnits = eligible.reduce((sum, entry) => sum + entry.eligibility.usableUnits, 0);
    const authorizedEligible = authorizedRanked.filter((e) => e.eligibility.eligible);
    const authorizedUnits = authorizedEligible.reduce(
      (sum, entry) => sum + entry.eligibility.usableUnits,
      0,
    );
    const plan = planAllocation(authorizedRanked, resolved.remainingUnits);

    const requesterOrgId = resolved.requesterOrg?._id;
    const agreementSuppliers = new Set(
      (await ctx.db.query("transferAgreements").collect())
        .filter((a) => a.status === "active" && a.requestingOrgId === requesterOrgId)
        .filter((a) => a.autoAllocate)
        .map((a) => String(a.supplyingOrgId)),
    );

    return {
      need: {
        ...resolved.need,
        requestId: resolved.request?._id ?? null,
        requestCode: resolved.request?.requestId ?? null,
        remainingUnits: resolved.remainingUnits,
        activeReserved: resolved.activeReserved,
      },
      requester: resolved.requesterOrg
        ? {
            name: resolved.requesterOrg.name,
            city: resolved.requesterOrg.city,
            type: resolved.requesterOrg.type,
          }
        : null,
      candidates: ranked.slice(0, 30).map((entry) => {
        const org = organizations.get(entry.candidate.organizationId as Id<"organizations">);
        const autoAuthorized =
          org != null &&
          org._id !== requesterOrgId &&
          (agreementSuppliers.has(String(org._id)) ||
            (org.autoAllocate === true && org.transferAuthorized === true));
        return {
          batchId: entry.candidate.id,
          organizationId: entry.candidate.organizationId,
          organizationName: entry.candidate.organizationName,
          organizationType: org?.type ?? null,
          city: entry.candidate.city,
          latitude: org?.latitude ?? cityCoords(entry.candidate.city)?.lat ?? null,
          longitude: org?.longitude ?? cityCoords(entry.candidate.city)?.lng ?? null,
          bloodGroup: entry.candidate.bloodGroup,
          component: entry.candidate.component,
          usableUnits: entry.eligibility.usableUnits,
          expiryDate: entry.candidate.expiryDate,
          distanceKm: entry.eligibility.distanceKm,
          tier: entry.eligibility.tier,
          score: entry.score,
          eligible: entry.eligibility.eligible,
          autoAuthorized,
          reasons: entry.eligibility.reasons,
          blockers: entry.eligibility.blockers,
          warnings: entry.warnings,
          isDemo: entry.candidate.isDemo,
        };
      }),
      preview: plan,
      coverage: {
        ...computeShortage(resolved.remainingUnits, eligibleUnits),
        authorizedUnits,
        eligibleSources: eligible.length,
        evaluatedSources: ranked.length,
        expiredOrBlocked: ranked.length - eligible.length,
      },
      scopePolicy: {
        requested: resolved.need.scope,
        urgency: resolved.need.urgency,
        note:
          resolved.need.urgency === "emergency"
            ? "Emergency scope may widen from city to district, state and country."
            : "Routine and urgent searches stay inside the requesting city; only emergencies may widen.",
      },
      generatedAt: Date.now(),
      disclaimer:
        "Allocation eligibility is deterministic and rules-based. A reservation is not a clinical release; cross-matching, screening and the final issue decision remain with qualified staff.",
    };
  },
});

export const currentAllocationActor = internalQuery({
  args: { requestId: v.id("bloodRequests") },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found.");
    if (roleOf(user) !== "admin" && user.organizationId !== request.hospitalOrgId) {
      throw new Error("Only the requesting hospital can run automatic allocation.");
    }
    return { actorUserId: user._id };
  },
});

/**
 * Automatic institutional allocation. Reserves eligible units atomically across
 * one or more pre-authorised facilities. Convex mutations are serializable, so
 * concurrent requests cannot reserve the same unit twice; the batch free count
 * is re-checked immediately before every write.
 *
 * Donor contact is deliberately outside this transaction. The public action
 * below scores already-eligible, consented donors through the Python service
 * and writes invitations only after the reservation is committed.
 */
export const autoAllocateCore = internalMutation({
  args: {
    requestId: v.id("bloodRequests"),
    actorUserId: v.id("users"),
    scope: v.optional(scopeValidator),
    maxDistanceKm: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AllocationCoreResult> => {
    const user = await ctx.db.get(args.actorUserId);
    if (!user || user.suspended || !["red_cross", "hospital", "admin"].includes(roleOf(user))) {
      throw new Error("Only authorised facility staff can run automatic allocation.");
    }
    const resolved = await resolveNeed(ctx, user, args);
    const request = resolved.request!;
    const role = roleOf(user);
    if (role !== "admin" && user.organizationId !== request.hospitalOrgId) {
      throw new Error("Only the requesting hospital can run automatic allocation.");
    }
    if (!OPEN_FOR_ALLOCATION.has(request.status)) {
      throw new Error("This request is already closed or fulfilled.");
    }
    if (
      request.source === "requestor" &&
      request.status !== "approved" &&
      request.status !== "partially_fulfilled"
    ) {
      throw new Error(
        "Patient-originated requests must be verified before stock is reserved. Institutional reserves do not bypass that check.",
      );
    }
    if (!resolved.requesterOrg) {
      throw new Error("The requesting facility could not be resolved.");
    }
    if (resolved.remainingUnits <= 0) {
      return {
        allocated: 0,
        shortfall: 0,
        transfers: [],
        invitations: null,
        donorNeed: null,
        message: "This request is already fully reserved.",
      };
    }

    const { authorizedRanked } = await buildCandidates(ctx, resolved);
    const plan = planAllocation(authorizedRanked, resolved.remainingUnits);
    if (plan.allocations.length === 0) {
      // No authorised institutional stock. Donors are contacted by the public
      // action only after this reservation transaction commits.
      await ctx.db.insert("requestStatusHistory", {
        requestId: request._id,
        status: request.status,
        actorUserId: user._id,
        actorRole: role,
        note: "Automatic institutional allocation found no authorised supply. Donor eligibility evaluation is queued; donors are not counted as stock.",
        isDemo: request.isDemo,
        createdAt: Date.now(),
      });
      return {
        allocated: 0,
        shortfall: resolved.remainingUnits,
        transfers: [],
        invitations: null,
        donorNeed: { requestId: request._id, actorUserId: user._id },
        message:
          "No pre-authorised institutional supply was available. Donor eligibility evaluation is queued.",
      };
    }

    const now = Date.now();
    const transferGroups = new Map<
      string,
      {
        supplyingOrgId: Id<"organizations">;
        bloodGroup: Doc<"bloodRequests">["bloodGroup"];
        agreementId?: Id<"transferAgreements">;
        lines: typeof plan.allocations;
        reservationIds: Id<"inventoryReservations">[];
        units: number;
      }
    >();
    const applied: Array<{ batchId: string; units: number }> = [];
    let allocated = 0;

    for (const line of plan.allocations) {
      const batch = await ctx.db.get(line.candidateId as Id<"inventory">);
      if (!batch) continue;
      const org = await ctx.db.get(batch.organizationId);
      if (!org) continue;
      const protectedReserve = Math.max(
        0,
        batch.protectedReserve ?? org.protectedReserveDefault ?? 0,
      );
      const free = batch.unitsAvailable - batch.unitsReserved - protectedReserve;
      const take = Math.min(line.units, free);
      if (take <= 0) continue;
      if (batch.expiryDate < todayIso()) continue;
      if (!batch.verified || (batch.screened === false) || (batch.released === false)) continue;

      await ctx.db.patch(batch._id, {
        unitsReserved: batch.unitsReserved + take,
        lastUpdated: now,
      });
      const reservationId = await ctx.db.insert("inventoryReservations", {
        inventoryId: batch._id,
        organizationId: batch.organizationId,
        requestId: request._id,
        units: take,
        status: "active",
        actorUserId: user._id,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("inventoryTransactions", {
        inventoryId: batch._id,
        organizationId: batch.organizationId,
        type: "reserve",
        units: take,
        bloodGroup: batch.bloodGroup,
        component: batch.component,
        requestId: request._id,
        actorUserId: user._id,
        actorRole: role,
        note: `Automatic network reservation for ${request.requestId}`,
        isDemo: batch.isDemo,
        createdAt: now,
      });

      const agreement = (
        await ctx.db.query("transferAgreements").collect()
      ).find(
        (a) =>
          a.requestingOrgId === resolved.requesterOrg!._id &&
          a.supplyingOrgId === org._id &&
          a.status === "active" &&
          a.autoAllocate,
      );
      // One transfer per supplier and verified source group. This keeps the
      // receiving label, compatibility check and inventory credit unambiguous.
      const key = `${String(org._id)}:${batch.bloodGroup}`;
      const group = transferGroups.get(key) ?? {
        supplyingOrgId: org._id,
        bloodGroup: batch.bloodGroup,
        agreementId: agreement?._id,
        lines: [],
        reservationIds: [],
        units: 0,
      };
      group.lines.push({ ...line, units: take });
      group.reservationIds.push(reservationId);
      group.units += take;
      transferGroups.set(key, group);
      applied.push({ batchId: String(batch._id), units: take });
      allocated += take;
    }

    const transferResults: Array<{
      transferId: string;
      supplyingOrgId: string;
      supplyingName: string;
      units: number;
    }> = [];
    for (const group of transferGroups.values()) {
      const supplier = await ctx.db.get(group.supplyingOrgId);
      const transferId = await nextSequentialId(ctx, "transfer", "TRF");
      await ctx.db.insert("transfers", {
        transferId,
        requestId: request._id,
        requestingOrgId: resolved.requesterOrg._id,
        supplyingOrgId: group.supplyingOrgId,
        bloodGroup: group.bloodGroup,
        component: request.component,
        units: group.units,
        status: "reserved",
        reservationIds: group.reservationIds,
        agreementId: group.agreementId,
        auto: true,
        initiatedByUserId: user._id,
        note: args.note,
        createdAt: now,
        updatedAt: now,
      });
      await queueForOrganization(ctx, group.supplyingOrgId, {
        title: `Transfer ${transferId} reserved: ${request.bloodGroup}`,
        body: `${resolved.requesterOrg.name} automatically reserved ${group.units} unit(s) of ${request.bloodGroup} ${request.component.replace(/_/g, " ")} under your transfer agreement. Release confirmation is still required.`,
        kind: "inventory",
        dedupeKey: `transfer-reserved:${transferId}`,
        link: "/supply",
      });
      transferResults.push({
        transferId,
        supplyingOrgId: String(group.supplyingOrgId),
        supplyingName: supplier?.name ?? "Supplying facility",
        units: group.units,
      });
    }

    await queueForOrganization(ctx, resolved.requesterOrg._id, {
      title: `Automatic allocation: ${allocated}/${resolved.remainingUnits} unit(s) reserved`,
      body:
        allocated >= resolved.remainingUnits
          ? `Units are reserved across ${transferResults.length} facilit${transferResults.length === 1 ? "y" : "ies"}. Dispatch and delivery still require staff confirmation.`
          : `Only ${allocated} of ${resolved.remainingUnits} remaining unit(s) could be reserved. The institutional shortfall is being escalated to donors.`,
      kind: "request",
      dedupeKey: `auto-allocation:${request._id}:${allocated}:${now}`,
      requestId: request._id,
      link: "/supply",
    });

    await ctx.db.insert("requestStatusHistory", {
      requestId: request._id,
      status: request.status,
      actorUserId: user._id,
      actorRole: role,
      note:
        args.note ??
        `Automatic allocation reserved ${allocated} unit(s) of ${request.bloodGroup} ${request.component} across ${transferResults.length} facility(ies). Clinical release is still required.`,
      isDemo: request.isDemo,
      createdAt: now,
    });

    await audit(ctx, {
      actor: user,
      action: "allocation.auto",
      entityType: "bloodRequest",
      entityId: request.requestId,
      detail: `Reserved ${allocated} unit(s) from ${transferResults.map((t) => `${t.supplyingName} (${t.units})`).join(", ") || "no facility"}. Shortfall ${Math.max(0, resolved.remainingUnits - allocated)}.`,
      organizationId: resolved.requesterOrg._id,
      isDemo: request.isDemo,
    });

    const remainingAfter = Math.max(0, resolved.remainingUnits - allocated);

    return {
      allocated,
      shortfall: remainingAfter,
      transfers: transferResults,
      invitations: null,
      donorNeed:
        remainingAfter > 0
          ? { requestId: request._id, actorUserId: user._id }
          : null,
      applied,
      message:
        remainingAfter === 0
          ? "Institutional supply covers the remaining need. Dispatch and clinical release still require staff action."
          : `Institutional shortfall of ${remainingAfter} unit(s). Donor eligibility evaluation is queued; donors are not counted as stock.`,
    };
  },
});

/**
 * Public allocation entry point. Stock is committed first; donor invitations are
 * created afterwards and only from deterministically eligible, consented donors.
 * If ML scoring is unavailable, invitations use an explicit distance-only
 * fallback and no probability is fabricated.
 */
export const autoAllocate = action({
  args: {
    requestId: v.id("bloodRequests"),
    scope: v.optional(scopeValidator),
    maxDistanceKm: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AutoAllocateResult> => {
    const { actorUserId } = await ctx.runQuery(
      internal.allocation.currentAllocationActor,
      { requestId: args.requestId },
    );
    const result = await ctx.runMutation(internal.allocation.autoAllocateCore, {
      ...args,
      actorUserId,
    });
    if (!result.donorNeed) {
      return { ...result, donorFallbackError: null };
    }
    try {
      const invitations = await ctx.runAction(
        internal.donorPrediction.escalateForRequest,
        {
          requestId: result.donorNeed.requestId,
          actorUserId: result.donorNeed.actorUserId,
          note: args.note,
        },
      );
      return {
        ...result,
        invitations,
        donorFallbackError: null,
        message:
          result.shortfall > 0
            ? `Institutional shortfall of ${result.shortfall} unit(s). ${invitations.invited} donor invitation(s) evaluated; donors are not counted as stock.`
            : result.message,
      };
    } catch (error) {
      return {
        ...result,
        invitations: null,
        donorFallbackError:
          error instanceof Error ? error.message : "Donor fallback failed.",
        message: `${result.message} Donor fallback could not be queued: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      };
    }
  },
});

export const transfersForMe = query({
  args: {},
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return [];
    const role = roleOf(user);
    const all = await ctx.db.query("transfers").collect();
    const orgId = user.organizationId;
    const scoped = all.filter(
      (t) =>
        role === "admin" ||
        role === "drone_ops" ||
        (orgId != null && (t.requestingOrgId === orgId || t.supplyingOrgId === orgId)),
    );
    const orgs = await ctx.db.query("organizations").collect();
    const orgById = new Map(orgs.map((o) => [o._id, o]));
    const requests = await ctx.db.query("bloodRequests").collect();
    const requestById = new Map(requests.map((r) => [r._id, r]));
    // Older transfers stored the request group rather than the actual source
    // batch group. Resolve the verified source label for the receipt dialog.
    const reservations = await ctx.db.query("inventoryReservations").collect();
    const reservationById = new Map(reservations.map((row) => [row._id, row]));
    const inventory = await ctx.db.query("inventory").collect();
    const batchById = new Map(inventory.map((batch) => [batch._id, batch]));
    const missions = await ctx.db.query("droneMissions").collect();
    const missionByTransfer = new Map(
      missions.filter((m) => m.transferId).map((m) => [String(m.transferId), m]),
    );

    return scoped
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50)
      .map((transfer) => {
        const requesting = orgById.get(transfer.requestingOrgId);
        const supplying = orgById.get(transfer.supplyingOrgId);
        const request = transfer.requestId ? requestById.get(transfer.requestId) : null;
        const mission = missionByTransfer.get(String(transfer._id));
        const isSupplier = orgId != null && transfer.supplyingOrgId === orgId;
        const sourceGroups = new Set(
          transfer.reservationIds
            .map((id) => reservationById.get(id)?.inventoryId)
            .filter((id): id is Id<"inventory"> => id != null)
            .map((id) => batchById.get(id)?.bloodGroup)
            .filter((group): group is Doc<"inventory">["bloodGroup"] => group != null),
        );
        return {
          _id: transfer._id,
          transferId: transfer.transferId,
          requestCode: request?.requestId ?? null,
          requestId: transfer.requestId ?? null,
          bloodGroup: transfer.bloodGroup,
          sourceBloodGroup: sourceGroups.size === 1 ? [...sourceGroups][0] : transfer.bloodGroup,
          component: transfer.component,
          units: transfer.units,
          status: transfer.status,
          auto: transfer.auto,
          createdAt: transfer.createdAt,
          updatedAt: transfer.updatedAt,
          requestedBy: requesting?.name ?? "Requesting facility",
          requestedByCity: requesting?.city ?? null,
          requestedByPhone: requesting?.phone ?? null,
          suppliedBy: supplying?.name ?? "Supplying facility",
          suppliedByCity: supplying?.city ?? null,
          suppliedByPhone: supplying?.phone ?? null,
          isSupplier,
          isDemo: (request?.isDemo ?? false) || (requesting?.isDemo ?? false),
          mission: mission
            ? {
                _id: mission._id,
                missionId: mission.missionId,
                state: mission.state,
                simulated: mission.simulated,
              }
            : null,
        };
      });
  },
});

/** Supplying facility confirms physical release and dispatch. */
export const dispatchTransfer = mutation({
  args: { transferId: v.id("transfers"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const transfer = await ctx.db.get(args.transferId);
    if (!transfer) throw safeError("Transfer not found.");
    await authorizeSupplySideTransfer(ctx, user, transfer);
    const role = roleOf(user);
    if (!["reserved", "approved"].includes(transfer.status)) {
      throw safeError(
        `Transfer cannot be dispatched from status ${transfer.status}.`,
      );
    }

    const now = Date.now();
    const consumed: string[] = [];
    let released = 0;
    for (const reservationId of transfer.reservationIds) {
      const reservation = await ctx.db.get(reservationId);
      if (!reservation || reservation.status !== "active") continue;
      const batch = await ctx.db.get(reservation.inventoryId);
      if (!batch || batch.organizationId !== transfer.supplyingOrgId) continue;
      const take = Math.min(reservation.units, transfer.units - released);
      if (take <= 0) break;
      if (batch.unitsAvailable < take || batch.unitsReserved < take) {
        throw new Error(
          `Batch ${batch.batchRef} is inconsistent with its reservation. Refresh inventory before dispatch.`,
        );
      }
      await ctx.db.patch(batch._id, {
        unitsAvailable: batch.unitsAvailable - take,
        unitsReserved: batch.unitsReserved - take,
        lastUpdated: now,
      });
      await ctx.db.insert("inventoryTransactions", {
        inventoryId: batch._id,
        organizationId: batch.organizationId,
        type: "dispatch",
        units: take,
        bloodGroup: batch.bloodGroup,
        component: batch.component,
        requestId: transfer.requestId,
        actorUserId: user._id,
        actorRole: role,
        note: args.note ?? `Dispatched under ${transfer.transferId}`,
        isDemo: batch.isDemo,
        createdAt: now,
      });
      await ctx.db.patch(reservation._id, {
        units: reservation.units - take,
        status: reservation.units - take === 0 ? "consumed" : "active",
        updatedAt: now,
      });
      consumed.push(`${batch.batchRef} (${take})`);
      released += take;
    }
    if (released < transfer.units) {
      throw new Error(
        `Only ${released} of ${transfer.units} reserved unit(s) could be released. Refresh and retry.`,
      );
    }

    const supplier = await ctx.db.get(transfer.supplyingOrgId);
    await ctx.db.patch(transfer._id, {
      status: "dispatched",
      dispatchedAt: now,
      updatedAt: now,
      note: args.note ?? transfer.note,
    });
    // Dispatching consumes real stock, so the supplier's threshold is re-checked.
    if (supplier) {
      await evaluateStockLevel(ctx, supplier, transfer.bloodGroup, transfer.component);
    }
    await queueForOrganization(ctx, transfer.requestingOrgId, {
      title: `Transfer ${transfer.transferId} dispatched`,
      body: `${supplier?.name ?? "Supplying facility"} released ${transfer.units} unit(s) of ${transfer.bloodGroup} ${transfer.component.replace(/_/g, " ")}. Confirm receipt when the shipment arrives.`,
      kind: "request",
      dedupeKey: `transfer-dispatched:${transfer._id}`,
      requestId: transfer.requestId,
      link: "/supply",
    });
    await audit(ctx, {
      actor: user,
      action: "transfer.dispatched",
      entityType: "transfer",
      entityId: transfer.transferId,
      detail: `Dispatched ${consumed.join(", ")} to ${transfer.requestingOrgId}.`,
      organizationId: transfer.supplyingOrgId,
    });
    return { ok: true, units: released };
  },
});

/**
 * Receiving facility confirms custody and clinically verifies the delivered
 * units. The inventory credit and request reconciliation happen atomically.
 * A retry returns the original receipt without writing inventory again.
 */
export const receiveTransfer = mutation({
  args: {
    transferId: v.id("transfers"),
    receivedUnits: v.number(),
    verifiedBloodGroup: v.union(
      v.literal("A+"),
      v.literal("A-"),
      v.literal("B+"),
      v.literal("B-"),
      v.literal("AB+"),
      v.literal("AB-"),
      v.literal("O+"),
      v.literal("O-"),
    ),
    verifiedComponent: v.union(
      v.literal("whole_blood"),
      v.literal("red_cells"),
      v.literal("platelets"),
      v.literal("plasma"),
    ),
    verification: v.object({
      labelVerified: v.boolean(),
      screeningAndReleaseConfirmed: v.boolean(),
      temperatureOk: v.boolean(),
      packagingIntact: v.boolean(),
      crossMatchConfirmed: v.boolean(),
    }),
    note: v.optional(v.string()),
    evidenceCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const transfer = await ctx.db.get(args.transferId);
    if (!transfer) throw safeError("Transfer not found.");
    await authorizeReceiptSideTransfer(ctx, user, transfer);
    const role = roleOf(user);
    const org = await ctx.db.get(transfer.requestingOrgId);
    if (!org || org.status !== "verified") {
      throw safeError("The receiving facility is not a verified organization.");
    }

    // Idempotency: a network retry must never create a second inventory batch.
    const existingReceipt = await ctx.db
      .query("transferReceipts")
      .withIndex("by_transfer", (q) => q.eq("transferId", transfer._id))
      .first();
    if (existingReceipt) {
      const request = transfer.requestId ? await ctx.db.get(transfer.requestId) : null;
      return {
        ok: true,
        duplicate: true,
        receiptId: existingReceipt._id,
        receiptBatchId: existingReceipt.inventoryId,
        receivedUnits: existingReceipt.units,
        requestStatus: request?.status ?? null,
      };
    }
    if (transfer.status === "failed") {
      throw new Error("A failed transfer cannot be received or credited.");
    }
    if (transfer.status === "cancelled") {
      throw new Error("A cancelled transfer cannot be received or credited.");
    }
    if (!["dispatched", "in_transit"].includes(transfer.status)) {
      throw new Error("Only a dispatched or in-transit transfer can be received.");
    }
    if (!Number.isInteger(args.receivedUnits) || args.receivedUnits < 1) {
      throw new Error("Received units must be a whole number of at least 1.");
    }
    if (args.receivedUnits > transfer.units) {
      throw new Error(
        `Received units cannot exceed the ${transfer.units} unit(s) dispatched on ${transfer.transferId}.`,
      );
    }
    if (!Object.values(args.verification).every(Boolean)) {
      throw new Error(
        "Receipt verification is incomplete. Confirm the label, screening/release, temperature, packaging and cross-match checks.",
      );
    }

    const request = transfer.requestId ? await ctx.db.get(transfer.requestId) : null;
    if (transfer.requestId && !request) {
      throw new Error("The linked blood request could not be found.");
    }
    if (request) {
      if (request.status === "cancelled" || request.status === "rejected") {
        throw new Error(`A ${request.status} request cannot receive or fulfil blood stock.`);
      }
      if (args.verifiedComponent !== request.component) {
        throw new Error("The verified component does not match the blood request.");
      }
      const compat = compatibility(
        args.verifiedBloodGroup,
        request.bloodGroup,
        request.component,
      );
      if (!compat.compatible) {
        throw new Error(`The verified blood group is not compatible with the request. ${compat.note}`);
      }
    }

    const sourceBatches = [];
    const seenBatches = new Set<string>();
    for (const reservationId of transfer.reservationIds) {
      const reservation = await ctx.db.get(reservationId);
      if (!reservation) continue;
      const batch = await ctx.db.get(reservation.inventoryId);
      if (!batch || seenBatches.has(String(batch._id))) continue;
      seenBatches.add(String(batch._id));
      sourceBatches.push(batch);
    }
    if (sourceBatches.length === 0) {
      throw new Error("The dispatched source batches could not be resolved for verification.");
    }
    const sourceGroups = new Set(sourceBatches.map((batch) => batch.bloodGroup));
    if (sourceGroups.size !== 1) {
      throw new Error(
        "This transfer contains mixed blood groups. Split the receipt by verified group before crediting inventory.",
      );
    }
    const sourceGroup = sourceBatches[0].bloodGroup;
    if (
      sourceBatches.some(
        (batch) =>
          batch.organizationId !== transfer.supplyingOrgId ||
          batch.component !== transfer.component ||
          !batch.verified ||
          batch.screened === false ||
          batch.released === false,
      )
    ) {
      throw new Error(
        "The source batches do not satisfy the dispatch, component, screening or release conditions.",
      );
    }
    if (args.verifiedBloodGroup !== sourceGroup) {
      throw new Error(
        `The verified blood group ${args.verifiedBloodGroup} does not match the dispatched batch group ${sourceGroup}.`,
      );
    }
    if (args.verifiedComponent !== transfer.component) {
      throw new Error(
        `The verified component ${args.verifiedComponent} does not match the dispatched component ${transfer.component}.`,
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    if (sourceBatches.some((batch) => batch.expiryDate < today)) {
      throw new Error("An expired source batch cannot be credited on receipt.");
    }

    const now = Date.now();
    const earliestExpiry = [...sourceBatches].map((batch) => batch.expiryDate).sort()[0];
    const earliestCollection = [...sourceBatches]
      .map((batch) => batch.collectionDate)
      .sort()[0];
    const receiptBatchId = await ctx.db.insert("inventory", {
      organizationId: transfer.requestingOrgId,
      bloodGroup: args.verifiedBloodGroup,
      component: args.verifiedComponent,
      unitsAvailable: args.receivedUnits,
      unitsReserved: 0,
      collectionDate: earliestCollection,
      expiryDate: earliestExpiry,
      storageLocation: "Received transfer · confirm storage on arrival",
      batchRef: transfer.transferId,
      lowStockThreshold: 1,
      verified: true,
      screened: true,
      released: true,
      protectedReserve: 0,
      lastUpdated: now,
      isDemo: org.isDemo ?? false,
      createdAt: now,
    });
    const receiptId = await ctx.db.insert("transferReceipts", {
      transferId: transfer._id,
      requestId: transfer.requestId,
      receivingOrgId: transfer.requestingOrgId,
      supplyingOrgId: transfer.supplyingOrgId,
      inventoryId: receiptBatchId,
      units: args.receivedUnits,
      bloodGroup: args.verifiedBloodGroup,
      component: args.verifiedComponent,
      labelVerified: args.verification.labelVerified,
      screeningAndReleaseConfirmed: args.verification.screeningAndReleaseConfirmed,
      temperatureOk: args.verification.temperatureOk,
      packagingIntact: args.verification.packagingIntact,
      crossMatchConfirmed: args.verification.crossMatchConfirmed,
      note: args.note,
      evidenceCode: args.evidenceCode,
      receivedByUserId: user._id,
      receivedByRole: role,
      isDemo: org.isDemo ?? false,
      createdAt: now,
    });
    await ctx.db.insert("inventoryTransactions", {
      inventoryId: receiptBatchId,
      organizationId: transfer.requestingOrgId,
      type: "receipt",
      units: args.receivedUnits,
      bloodGroup: args.verifiedBloodGroup,
      component: args.verifiedComponent,
      requestId: transfer.requestId,
      actorUserId: user._id,
      actorRole: role,
      note:
        args.note ??
        `Verified receipt under ${transfer.transferId}${args.evidenceCode ? ` · evidence ${args.evidenceCode}` : ""}`,
      isDemo: org.isDemo ?? false,
      createdAt: now,
    });
    await ctx.db.patch(transfer._id, {
      status: "received",
      receivedAt: now,
      updatedAt: now,
      note:
        args.receivedUnits < transfer.units
          ? `${args.note ?? "Receipt confirmed"} · short receipt ${args.receivedUnits}/${transfer.units} unit(s).`
          : args.note ?? transfer.note,
    });

    const reconciliation = request
      ? await reconcileRequestReceipt(ctx, {
          request,
          actor: user,
          note:
            args.note ??
            `Transfer ${transfer.transferId}: ${args.receivedUnits} unit(s) verified at ${org.name}.`,
        })
      : null;

    await queueForOrganization(ctx, transfer.supplyingOrgId, {
      title: `Transfer ${transfer.transferId} received`,
      body: `${org.name} verified ${args.receivedUnits} of ${transfer.units} unit(s) of ${args.verifiedBloodGroup} ${args.verifiedComponent.replace(/_/g, " ")}.${args.evidenceCode ? ` Handoff evidence: ${args.evidenceCode}.` : ""}`,
      kind: "request",
      dedupeKey: `transfer-received:${transfer._id}`,
      requestId: transfer.requestId,
      link: "/supply",
    });
    await audit(ctx, {
      actor: user,
      action: "transfer.received",
      entityType: "transfer",
      entityId: transfer.transferId,
      detail: `Verified receipt for ${args.receivedUnits}/${transfer.units} unit(s). New batch ${transfer.transferId} added to ${org.name}.`,
      organizationId: transfer.requestingOrgId,
      isDemo: org.isDemo ?? false,
    });
    return {
      ok: true,
      duplicate: false,
      receiptId,
      receiptBatchId,
      receivedUnits: args.receivedUnits,
      requestStatus: reconciliation?.status ?? request?.status ?? null,
    };
  },
});

/** Releases reservations. Only possible before physical dispatch. */
export const cancelTransfer = mutation({
  args: { transferId: v.id("transfers"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const transfer = await ctx.db.get(args.transferId);
    if (!transfer) throw safeError("Transfer not found.");
    await authorizeTransferOwnershipOrStaff(ctx, user, transfer);
    const role = roleOf(user);
    if (transfer.status !== "reserved" && transfer.status !== "approved") {
      throw safeError("Dispatched stock cannot be cancelled; record a failed transfer instead.");
    }
    const now = Date.now();
    let released = 0;
    for (const id of transfer.reservationIds) {
      const reservation = await ctx.db.get(id);
      if (!reservation || reservation.status !== "active") continue;
      const batch = await ctx.db.get(reservation.inventoryId);
      if (!batch) continue;
      const held = Math.min(batch.unitsReserved, reservation.units);
      await ctx.db.patch(batch._id, {
        unitsReserved: batch.unitsReserved - held,
        lastUpdated: now,
      });
      await ctx.db.insert("inventoryTransactions", {
        inventoryId: batch._id,
        organizationId: batch.organizationId,
        type: "release",
        units: held,
        bloodGroup: batch.bloodGroup,
        component: batch.component,
        requestId: transfer.requestId,
        actorUserId: user._id,
        actorRole: role,
        note: args.note ?? `Transfer ${transfer.transferId} cancelled`,
        isDemo: batch.isDemo,
        createdAt: now,
      });
      await ctx.db.patch(reservation._id, { status: "released", units: 0, updatedAt: now });
      released += held;
    }
    await ctx.db.patch(transfer._id, {
      status: "cancelled",
      updatedAt: now,
      note: args.note ?? transfer.note,
    });
    await audit(ctx, {
      actor: user,
      action: "transfer.cancelled",
      entityType: "transfer",
      entityId: transfer.transferId,
      detail: `${released} reserved unit(s) returned to available stock.`,
      organizationId: transfer.supplyingOrgId,
    });
    return { released };
  },
});

/* ------------------------------------------------------------------ *
 * Transfer agreements (admin-managed pre-authorisation)
 * ------------------------------------------------------------------ */

export const createAgreement = mutation({
  args: {
    requestingOrgId: v.id("organizations"),
    supplyingOrgId: v.id("organizations"),
    autoAllocate: v.boolean(),
    maxUnitsPerRequest: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.requestingOrgId === args.supplyingOrgId) {
      throw new Error("A facility cannot have a transfer agreement with itself.");
    }
    const requesting = await ctx.db.get(args.requestingOrgId);
    const supplying = await ctx.db.get(args.supplyingOrgId);
    if (!requesting || !supplying) throw new Error("Both facilities must exist.");
    if (requesting.status !== "verified" || supplying.status !== "verified") {
      throw new Error("Transfer agreements require two verified facilities.");
    }
    if (supplying.type === "hospital" && requesting.type === "red_cross") {
      throw new Error("Red Cross shortfalls are routed to donors, not to hospitals.");
    }
    const existing = (await ctx.db.query("transferAgreements").collect()).find(
      (a) =>
        a.requestingOrgId === args.requestingOrgId &&
        a.supplyingOrgId === args.supplyingOrgId,
    );
    const now = Date.now();
    const maxUnits = Math.max(1, Math.min(50, Math.round(args.maxUnitsPerRequest)));
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "active",
        autoAllocate: args.autoAllocate,
        maxUnitsPerRequest: maxUnits,
        note: args.note,
        updatedAt: now,
      });
      return { agreementId: existing._id, updated: true };
    }
    const agreementId = await ctx.db.insert("transferAgreements", {
      requestingOrgId: args.requestingOrgId,
      supplyingOrgId: args.supplyingOrgId,
      status: "active",
      autoAllocate: args.autoAllocate,
      maxUnitsPerRequest: maxUnits,
      note: args.note,
      createdByUserId: admin._id,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, {
      actor: admin,
      action: "agreement.created",
      entityType: "transferAgreement",
      entityId: String(agreementId),
      detail: `${requesting.name} may receive up to ${maxUnits} unit(s) per request from ${supplying.name}${args.autoAllocate ? " automatically" : " with manual approval"}.`,
      organizationId: requesting._id,
    });
    return { agreementId, updated: false };
  },
});

export const agreementsForMe = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const role = roleOf(user);
    const all = await ctx.db.query("transferAgreements").collect();
    const orgId = user.organizationId;
    const scoped = all.filter(
      (a) =>
        role === "admin" ||
        (orgId != null && (a.requestingOrgId === orgId || a.supplyingOrgId === orgId)),
    );
    const orgs = await ctx.db.query("organizations").collect();
    const byId = new Map(orgs.map((o) => [o._id, o]));
    return scoped.map((a) => ({
      _id: a._id,
      requestingOrgId: a.requestingOrgId,
      supplyingOrgId: a.supplyingOrgId,
      requestingName: byId.get(a.requestingOrgId)?.name ?? "Unknown",
      supplyingName: byId.get(a.supplyingOrgId)?.name ?? "Unknown",
      status: a.status,
      autoAllocate: a.autoAllocate,
      maxUnitsPerRequest: a.maxUnitsPerRequest,
      note: a.note ?? null,
      updatedAt: a.updatedAt,
      direction:
        orgId == null ? "network" : a.requestingOrgId === orgId ? "inbound" : "outbound",
    }));
  },
});

export const setTransferPolicy = mutation({
  args: {
    organizationId: v.id("organizations"),
    transferAuthorized: v.boolean(),
    autoAllocate: v.boolean(),
    protectedReserveDefault: v.number(),
    searchRadiusKm: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const org = await ctx.db.get(args.organizationId);
    if (!org) throw new Error("Organization not found.");
    if (org.status !== "verified") throw new Error("Only verified facilities can be transfer-enabled.");
    await ctx.db.patch(org._id, {
      transferAuthorized: args.transferAuthorized,
      autoAllocate: args.transferAuthorized && args.autoAllocate,
      protectedReserveDefault: Math.max(0, Math.round(args.protectedReserveDefault)),
      searchRadiusKm: args.searchRadiusKm,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: admin,
      action: "organization.transferPolicy",
      entityType: "organization",
      entityId: org.orgId,
      detail: `Transfer ${args.transferAuthorized ? "authorized" : "disabled"}; auto-allocation ${args.autoAllocate ? "on" : "off"}; protected reserve ${args.protectedReserveDefault}.`,
      organizationId: org._id,
    });
    return { ok: true };
  },
});

export const networkFacilities = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!["admin", "hospital", "red_cross", "drone_ops"].includes(roleOf(user))) {
      throw new Error("Your role cannot view the facility network.");
    }
    const orgs = await ctx.db.query("organizations").collect();
    return orgs
      .filter((o) => o.status === "verified")
      .map((o) => ({
        _id: o._id,
        orgId: o.orgId,
        name: o.name,
        type: o.type,
        city: o.city,
        latitude: o.latitude ?? cityCoords(o.city)?.lat ?? null,
        longitude: o.longitude ?? cityCoords(o.city)?.lng ?? null,
        transferAuthorized: o.transferAuthorized ?? false,
        autoAllocate: o.autoAllocate ?? false,
        protectedReserveDefault: o.protectedReserveDefault ?? 0,
        isDemo: o.isDemo ?? false,
      }));
  },
});

export const grantDroneOps = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const email = args.email.trim().toLowerCase();
    const users = await ctx.db.query("users").collect();
    const user = users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (!user) {
      throw new Error("No LifeLink account uses that email. Ask them to register first.");
    }
    if (["community", "donor", "requestor"].includes(user.role ?? "")) {
      throw new Error("Convert only staff or new accounts to drone operations.");
    }
    await ctx.db.patch(user._id, { role: "drone_ops" });
    await audit(ctx, {
      actor: admin,
      action: "user.droneOpsGranted",
      entityType: "user",
      entityId: String(user._id),
      detail: `${email} granted the drone operations role.`,
    });
    return { ok: true, userId: user._id };
  },
});
