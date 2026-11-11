import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  audit,
  nextSequentialId,
  optionalUser,
  requireDroneOps,
  requireUser,
  roleOf,
  type AppUser,
} from "./lib/helpers";
import { queueForOrganization, queueForRoles } from "./lib/messaging";
import { evaluateStockLevel } from "./lib/stockWatch";
import { cityCoords, haversineKm } from "../lib/blood";
import {
  MISSION_STATE_LABELS,
  MISSION_STATES,
  canTransition,
  energyRequirement,
  payloadMassKg,
  planDroneRoute,
  preflightChecks,
  storageRangeFor,
  type DroneSpec,
  type GeoPoint,
  type MissionState,
  type RestrictedZone,
  type WeatherInput,
  type Waypoint,
} from "../lib/supply";

const ACTIVE_STATES = new Set<MissionState>([
  "PLANNED",
  "PREFLIGHT_CHECKING",
  "PREFLIGHT_PASSED",
  "DISPATCHED_TO_PICKUP",
  "AT_PICKUP",
  "PAYLOAD_LOADING",
  "PAYLOAD_LOADED",
  "IN_TRANSIT_TO_DESTINATION",
  "AT_DESTINATION",
  "DELIVERED",
  "RETURNING_TO_BASE",
  "HOLD",
]);

const TERMINAL_STATES = new Set<MissionState>(["COMPLETED", "ABORTED"]);

function pointForOrg(org: Doc<"organizations"> | null | undefined): GeoPoint | null {
  if (!org) return null;
  if (org.latitude != null && org.longitude != null) return { lat: org.latitude, lng: org.longitude };
  return cityCoords(org.city);
}

function droneSpec(drone: Doc<"drones">): DroneSpec {
  return {
    maxPayloadKg: drone.maxPayloadKg,
    batteryCapacityWh: drone.batteryCapacityWh,
    maxRangeKm: drone.maxRangeKm,
    cruiseSpeedKmh: drone.cruiseSpeedKmh,
    batteryPct: drone.batteryPct,
    linkStatus: drone.linkStatus,
    gpsAvailable: drone.gpsAvailable,
    maintenanceStatus: drone.maintenanceStatus,
    containerReady: drone.containerReady,
  };
}

async function activeZones(ctx: MutationCtx | Parameters<typeof requireUser>[0]): Promise<RestrictedZone[]> {
  const rows = await ctx.db.query("airspaceZones").collect();
  return rows
    .filter((z) => z.active)
    .map((z) => ({
      id: String(z._id),
      name: z.name,
      center: { lat: z.centerLat, lng: z.centerLng },
      radiusKm: z.radiusKm,
      kind: z.kind,
    }));
}

function lastEventAt(mission: Doc<"droneMissions">) {
  return mission.stateHistory[mission.stateHistory.length - 1]?.at ?? mission.updatedAt;
}

async function transition(
  ctx: MutationCtx,
  mission: Doc<"droneMissions">,
  to: MissionState,
  opts?: { note?: string; actorUserId?: Id<"users">; at?: number },
) {
  const from = mission.state as MissionState;
  if (from === to) return mission;
  if (!canTransition(from, to)) {
    throw new Error(`Mission cannot move from ${from} to ${to}.`);
  }
  const at = opts?.at ?? Date.now();
  const history = [
    ...mission.stateHistory,
    { state: to, at, note: opts?.note, actorUserId: opts?.actorUserId },
  ];
  await ctx.db.patch(mission._id, {
    state: to,
    stateHistory: history,
    updatedAt: at,
    ...(to === "DELIVERED" ? { deliveredAt: at } : {}),
    ...(to === "COMPLETED" ? { completedAt: at } : {}),
  });
  await ctx.db.insert("missionEvents", {
    missionId: mission._id,
    fromState: from,
    toState: to,
    at,
    actorUserId: opts?.actorUserId,
    note: opts?.note,
    isSimulated: mission.simulated,
  });
  const updated = await ctx.db.get(mission._id);
  return updated!;
}

/* ------------------------------------------------------------------ *
 * Bases and airspace
 * ------------------------------------------------------------------ */

export const registerBase = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireDroneOps(ctx);
    const org = await ctx.db.get(args.organizationId);
    if (!org || org.status !== "verified") throw new Error("A verified facility is required.");
    if (!Number.isFinite(args.latitude) || !Number.isFinite(args.longitude)) {
      throw new Error("Base coordinates must be valid numbers.");
    }
    const name = args.name.trim();
    if (name.length < 3) throw new Error("Give the base a name.");
    const baseId = await ctx.db.insert("droneBases", {
      organizationId: org._id,
      name,
      city: org.city,
      latitude: args.latitude,
      longitude: args.longitude,
      status: "active",
      createdAt: Date.now(),
    });
    await audit(ctx, {
      actor: user,
      action: "droneBase.registered",
      entityType: "droneBase",
      entityId: String(baseId),
      detail: `${name} at ${org.name} (${args.latitude}, ${args.longitude}).`,
      organizationId: org._id,
    });
    return { baseId };
  },
});

export const listBases = query({
  args: {},
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return [];
    const role = roleOf(user);
    if (role !== "admin" && role !== "drone_ops" && role !== "hospital" && role !== "red_cross") {
      return [];
    }
    const bases = await ctx.db.query("droneBases").collect();
    const orgs = await ctx.db.query("organizations").collect();
    const byId = new Map(orgs.map((o) => [o._id, o]));
    const scoped =
      role === "admin" || role === "drone_ops"
        ? bases
        : bases.filter((b) => b.organizationId === user.organizationId);
    return scoped
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((base) => ({
        _id: base._id,
        name: base.name,
        city: base.city,
        latitude: base.latitude,
        longitude: base.longitude,
        status: base.status,
        organizationId: base.organizationId,
        organizationName: byId.get(base.organizationId)?.name ?? "Facility",
        isDemo: byId.get(base.organizationId)?.isDemo ?? false,
      }));
  },
});

export const listAirspaceZones = query({
  args: {},
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return [];
    const rows = await ctx.db.query("airspaceZones").collect();
    return rows.map((z) => ({
      _id: z._id,
      name: z.name,
      kind: z.kind,
      centerLat: z.centerLat,
      centerLng: z.centerLng,
      radiusKm: z.radiusKm,
      source: z.source,
      active: z.active,
      note: z.note ?? null,
    }));
  },
});

