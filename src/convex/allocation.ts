import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
  type AppUser,
} from "./lib/helpers";
import { evaluateStockLevel } from "./lib/stockWatch";
import { queueForOrganization } from "./lib/messaging";
import { escalateDonorsForNeed } from "./lib/donorFallback";
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
import { cityCoords } from "../lib/blood";

const scopeValidator = v.union(
  v.literal("city"),
  v.literal("district"),
  v.literal("state"),
  v.literal("country"),
);

const OPEN_FOR_ALLOCATION = new Set(["pending", "under_verification", "approved"]);
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
    const reservations = await ctx.db
      .query("inventoryReservations")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect();
    const activeReserved = reservations
      .filter((r) => r.status === "active")
      .reduce((sum, r) => sum + r.units, 0);
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
      remainingUnits: Math.max(0, request.units - activeReserved),
      activeReserved,
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

/**
 * Automatic institutional allocation. Reserves eligible units atomically across
 * one or more pre-authorised facilities. Convex mutations are serializable, so
 * concurrent requests cannot reserve the same unit twice; the batch free count
 * is re-checked immediately before every write.
 */
export const autoAllocate = mutation({
  args: {
    requestId: v.id("bloodRequests"),
    scope: v.optional(scopeValidator),
    maxDistanceKm: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const resolved = await resolveNeed(ctx, user, args);
    const request = resolved.request!;
    const role = roleOf(user);
    if (role !== "admin" && user.organizationId !== request.hospitalOrgId) {
      throw new Error("Only the requesting hospital can run automatic allocation.");
    }
    if (!OPEN_FOR_ALLOCATION.has(request.status)) {
      throw new Error("This request is already closed or fulfilled.");
    }
    if (request.source === "requestor" && request.status !== "approved") {
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
        message: "This request is already fully reserved.",
      };
    }

    const { authorizedRanked } = await buildCandidates(ctx, resolved);
    const plan = planAllocation(authorizedRanked, resolved.remainingUnits);
    if (plan.allocations.length === 0) {
      // No authorised institutional stock. Donors are only contacted after the
      // institutional shortfall is confirmed, so escalate immediately.
      const escalation = await escalateDonorsForNeed(ctx, {
        requestingOrg: resolved.requesterOrg,
        bloodGroup: request.bloodGroup,
        component: request.component,
        units: resolved.remainingUnits,
        urgency: request.urgency,
        requestId: request._id,
        actorUserId: user._id,
      });
      await ctx.db.insert("requestStatusHistory", {
        requestId: request._id,
        status: request.status,
        actorUserId: user._id,
        actorRole: role,
        note: `Automatic institutional allocation found no authorised supply. ${escalation.invited} donor invitation(s) sent; donors are not counted as stock.`,
        isDemo: request.isDemo,
        createdAt: Date.now(),
      });
      return {
        allocated: 0,
        shortfall: resolved.remainingUnits,
        transfers: [],
        invitations: escalation,
        message:
          "No pre-authorised institutional supply was available. Donor fallback was triggered automatically.",
      };
    }

    const now = Date.now();
    const transferGroups = new Map<
      string,
      {
        supplyingOrgId: Id<"organizations">;
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
      const key = String(org._id);
      const group = transferGroups.get(key) ?? {
        supplyingOrgId: org._id,
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
        bloodGroup: request.bloodGroup,
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
      title: `Automatic allocation: ${allocated}/${request.units} unit(s) reserved`,
      body:
        allocated >= request.units
          ? `Units are reserved across ${transferResults.length} facilit${transferResults.length === 1 ? "y" : "ies"}. Dispatch and delivery still require staff confirmation.`
          : `Only ${allocated} of ${request.units} unit(s) could be reserved. The institutional shortfall is being escalated to donors.`,
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
      detail: `Reserved ${allocated} unit(s) from ${transferResults.map((t) => `${t.supplyingName} (${t.units})`).join(", ") || "no facility"}. Shortfall ${Math.max(0, request.units - resolved.activeReserved - allocated)}.`,
      organizationId: resolved.requesterOrg._id,
      isDemo: request.isDemo,
    });

    const remainingAfter = Math.max(0, request.units - resolved.activeReserved - allocated);
    const invitations =
      remainingAfter > 0
        ? await escalateDonorsForNeed(ctx, {
            requestingOrg: resolved.requesterOrg,
            bloodGroup: request.bloodGroup,
            component: request.component,
            units: remainingAfter,
            urgency: request.urgency,
            requestId: request._id,
            actorUserId: user._id,
          })
        : null;

    return {
      allocated,
      shortfall: remainingAfter,
      transfers: transferResults,
      invitations,
      applied,
      message:
        remainingAfter === 0
          ? "Institutional supply covers the request. Dispatch and clinical release still require staff action."
          : `Institutional shortfall of ${remainingAfter} unit(s). Donor invitations were queued; donors are not counted as stock.`,
    };
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
        return {
          _id: transfer._id,
          transferId: transfer.transferId,
          requestCode: request?.requestId ?? null,
          requestId: transfer.requestId ?? null,
          bloodGroup: transfer.bloodGroup,
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
    if (!transfer) throw new Error("Transfer not found.");
    const role = roleOf(user);
    if (role !== "admin" && user.organizationId !== transfer.supplyingOrgId) {
      throw new Error("Only the supplying facility can dispatch this transfer.");
    }
    if (!["reserved", "approved"].includes(transfer.status)) {
      throw new Error(`Transfer cannot be dispatched from status ${transfer.status}.`);
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

/** Receiving facility confirms delivery and the units enter its own ledger. */
export const receiveTransfer = mutation({
  args: {
    transferId: v.id("transfers"),
    note: v.optional(v.string()),
    evidenceCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const transfer = await ctx.db.get(args.transferId);
    if (!transfer) throw new Error("Transfer not found.");
    const role = roleOf(user);
    if (role !== "admin" && user.organizationId !== transfer.requestingOrgId) {
      throw new Error("Only the receiving facility can confirm this transfer.");
    }
    if (!["dispatched", "in_transit"].includes(transfer.status)) {
      throw new Error("Only a dispatched or in-transit transfer can be received.");
    }
    const now = Date.now();
    const reservations = [];
    for (const id of transfer.reservationIds) {
      const reservation = await ctx.db.get(id);
      if (reservation) reservations.push(reservation);
    }
    const batches = [];
    for (const reservation of reservations) {
      const batch = await ctx.db.get(reservation.inventoryId);
      if (batch) batches.push(batch);
    }
    const earliestExpiry =
      batches.map((b) => b.expiryDate).sort()[0] ?? new Date(now + 21 * 86_400_000).toISOString().slice(0, 10);
    const org = await ctx.db.get(transfer.requestingOrgId);
    const receiptBatchId = await ctx.db.insert("inventory", {
      organizationId: transfer.requestingOrgId,
      bloodGroup: transfer.bloodGroup,
      component: transfer.component,
      unitsAvailable: transfer.units,
      unitsReserved: 0,
      collectionDate: new Date(now - 7 * 86_400_000).toISOString().slice(0, 10),
      expiryDate: earliestExpiry,
      storageLocation: "Received transfer · confirm storage on arrival",
      batchRef: transfer.transferId,
      lowStockThreshold: 1,
      verified: true,
      screened: true,
      released: true,
      protectedReserve: 0,
      lastUpdated: now,
      isDemo: org?.isDemo ?? false,
      createdAt: now,
    });
    await ctx.db.insert("inventoryTransactions", {
      inventoryId: receiptBatchId,
      organizationId: transfer.requestingOrgId,
      type: "receipt",
      units: transfer.units,
      bloodGroup: transfer.bloodGroup,
      component: transfer.component,
      requestId: transfer.requestId,
      actorUserId: user._id,
      actorRole: role,
      note: args.note ?? `Received under ${transfer.transferId}${args.evidenceCode ? ` · evidence ${args.evidenceCode}` : ""}`,
      isDemo: org?.isDemo ?? false,
      createdAt: now,
    });
    await ctx.db.patch(transfer._id, {
      status: "received",
      receivedAt: now,
      updatedAt: now,
      note: args.note ?? transfer.note,
    });

    if (transfer.requestId) {
      const request = await ctx.db.get(transfer.requestId);
      if (request && ["approved", "dispatched"].includes(request.status)) {
        await ctx.db.patch(request._id, { status: "received", updatedAt: now });
        await ctx.db.insert("requestStatusHistory", {
          requestId: request._id,
          status: "received",
          actorUserId: user._id,
          actorRole: role,
          note: args.note ?? `Transfer ${transfer.transferId} received at ${org?.name ?? "facility"}.`,
          isDemo: request.isDemo,
          createdAt: now,
        });
      }
    }

    await queueForOrganization(ctx, transfer.supplyingOrgId, {
      title: `Transfer ${transfer.transferId} received`,
      body: `${org?.name ?? "The receiving facility"} confirmed ${transfer.units} unit(s) of ${transfer.bloodGroup} ${transfer.component.replace(/_/g, " ")}.${args.evidenceCode ? ` Handoff evidence: ${args.evidenceCode}.` : ""}`,
      kind: "request",
      dedupeKey: `transfer-received:${transfer._id}`,
      link: "/supply",
    });
    await audit(ctx, {
      actor: user,
      action: "transfer.received",
      entityType: "transfer",
      entityId: transfer.transferId,
      detail: `Receipt confirmed for ${transfer.units} unit(s). New batch ${transfer.transferId} added to ${org?.name ?? "the receiving facility"}.`,
      organizationId: transfer.requestingOrgId,
    });
    return { ok: true, receiptBatchId };
  },
});

/** Releases reservations. Only possible before physical dispatch. */
export const cancelTransfer = mutation({
  args: { transferId: v.id("transfers"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const transfer = await ctx.db.get(args.transferId);
    if (!transfer) throw new Error("Transfer not found.");
    const role = roleOf(user);
    if (
      role !== "admin" &&
      user.organizationId !== transfer.requestingOrgId &&
      user.organizationId !== transfer.supplyingOrgId
    ) {
      throw new Error("Your facility is not part of this transfer.");
    }
    if (transfer.status !== "reserved" && transfer.status !== "approved") {
      throw new Error("Dispatched stock cannot be cancelled; record a failed transfer instead.");
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
    if (user.role === "donor" || user.role === "requestor") {
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