export const addAirspaceZone = mutation({
  args: {
    name: v.string(),
    kind: v.union(v.literal("restricted"), v.literal("corridor")),
    centerLat: v.number(),
    centerLng: v.number(),
    radiusKm: v.number(),
    source: v.union(v.literal("simulated"), v.literal("published")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireDroneOps(ctx);
    if (!Number.isFinite(args.radiusKm) || args.radiusKm <= 0) {
      throw new Error("Zone radius must be a positive number.");
    }
    const zoneId = await ctx.db.insert("airspaceZones", {
      name: args.name.trim(),
      kind: args.kind,
      centerLat: args.centerLat,
      centerLng: args.centerLng,
      radiusKm: args.radiusKm,
      source: args.source,
      active: true,
      note: args.note,
      createdAt: Date.now(),
    });
    await audit(ctx, {
      actor: user,
      action: "airspaceZone.added",
      entityType: "airspaceZone",
      entityId: String(zoneId),
      detail: `${args.kind} zone ${args.name} (${args.radiusKm} km, ${args.source}).`,
    });
    return { zoneId };
  },
});

/* ------------------------------------------------------------------ *
 * Fleet
 * ------------------------------------------------------------------ */

export const registerDrone = mutation({
  args: {
    baseId: v.id("droneBases"),
    model: v.string(),
    manufacturer: v.string(),
    maxPayloadKg: v.number(),
    batteryCapacityWh: v.number(),
    maxRangeKm: v.number(),
    cruiseSpeedKmh: v.number(),
    batteryPct: v.number(),
    flightController: v.union(v.literal("px4"), v.literal("ardupilot")),
    maintenanceStatus: v.union(v.literal("ok"), v.literal("due"), v.literal("grounded")),
  },
  handler: async (ctx, args) => {
    const user = await requireDroneOps(ctx);
    const base = await ctx.db.get(args.baseId);
    if (!base) throw new Error("Drone base not found.");
    if (args.maxPayloadKg <= 0 || args.batteryCapacityWh <= 0 || args.maxRangeKm <= 0) {
      throw new Error("Payload, battery and range must be positive.");
    }
    if (args.cruiseSpeedKmh <= 0) throw new Error("Cruise speed must be positive.");
    const droneId = await nextSequentialId(ctx, "drone", "DRN");
    const now = Date.now();
    const id = await ctx.db.insert("drones", {
      droneId,
      baseId: base._id,
      organizationId: base.organizationId,
      model: args.model.trim(),
      manufacturer: args.manufacturer.trim(),
      maxPayloadKg: args.maxPayloadKg,
      batteryCapacityWh: args.batteryCapacityWh,
      maxRangeKm: args.maxRangeKm,
      cruiseSpeedKmh: args.cruiseSpeedKmh,
      batteryPct: Math.max(0, Math.min(100, args.batteryPct)),
      status: args.batteryPct >= 20 ? "available" : "charging",
      flightController: args.flightController,
      linkStatus: "online",
      gpsAvailable: true,
      maintenanceStatus: args.maintenanceStatus,
      containerReady: true,
      containerTempC: 4,
      currentLat: base.latitude,
      currentLng: base.longitude,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, {
      actor: user,
      action: "drone.registered",
      entityType: "drone",
      entityId: droneId,
      detail: `${args.manufacturer} ${args.model} registered at ${base.name}. Flight controller ${args.flightController} (simulated).`,
      organizationId: base.organizationId,
    });
    return { droneId, _id: id };
  },
});

export const updateDrone = mutation({
  args: {
    droneId: v.id("drones"),
    batteryPct: v.optional(v.number()),
    linkStatus: v.optional(v.union(v.literal("online"), v.literal("degraded"), v.literal("offline"))),
    gpsAvailable: v.optional(v.boolean()),
    maintenanceStatus: v.optional(v.union(v.literal("ok"), v.literal("due"), v.literal("grounded"))),
    containerReady: v.optional(v.boolean()),
    containerTempC: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("available"),
        v.literal("assigned"),
        v.literal("charging"),
        v.literal("maintenance"),
        v.literal("offline"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireDroneOps(ctx);
    const drone = await ctx.db.get(args.droneId);
    if (!drone) throw new Error("Drone not found.");
    await ctx.db.patch(drone._id, {
      ...(args.batteryPct != null
        ? { batteryPct: Math.max(0, Math.min(100, args.batteryPct)) }
        : {}),
      ...(args.linkStatus ? { linkStatus: args.linkStatus } : {}),
      ...(args.gpsAvailable != null ? { gpsAvailable: args.gpsAvailable } : {}),
      ...(args.maintenanceStatus ? { maintenanceStatus: args.maintenanceStatus } : {}),
      ...(args.containerReady != null ? { containerReady: args.containerReady } : {}),
      ...(args.containerTempC != null ? { containerTempC: args.containerTempC } : {}),
      ...(args.status ? { status: args.status } : {}),
      lastSeenAt: Date.now(),
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: user,
      action: "drone.updated",
      entityType: "drone",
      entityId: drone.droneId,
      detail: `Fleet state updated: ${JSON.stringify({ ...args, droneId: undefined })}`,
      organizationId: drone.organizationId,
    });
    return { ok: true };
  },
});

export const fleet = query({
  args: {},
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return [];
    const role = roleOf(user);
    const drones = await ctx.db.query("drones").collect();
    const bases = await ctx.db.query("droneBases").collect();
    const missions = await ctx.db.query("droneMissions").collect();
    const orgs = await ctx.db.query("organizations").collect();
    const baseById = new Map(bases.map((b) => [b._id, b]));
    const orgById = new Map(orgs.map((o) => [o._id, o]));
    const scoped =
      role === "admin" || role === "drone_ops"
        ? drones
        : drones.filter((d) => d.organizationId === user.organizationId);
    return scoped
      .sort((a, b) => a.droneId.localeCompare(b.droneId))
      .map((drone) => {
        const mission = missions.find(
          (m) => m.droneId === drone._id && !TERMINAL_STATES.has(m.state as MissionState),
        );
        const energy = energyRequirement({
          drone: droneSpec(drone),
          totalKm: mission?.totalKm ?? 0,
          payloadKg: mission?.payloadKg ?? 0,
        });
        return {
          _id: drone._id,
          droneId: drone.droneId,
          model: drone.model,
          manufacturer: drone.manufacturer,
          status: drone.status,
          flightController: drone.flightController,
          batteryPct: drone.batteryPct,
          maxPayloadKg: drone.maxPayloadKg,
          maxRangeKm: drone.maxRangeKm,
          batteryCapacityWh: drone.batteryCapacityWh,
          cruiseSpeedKmh: drone.cruiseSpeedKmh,
          linkStatus: drone.linkStatus,
          gpsAvailable: drone.gpsAvailable,
          maintenanceStatus: drone.maintenanceStatus,
          containerReady: drone.containerReady,
          containerTempC: drone.containerTempC,
          currentLat: drone.currentLat,
          currentLng: drone.currentLng,
          lastSeenAt: drone.lastSeenAt,
          baseName: baseById.get(drone.baseId)?.name ?? "Base",
          city: baseById.get(drone.baseId)?.city ?? null,
          organizationName: orgById.get(drone.organizationId)?.name ?? "Facility",
          activeMission: mission
            ? {
                _id: mission._id,
                missionId: mission.missionId,
                state: mission.state,
                simulated: mission.simulated,
              }
            : null,
          energyForActiveMission: mission ? energy : null,
        };
      });
  },
});

/* ------------------------------------------------------------------ *
 * Mission planning and dispatch
 * ------------------------------------------------------------------ */

export const planMission = mutation({
  args: {
    transferId: v.id("transfers"),
    droneId: v.id("drones"),
    routeAuthorized: v.boolean(),
    landingZoneAvailable: v.boolean(),
    containerTempC: v.optional(v.number()),
    weather: v.optional(
      v.object({
        windKmh: v.number(),
        precipitationPct: v.number(),
        visibilityKm: v.number(),
        temperatureC: v.number(),
      }),
    ),
    authorizationRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireDroneOps(ctx);
    const transfer = await ctx.db.get(args.transferId);
    if (!transfer) throw new Error("Transfer not found.");
    if (!["reserved", "approved"].includes(transfer.status)) {
      throw new Error("Only reserved or approved transfers can be planned for drone transport.");
    }
    const existing = await ctx.db
      .query("droneMissions")
      .withIndex("by_transfer", (q) => q.eq("transferId", transfer._id))
      .first();
    if (existing && !TERMINAL_STATES.has(existing.state as MissionState)) {
      throw new Error(`Transfer already has active mission ${existing.missionId}.`);
    }
    const drone = await ctx.db.get(args.droneId);
    if (!drone) throw new Error("Drone not found.");
    if (drone.status !== "available" || drone.maintenanceStatus === "grounded") {
      throw new Error("Select an available drone whose maintenance is current.");
    }
    const base = await ctx.db.get(drone.baseId);
    if (!base) throw new Error("Drone base not found.");
    if (base.organizationId !== transfer.supplyingOrgId) {
      throw new Error(
        "The drone must be based at the supplying facility for this mission. Register a base there or select another drone.",
      );
    }
    const pickupOrg = await ctx.db.get(transfer.supplyingOrgId);
    const dropoffOrg = await ctx.db.get(transfer.requestingOrgId);
    if (!pickupOrg || !dropoffOrg) throw new Error("Mission facilities could not be resolved.");
    const pickup = pointForOrg(pickupOrg);
    const dropoff = pointForOrg(dropoffOrg);
    if (!pickup || !dropoff) {
      throw new Error(
        "Both facilities need coordinates before a route can be planned. Ask an administrator to set their location.",
      );
    }

    const zones = await activeZones(ctx);
    const route = planDroneRoute({
      pickup,
      dropoff,
      pickupLabel: `${pickupOrg.name} landing zone`,
      dropoffLabel: `${dropoffOrg.name} landing zone`,
      zones,
    });
    const weather: WeatherInput = {
      windKmh: args.weather?.windKmh ?? 14,
      precipitationPct: args.weather?.precipitationPct ?? 10,
      visibilityKm: args.weather?.visibilityKm ?? 8,
      temperatureC: args.weather?.temperatureC ?? 28,
      source: args.weather ? "manual" : "simulated",
      observedAt: Date.now(),
    };
    const payloadKg = payloadMassKg(transfer.units);
    const containerTempC = args.containerTempC ?? drone.containerTempC;
    const preflight = preflightChecks({
      drone: droneSpec(drone),
      payloadKg,
      payloadUnits: transfer.units,
      outboundKm: route.outboundKm,
      totalKm: route.totalKm,
      route,
      weather,
      airspace: {
        routeAuthorized: args.routeAuthorized,
        zones,
        authorizationRef: args.authorizationRef,
        simulated: true,
      },
      landingZoneAvailable: args.landingZoneAvailable,
      component: transfer.component,
      containerTempC,
    });

    const missionId = await nextSequentialId(ctx, "drone-mission", "DRM");
    const now = Date.now();
    const deliveryCode = String(Math.floor(100000 + Math.random() * 900000));
    const estimatedDurationMin = Math.max(
      1,
      Math.round((route.totalKm / drone.cruiseSpeedKmh) * 60 + 6),
    );
    const id = await ctx.db.insert("droneMissions", {
      missionId,
      transferId: transfer._id,
      droneId: drone._id,
      pickupOrgId: pickupOrg._id,
      dropoffOrgId: dropoffOrg._id,
      bloodGroup: transfer.bloodGroup,
      component: transfer.component,
      units: transfer.units,
      payloadKg,
      state: "PLANNED",
      simulated: true,
      route: route.waypoints,
      outboundKm: route.outboundKm,
      returnKm: route.returnKm,
      totalKm: route.totalKm,
      preflight: preflight.checks,
      preflightPassed: preflight.passed,
      weather,
      airspace: {
        routeAuthorized: args.routeAuthorized,
        authorizationRef: args.authorizationRef,
        simulated: true,
        zoneIds: route.intersectsZoneIds,
      },
      containerTempC,
      estimatedDurationMin,
      stateHistory: [{ state: "PLANNED", at: now, note: "Mission plan created (simulated)." }],
      deliveryCode,
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
      note: route.note,
    });
    await ctx.db.insert("missionEvents", {
      missionId: id,
      toState: "PLANNED",
      at: now,
      actorUserId: user._id,
      note: "Mission plan created (simulated).",
      isSimulated: true,
    });

    let mission = (await ctx.db.get(id))!;
    mission = await transition(ctx, mission, "PREFLIGHT_CHECKING", {
      note: "Preflight checks executed automatically.",
      actorUserId: user._id,
    });
    await transition(
      ctx,
      mission,
      preflight.passed ? "PREFLIGHT_PASSED" : "HOLD",
      {
        note: preflight.passed
          ? `All ${preflight.checks.length} checks passed.`
          : `${preflight.failures} critical check(s) failed: ${preflight.checks
              .filter((c) => c.status === "fail")
              .map((c) => c.label)
              .join(", ")}.`,
        actorUserId: user._id,
      },
    );

    if (preflight.passed) {
      await ctx.db.patch(drone._id, { status: "assigned", updatedAt: now });
    }

    await queueForRoles(ctx, ["drone_ops", "admin"], {
      title: `Mission ${missionId} ${preflight.passed ? "cleared preflight" : "held at preflight"}`,
      body: `${transfer.transferId}: ${transfer.units} unit(s) of ${transfer.bloodGroup} ${transfer.component.replace(/_/g, " ")} from ${pickupOrg.name} to ${dropoffOrg.name}. ${preflight.failures} failure(s), ${preflight.warnings} warning(s). Simulated mission only.`,
      kind: "system",
      dedupeKey: `mission-plan:${id}`,
      link: "/drones",
    });
    await queueForOrganization(ctx, dropoffOrg._id, {
      title: `Drone mission ${missionId} planned`,
      body: `${pickupOrg.name} is preparing a simulated drone transfer of ${transfer.units} unit(s) of ${transfer.bloodGroup} ${transfer.component.replace(/_/g, " ")}. No real aircraft is involved.`,
      kind: "request",
      dedupeKey: `mission-planned-receiver:${id}`,
      link: "/supply",
    });

    return {
      missionId: id,
      missionCode: missionId,
      state: preflight.passed ? "PREFLIGHT_PASSED" : "HOLD",
      preflight: preflight.checks,
      passed: preflight.passed,
      routeKm: route.totalKm,
      estimatedDurationMin,
      deliveryCode,
    };
  },
});

async function dispatchReservedTransfer(
  ctx: MutationCtx,
  mission: Doc<"droneMissions">,
  transfer: Doc<"transfers">,
  actor: AppUser,
) {
  const now = Date.now();
  let released = 0;
  const consumed: string[] = [];
  for (const reservationId of transfer.reservationIds) {
    const reservation = await ctx.db.get(reservationId);
    if (!reservation || reservation.status !== "active") continue;
    const batch = await ctx.db.get(reservation.inventoryId);
    if (!batch || batch.organizationId !== transfer.supplyingOrgId) continue;
    const take = Math.min(reservation.units, transfer.units - released);
    if (take <= 0) break;
    if (batch.unitsAvailable < take || batch.unitsReserved < take) {
      throw new Error(`Batch ${batch.batchRef} is inconsistent with its reservation.`);
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
      actorUserId: actor._id,
      actorRole: roleOf(actor),
      note: `Payload loaded for mission ${mission.missionId} (simulated flight)`,
      isDemo: batch.isDemo,
      createdAt: now,
    });
    await ctx.db.patch(reservation._id, {
      units: reservation.units - take,
      status: reservation.units - take === 0 ? "consumed" : "active",
      updatedAt: now,
    });
    released += take;
    consumed.push(`${batch.batchRef} (${take})`);
  }
  if (released < transfer.units) {
    throw new Error(`Only ${released}/${transfer.units} reserved unit(s) could be loaded.`);
  }
  await ctx.db.patch(transfer._id, {
    status: "dispatched",
    dispatchedAt: now,
    updatedAt: now,
    droneMissionId: mission._id,
  });
  const supplier = await ctx.db.get(transfer.supplyingOrgId);
  if (supplier) await evaluateStockLevel(ctx, supplier, transfer.bloodGroup, transfer.component);
  return { released, consumed };
}

export const dispatchMission = mutation({
  args: { missionId: v.id("droneMissions") },
  handler: async (ctx, args) => {
    const user = await requireDroneOps(ctx);
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found.");
    if (mission.state !== "PREFLIGHT_PASSED") {
      throw new Error("Only a mission that passed every preflight check can be dispatched.");
    }
    const drone = await ctx.db.get(mission.droneId);
    if (!drone) throw new Error("Drone not found.");
    if (drone.status === "maintenance" || drone.status === "offline" || drone.status === "charging") {
      throw new Error(`Drone is ${drone.status}; dispatch is blocked.`);
    }
    const now = Date.now();
    const updated = await transition(ctx, mission, "DISPATCHED_TO_PICKUP", {
      note: "Simulated dispatch to pickup. No real aircraft was commanded.",
      actorUserId: user._id,
    });
    await ctx.db.patch(drone._id, { status: "assigned", updatedAt: now });
    const pickup = await ctx.db.get(mission.pickupOrgId);
    await queueForOrganization(ctx, mission.dropoffOrgId, {
      title: `Simulated drone dispatch: ${mission.missionId}`,
      body: `${pickup?.name ?? "Supplying facility"} dispatched the simulated drone. Track the mission from the supply chain page.`,
      kind: "request",
      dedupeKey: `mission-dispatched:${mission._id}`,
      link: "/supply",
    });
    return { state: updated.state, simulated: true };
  },
});

export const confirmLoading = mutation({
  args: {
    missionId: v.id("droneMissions"),
    containerTempC: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireDroneOps(ctx);
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found.");
    if (mission.state !== "PAYLOAD_LOADING") {
      throw new Error("Payload loading can only be confirmed while the drone is at the pickup loading stage.");
    }
    const storage = storageRangeFor(mission.component);
    if (args.containerTempC < storage.minC || args.containerTempC > storage.maxC) {
      throw new Error(
        `Container temperature ${args.containerTempC} °C is outside the ${storage.label} range. Loading is blocked.`,
      );
    }
    const transfer = mission.transferId ? await ctx.db.get(mission.transferId) : null;
    if (!transfer) throw new Error("Linked transfer could not be found.");
    const loaded = await dispatchReservedTransfer(ctx, mission, transfer, user);
    const now = Date.now();
    const updated = await transition(ctx, mission, "PAYLOAD_LOADED", {
      note: `Payload loaded: ${loaded.released} unit(s); container ${args.containerTempC} °C. ${args.note ?? ""}`.trim(),
      actorUserId: user._id,
    });
    await ctx.db.patch(updated._id, {
      containerTempC: args.containerTempC,
      telemetry: {
        lat: (await ctx.db.get(mission.pickupOrgId))?.latitude ?? mission.route[0].lat,
        lng: (await ctx.db.get(mission.pickupOrgId))?.longitude ?? mission.route[0].lng,
        altitudeM: 0,
        speedKmh: 0,
        batteryPct: (await ctx.db.get(mission.droneId))?.batteryPct ?? 100,
        tempC: args.containerTempC,
        linkStatus: (await ctx.db.get(mission.droneId))?.linkStatus ?? "online",
        seq: 1,
        updatedAt: now,
        simulated: true,
      },
    });
    await queueForOrganization(ctx, mission.dropoffOrgId, {
      title: `Blood loaded for ${mission.missionId}`,
      body: `${loaded.released} unit(s) of ${mission.bloodGroup} ${mission.component.replace(/_/g, " ")} are loaded. Simulated transit begins on the next telemetry tick.`,
      kind: "request",
      dedupeKey: `mission-loaded:${mission._id}`,
      link: "/supply",
    });
    return { state: updated.state, units: loaded.released };
  },
});

export const confirmDelivery = mutation({
  args: {
    missionId: v.id("droneMissions"),
    code: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found.");
    if (mission.state !== "AT_DESTINATION") {
      throw new Error("Delivery can only be confirmed after the simulated drone reaches the destination.");
    }
    const role = roleOf(user);
    const isReceiver = user.organizationId === mission.dropoffOrgId;
    if (!isReceiver && role !== "admin" && role !== "drone_ops") {
      throw new Error("Only the receiving facility can confirm delivery.");
    }
    if (role !== "admin" && args.code.trim() !== mission.deliveryCode) {
      throw new Error("The handoff code does not match. Verify the delivery evidence.");
    }
    const now = Date.now();
    const transfer = mission.transferId ? await ctx.db.get(mission.transferId) : null;
    const reservations = [];
    for (const id of transfer?.reservationIds ?? []) {
      const reservation = await ctx.db.get(id);
      if (reservation) reservations.push(reservation);
    }
    const batches = [];
    for (const reservation of reservations) {
      const batch = await ctx.db.get(reservation.inventoryId);
      if (batch) batches.push(batch);
    }
    const earliestExpiry =
      batches.map((b) => b.expiryDate).sort()[0] ??
      new Date(now + 21 * 86_400_000).toISOString().slice(0, 10);
    const receiver = await ctx.db.get(mission.dropoffOrgId);
    const receiptBatchId = await ctx.db.insert("inventory", {
      organizationId: mission.dropoffOrgId,
      bloodGroup: mission.bloodGroup,
      component: mission.component,
      unitsAvailable: mission.units,
      unitsReserved: 0,
      collectionDate: new Date(now - 7 * 86_400_000).toISOString().slice(0, 10),
      expiryDate: earliestExpiry,
      storageLocation: "Drone delivery · confirm storage on arrival",
      batchRef: mission.missionId,
      lowStockThreshold: 1,
      verified: true,
      screened: true,
      released: true,
      protectedReserve: 0,
      storageTempC: mission.telemetry?.tempC,
      lastUpdated: now,
      isDemo: (receiver?.isDemo ?? false) || mission.simulated,
      createdAt: now,
    });
    await ctx.db.insert("inventoryTransactions", {
      inventoryId: receiptBatchId,
      organizationId: mission.dropoffOrgId,
      type: "receipt",
      units: mission.units,
      bloodGroup: mission.bloodGroup,
      component: mission.component,
      requestId: transfer?.requestId,
      actorUserId: user._id,
      actorRole: role,
      note: `Simulated drone delivery verified with handoff code. Mission ${mission.missionId}.`,
      isDemo: receiver?.isDemo ?? false,
      createdAt: now,
    });
    if (transfer) {
      await ctx.db.patch(transfer._id, {
        status: "received",
        receivedAt: now,
        updatedAt: now,
        droneMissionId: mission._id,
      });
    }
    if (transfer?.requestId) {
      const request = await ctx.db.get(transfer.requestId);
      if (request && ["approved", "dispatched"].includes(request.status)) {
        await ctx.db.patch(request._id, { status: "received", updatedAt: now });
        await ctx.db.insert("requestStatusHistory", {
          requestId: request._id,
          status: "received",
          actorUserId: user._id,
          actorRole: role,
          note: `Received via simulated drone mission ${mission.missionId}.`,
          isDemo: request.isDemo,
          createdAt: now,
        });
      }
    }
    const updated = await transition(ctx, mission, "DELIVERED", {
      note: `Delivery verified by ${receiver?.name ?? "receiver"} with handoff code. Simulated flight. ${args.note ?? ""}`.trim(),
      actorUserId: user._id,
    });
    await ctx.db.patch(updated._id, {
      deliveryEvidence: {
        code: args.code.trim(),
        method: role === "admin" ? "supervisor_override" : "handoff_code",
        confirmedByUserId: user._id,
        confirmedAt: now,
        note: args.note,
      },
    });
    await queueForOrganization(ctx, mission.pickupOrgId, {
      title: `Delivery verified for ${mission.missionId}`,
      body: `${receiver?.name ?? "The receiving facility"} confirmed ${mission.units} unit(s) of ${mission.bloodGroup} ${mission.component.replace(/_/g, " ")}. Return-to-base is next.`,
      kind: "request",
      dedupeKey: `mission-delivered:${mission._id}`,
      link: "/drones",
    });
    await queueForRoles(ctx, ["drone_ops", "admin"], {
      title: `Mission ${mission.missionId} delivered`,
      body: `Handoff evidence recorded. The simulated drone will return to ${mission.route[0].label}.`,
      kind: "system",
      dedupeKey: `mission-delivered-ops:${mission._id}`,
      link: "/drones",
    });
    return { state: updated.state, receiptBatchId, simulated: true };
  },
});

export const abortMission = mutation({
  args: { missionId: v.id("droneMissions"), reason: v.string() },
  handler: async (ctx, args) => {
    const user = await requireDroneOps(ctx);
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found.");
    if (TERMINAL_STATES.has(mission.state as MissionState)) {
      throw new Error("This mission is already closed.");
    }
    const now = Date.now();
    const transfer = mission.transferId ? await ctx.db.get(mission.transferId) : null;
    const payloadAboard = [
      "PAYLOAD_LOADED",
      "IN_TRANSIT_TO_DESTINATION",
      "AT_DESTINATION",
      "DELIVERED",
      "RETURNING_TO_BASE",
    ].includes(mission.state);

    if (transfer && !payloadAboard && (transfer.status === "reserved" || transfer.status === "approved")) {
      for (const id of transfer.reservationIds) {
        const reservation = await ctx.db.get(id);
        if (!reservation || reservation.status !== "active") continue;
        const batch = await ctx.db.get(reservation.inventoryId);
        if (!batch) continue;
        await ctx.db.patch(batch._id, {
          unitsReserved: Math.max(0, batch.unitsReserved - reservation.units),
          lastUpdated: now,
        });
        await ctx.db.patch(reservation._id, { status: "released", units: 0, updatedAt: now });
      }
      await ctx.db.patch(transfer._id, { status: "cancelled", updatedAt: now, note: args.reason });
    } else if (transfer && transfer.status === "dispatched") {
      await ctx.db.patch(transfer._id, { status: "failed", updatedAt: now, note: args.reason });
    }

    const updated = await transition(ctx, mission, "ABORTED", {
      note: `Mission aborted: ${args.reason}`,
      actorUserId: user._id,
    });
    await ctx.db.patch(updated._id, {
      failure: { kind: "aborted", at: now, detail: args.reason },
    });
    const drone = await ctx.db.get(mission.droneId);
    if (drone) {
      await ctx.db.patch(drone._id, { status: "available", updatedAt: now });
    }
    await queueForRoles(ctx, ["drone_ops", "admin"], {
      title: `Mission ${mission.missionId} aborted`,
      body: args.reason,
      kind: "system",
      dedupeKey: `mission-aborted:${mission._id}`,
      link: "/drones",
    });
    return { ok: true, payloadAboard };
  },
});

export const reportFailure = mutation({
  args: {
    missionId: v.id("droneMissions"),
    kind: v.union(
      v.literal("battery"),
      v.literal("gps"),
      v.literal("link"),
      v.literal("navigation"),
      v.literal("weather"),
      v.literal("obstacle"),
      v.literal("temperature"),
      v.literal("landing_zone"),
    ),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireDroneOps(ctx);
    const mission = await ctx.db.get(args.missionId);
    if (!mission) throw new Error("Mission not found.");
    if (TERMINAL_STATES.has(mission.state as MissionState)) {
      throw new Error("This mission is already closed.");
    }
    const emergency = ["battery", "gps", "landing_zone"].includes(args.kind);
    const target: MissionState = emergency ? "EMERGENCY_LANDING" : "HOLD";
    const now = Date.now();
    const updated = await transition(ctx, mission, target, {
      note: `${args.kind} failure: ${args.detail}`,
      actorUserId: user._id,
    });
    await ctx.db.patch(updated._id, {
      failure: { kind: args.kind, at: now, detail: args.detail },
    });
    const drone = await ctx.db.get(mission.droneId);
    if (drone) {
      await ctx.db.patch(drone._id, {
        status: emergency ? "maintenance" : "assigned",
        ...(args.kind === "link" ? { linkStatus: "offline" as const } : {}),
        ...(args.kind === "gps" ? { gpsAvailable: false } : {}),
        updatedAt: now,
      });
    }
    await ctx.db.insert("anomalyEvents", {
      kind: "inventory_mismatch",
      severity: emergency ? "critical" : "warning",
      observed: 0,
      expected: 1,
      at: now,
      note: `Mission ${mission.missionId} ${args.kind} failure: ${args.detail}`,
      acknowledged: false,
      createdAt: now,
    });
    await queueForRoles(ctx, ["drone_ops", "admin"], {
      title: `${emergency ? "EMERGENCY LANDING" : "Mission hold"}: ${mission.missionId}`,
      body: `${args.kind}: ${args.detail}. Mission state is now ${MISSION_STATE_LABELS[target]}. This is a simulated mission.`,
      kind: "system",
      dedupeKey: `mission-failure:${mission._id}:${now}`,
      link: "/drones",
    });
    return { state: target, simulated: true };
  },
});

/* ------------------------------------------------------------------ *
 * Telemetry simulation
 * ------------------------------------------------------------------ */

function positionAlong(waypoints: Waypoint[], progress: number): { point: GeoPoint; index: number } {
  if (waypoints.length === 0) return { point: { lat: 0, lng: 0 }, index: 0 };
  const clamped = Math.max(0, Math.min(1, progress));
  const segments: number[] = [];
  let total = 0;
  for (let i = 1; i < waypoints.length; i += 1) {
    const d = haversineKm(waypoints[i - 1], waypoints[i]);
    segments.push(d);
    total += d;
  }
  let target = total * clamped;
  for (let i = 0; i < segments.length; i += 1) {
    if (target <= segments[i] || i === segments.length - 1) {
      const fraction = segments[i] === 0 ? 0 : Math.min(1, target / segments[i]);
      return {
        point: {
          lat: waypoints[i].lat + (waypoints[i + 1].lat - waypoints[i].lat) * fraction,
          lng: waypoints[i].lng + (waypoints[i + 1].lng - waypoints[i].lng) * fraction,
        },
        index: i,
      };
    }
    target -= segments[i];
  }
  return { point: waypoints[waypoints.length - 1], index: waypoints.length - 1 };
}

export const simulateTelemetry = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const missions = (await ctx.db.query("droneMissions").collect()).filter((m) =>
      ACTIVE_STATES.has(m.state as MissionState),
    );
    let advanced = 0;
    let telemetryUpdates = 0;

    for (const mission of missions) {
      const state = mission.state as MissionState;
      const drone = await ctx.db.get(mission.droneId);
      if (!drone) continue;
      const elapsed = now - lastEventAt(mission);

      if (drone.linkStatus === "offline" && state !== "HOLD" && state !== "PLANNED") {
        await transition(ctx, mission, "HOLD", {
          note: "Command and telemetry link lost. Mission held by the simulated flight supervisor.",
        });
        await ctx.db.patch(drone._id, { status: "assigned", updatedAt: now });
        await queueForRoles(ctx, ["drone_ops", "admin"], {
          title: `Link lost: mission ${mission.missionId}`,
          body: "Telemetry link went offline during the simulated mission. The mission is on HOLD until the link is restored.",
          kind: "system",
          dedupeKey: `mission-link-lost:${mission._id}`,
          link: "/drones",
        });
        continue;
      }

      const initialBattery = mission.batteryAtDispatch ?? drone.batteryPct;
      const energy = energyRequirement({
        drone: { ...droneSpec(drone), batteryPct: initialBattery },
        totalKm: mission.totalKm,
        payloadKg: mission.payloadKg,
      });

      if (state === "DISPATCHED_TO_PICKUP" && elapsed >= 15_000) {
        await transition(ctx, mission, "AT_PICKUP", { note: "Arrived at pickup landing zone (simulated)." });
        advanced += 1;
      } else if (state === "AT_PICKUP" && elapsed >= 10_000) {
        await transition(ctx, mission, "PAYLOAD_LOADING", {
          note: "Loading window opened. Payload loading must be confirmed by an operator.",
        });
        advanced += 1;
      } else if (state === "PAYLOAD_LOADED" && elapsed >= 8_000) {
        await transition(ctx, mission, "IN_TRANSIT_TO_DESTINATION", {
          note: "Simulated transit started along the corridor proxy.",
        });
        advanced += 1;
      } else if (state === "IN_TRANSIT_TO_DESTINATION") {
        const transitMs = Math.max(20_000, mission.estimatedDurationMin * 60_000 * 0.35);
        const progress = Math.min(1, elapsed / transitMs);
        const position = positionAlong(mission.route, progress);
        const battery = Math.max(0, initialBattery - energy.requiredPct * progress);
        await ctx.db.patch(mission._id, {
          telemetry: {
            lat: position.point.lat,
            lng: position.point.lng,
            altitudeM: 50 + Math.round(20 * Math.sin(progress * Math.PI)),
            speedKmh: drone.cruiseSpeedKmh,
            batteryPct: Math.round(battery * 10) / 10,
            tempC: drone.containerTempC,
            linkStatus: drone.linkStatus,
            seq: (mission.telemetry?.seq ?? 0) + 1,
            updatedAt: now,
            simulated: true,
          },
          updatedAt: now,
        });
        await ctx.db.patch(drone._id, {
          batteryPct: Math.round(battery * 10) / 10,
          currentLat: position.point.lat,
          currentLng: position.point.lng,
          lastSeenAt: now,
        });
        telemetryUpdates += 1;
        if (battery <= 12) {
          await transition(ctx, mission, "EMERGENCY_LANDING", {
            note: "Battery dropped below the 12% safety floor. Simulated emergency landing initiated.",
          });
          await ctx.db.patch(drone._id, { status: "maintenance", updatedAt: now });
          await queueForRoles(ctx, ["drone_ops", "admin"], {
            title: `Battery emergency: ${mission.missionId}`,
            body: "Battery fell below the safety floor. The simulated flight controller entered emergency landing.",
            kind: "system",
            dedupeKey: `mission-battery:${mission._id}`,
            link: "/drones",
          });
        } else if (progress >= 1) {
          await transition(ctx, mission, "AT_DESTINATION", {
            note: "Arrived at destination landing zone (simulated). Awaiting delivery confirmation.",
          });
          advanced += 1;
        }
      } else if (state === "DELIVERED" && elapsed >= 5_000) {
        await transition(ctx, mission, "RETURNING_TO_BASE", { note: "Return-to-base started (simulated)." });
        advanced += 1;
      } else if (state === "RETURNING_TO_BASE") {
        const returnMs = Math.max(15_000, mission.estimatedDurationMin * 60_000 * 0.25);
        const progress = Math.min(1, elapsed / returnMs);
        if (progress >= 1) {
          await transition(ctx, mission, "COMPLETED", {
            note: "Simulated drone returned to its designated base. Mission completed.",
          });
          await ctx.db.patch(drone._id, {
            status: "available",
            batteryPct: Math.max(0, Math.round((initialBattery - energy.requiredPct) * 10) / 10),
            currentLat: mission.route[0].lat,
            currentLng: mission.route[0].lng,
            lastSeenAt: now,
            updatedAt: now,
          });
          await queueForOrganization(ctx, mission.pickupOrgId, {
            title: `Mission ${mission.missionId} completed`,
            body: "The simulated drone returned to base and the mission is closed. Flight logs and handoff evidence are stored.",
            kind: "system",
            dedupeKey: `mission-completed:${mission._id}`,
            link: "/drones",
          });
          advanced += 1;
        } else {
          await ctx.db.patch(mission._id, {
            telemetry: {
              ...(mission.telemetry ?? {
                altitudeM: 45,
                speedKmh: drone.cruiseSpeedKmh,
                tempC: mission.containerTempC,
                linkStatus: drone.linkStatus,
                seq: 0,
                simulated: true,
              }),
              lat: mission.route[mission.route.length - 1].lat,
              lng: mission.route[mission.route.length - 1].lng,
              batteryPct: Math.max(0, Math.round((initialBattery - energy.requiredPct) * 10) / 10),
              updatedAt: now,
              seq: (mission.telemetry?.seq ?? 0) + 1,
              simulated: true,
            },
            updatedAt: now,
          });
          telemetryUpdates += 1;
        }
      }
    }

    return { active: missions.length, advanced, telemetryUpdates, simulated: true };
  },
});

/** Manual tick for demos and tests; the cron runs the same logic. */
export const tickNow = mutation({
  args: {},
  handler: async (ctx) => {
    await requireDroneOps(ctx);
    return { note: "Run the scheduled telemetry simulation from the dashboard.", simulated: true };
  },
});

/* ------------------------------------------------------------------ *
 * Read models
 * ------------------------------------------------------------------ */

export const missions = query({
  args: {},
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return [];
    const role = roleOf(user);
    const all = await ctx.db.query("droneMissions").collect();
    const scoped = all.filter(
      (m) =>
        role === "admin" ||
        role === "drone_ops" ||
        user.organizationId === m.pickupOrgId ||
        user.organizationId === m.dropoffOrgId,
    );
    const orgs = await ctx.db.query("organizations").collect();
    const byId = new Map(orgs.map((o) => [o._id, o]));
    const drones = await ctx.db.query("drones").collect();
    const droneById = new Map(drones.map((d) => [d._id, d]));
    return scoped
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40)
      .map((m) => ({
        _id: m._id,
        missionId: m.missionId,
        state: m.state,
        simulated: m.simulated,
        bloodGroup: m.bloodGroup,
        component: m.component,
        units: m.units,
        payloadKg: m.payloadKg,
        totalKm: m.totalKm,
        outboundKm: m.outboundKm,
        estimatedDurationMin: m.estimatedDurationMin,
        preflightPassed: m.preflightPassed,
        pickupName: byId.get(m.pickupOrgId)?.name ?? "Pickup",
        dropoffName: byId.get(m.dropoffOrgId)?.name ?? "Destination",
        droneCode: droneById.get(m.droneId)?.droneId ?? "Drone",
        droneModel: droneById.get(m.droneId)?.model ?? null,
        telemetry: m.telemetry ?? null,
        failure: m.failure ?? null,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        deliveredAt: m.deliveredAt ?? null,
        completedAt: m.completedAt ?? null,
        isDemo:
          (byId.get(m.pickupOrgId)?.isDemo ?? false) ||
          (byId.get(m.dropoffOrgId)?.isDemo ?? false),
      }));
  },
});

export const missionDetail = query({
  args: { missionId: v.id("droneMissions") },
  handler: async (ctx, args) => {
    const user = await optionalUser(ctx);
    if (!user) return null;
    const mission = await ctx.db.get(args.missionId);
    if (!mission) return null;
    const role = roleOf(user);
    if (
      role !== "admin" &&
      role !== "drone_ops" &&
      user.organizationId !== mission.pickupOrgId &&
      user.organizationId !== mission.dropoffOrgId
    ) {
      throw new Error("Your facility is not part of this mission.");
    }
    const drone = await ctx.db.get(mission.droneId);
    const pickup = await ctx.db.get(mission.pickupOrgId);
    const dropoff = await ctx.db.get(mission.dropoffOrgId);
    const transfer = mission.transferId ? await ctx.db.get(mission.transferId) : null;
    const events = await ctx.db
      .query("missionEvents")
      .withIndex("by_mission", (q) => q.eq("missionId", mission._id))
      .collect();
    return {
      mission: {
        _id: mission._id,
        missionId: mission.missionId,
        state: mission.state,
        simulated: mission.simulated,
        bloodGroup: mission.bloodGroup,
        component: mission.component,
        units: mission.units,
        payloadKg: mission.payloadKg,
        route: mission.route,
        outboundKm: mission.outboundKm,
        returnKm: mission.returnKm,
        totalKm: mission.totalKm,
        preflight: mission.preflight,
        preflightPassed: mission.preflightPassed,
        weather: mission.weather,
        airspace: mission.airspace,
        containerTempC: mission.containerTempC,
        estimatedDurationMin: mission.estimatedDurationMin,
        telemetry: mission.telemetry ?? null,
        stateHistory: mission.stateHistory,
        failure: mission.failure ?? null,
        deliveryEvidence: mission.deliveryEvidence ?? null,
        // The receiver needs the handoff code; the sender does not see it.
        deliveryCode:
          user.organizationId === mission.dropoffOrgId ||
          role === "admin" ||
          role === "drone_ops"
            ? mission.deliveryCode ?? null
            : null,
        createdAt: mission.createdAt,
        dispatchedAt: mission.dispatchedAt ?? null,
        deliveredAt: mission.deliveredAt ?? null,
        completedAt: mission.completedAt ?? null,
        note: mission.note ?? null,
        transferId: mission.transferId ?? null,
        transferCode: transfer?.transferId ?? null,
      },
      drone: drone
        ? {
            droneId: drone.droneId,
            model: drone.model,
            manufacturer: drone.manufacturer,
            batteryPct: drone.batteryPct,
            linkStatus: drone.linkStatus,
            flightController: drone.flightController,
            containerTempC: drone.containerTempC,
          }
        : null,
      pickup: pickup ? { name: pickup.name, city: pickup.city, phone: pickup.phone } : null,
      dropoff: dropoff ? { name: dropoff.name, city: dropoff.city, phone: dropoff.phone } : null,
      events: events
        .sort((a, b) => a.at - b.at)
        .map((e) => ({
          _id: e._id,
          fromState: e.fromState ?? null,
          toState: e.toState,
          at: e.at,
          note: e.note ?? null,
          simulated: e.isSimulated,
        })),
      stateLabels: MISSION_STATE_LABELS,
      stateTransitions: MISSION_STATES,
      disclaimer:
        "This is a software-in-the-loop simulation. No PX4/ArduPilot vehicle or real aircraft is connected. Real operations require DGCA approvals, airspace clearance, certified equipment and a remote pilot.",
    };
  },
});

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return null;
    const role = roleOf(user);
    if (!["admin", "drone_ops", "hospital", "red_cross"].includes(role)) return null;
    const drones = await ctx.db.query("drones").collect();
    const missions = await ctx.db.query("droneMissions").collect();
    const orgId = user.organizationId;
    const scopedDrones =
      role === "admin" || role === "drone_ops"
        ? drones
        : drones.filter((d) => d.organizationId === orgId);
    const scopedMissions =
      role === "admin" || role === "drone_ops"
        ? missions
        : missions.filter((m) => m.pickupOrgId === orgId || m.dropoffOrgId === orgId);
    const active = scopedMissions.filter((m) => ACTIVE_STATES.has(m.state as MissionState));
    return {
      fleet: scopedDrones.length,
      available: scopedDrones.filter((d) => d.status === "available").length,
      charging: scopedDrones.filter((d) => d.status === "charging").length,
      maintenance: scopedDrones.filter((d) => d.status === "maintenance" || d.maintenanceStatus === "grounded").length,
      activeMissions: active.length,
      completed: scopedMissions.filter((m) => m.state === "COMPLETED").length,
      holds: scopedMissions.filter((m) => m.state === "HOLD").length,
      emergencies: scopedMissions.filter((m) => m.state === "EMERGENCY_LANDING").length,
      deliveredUnits: scopedMissions
        .filter((m) => ["DELIVERED", "RETURNING_TO_BASE", "COMPLETED"].includes(m.state))
        .reduce((sum, m) => sum + m.units, 0),
      simulated: true,
    };
  },
});
