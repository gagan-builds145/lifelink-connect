/**
 * Shared supply-chain engine.
 *
 * Everything in this module is pure and deterministic so the exact same rules
 * run in the Convex backend, in the dashboards and in the automated tests.
 *
 * Two boundaries are deliberate and must not move:
 *  1. Clinical compatibility comes from `./blood` (a specialist-reviewable
 *     matrix). No model in this file is ever allowed to decide compatibility.
 *  2. Machine learning only *forecasts demand*, *ranks donor invitations* and
 *     *flags anomalies*. It never authorises a release, a reservation or a
 *     flight.
 */

import {
  compatibility,
  haversineKm,
  stateOfCity,
  type BloodGroup,
  type Component,
  type Urgency,
} from "./blood";

export type GeoPoint = { lat: number; lng: number };
export type SupplyScope = "city" | "district" | "state" | "country";

export const SUPPLY_SCOPES: SupplyScope[] = ["city", "district", "state", "country"];

/* ------------------------------------------------------------------ *
 * Eligibility and ranking
 * ------------------------------------------------------------------ */

export type BatchCandidate = {
  id: string;
  organizationId: string;
  organizationName: string;
  city: string;
  point: GeoPoint | null;
  bloodGroup: BloodGroup;
  component: Component;
  /** Physical units recorded in the batch. */
  unitsAvailable: number;
  /** Units already held for other requests. */
  unitsReserved: number;
  /** Units this facility refuses to release except under emergency override. */
  protectedReserve: number;
  expiryDate: string;
  verified: boolean;
  screened: boolean;
  released: boolean;
  isDemo: boolean;
};

export type SupplyNeed = {
  bloodGroup: BloodGroup;
  component: Component;
  units: number;
  city: string;
  urgency: Urgency;
  scope: SupplyScope;
  /** Only used for the district tier. */
  maxDistanceKm?: number;
};

export type CandidateEligibility = {
  eligible: boolean;
  /** 1 = same city, 2 = same state near, 3 = same state, 4 = other state. */
  tier: 1 | 2 | 3 | 4 | null;
  distanceKm: number | null;
  usableUnits: number;
  reasons: string[];
  blockers: string[];
};

const DAY_MS = 86_400_000;

export function daysUntil(date: string, today = new Date().toISOString().slice(0, 10)) {
  const start = new Date(`${today}T00:00:00Z`).getTime();
  const end = new Date(`${date}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.floor((end - start) / DAY_MS);
}

/** Same state is mandatory for any tier; cross-state only on emergency country scope. */
export function geoEligibility(
  sourceCity: string,
  need: Pick<SupplyNeed, "city" | "urgency" | "scope" | "maxDistanceKm">,
  sourcePoint?: GeoPoint | null,
  needPoint?: GeoPoint | null,
) {
  const sourceState = stateOfCity(sourceCity);
  const needState = stateOfCity(need.city);
  const sameCity = sourceCity.trim().toLowerCase() === need.city.trim().toLowerCase();
  const sameState = sameCity || (sourceState != null && needState != null && sourceState === needState);
  const distanceKm =
    sourcePoint && needPoint
      ? Math.round(haversineKm(sourcePoint, needPoint) * 10) / 10
      : null;

  const emergency = need.urgency === "emergency";
  const allowed: SupplyScope[] = emergency ? ["city", "district", "state", "country"] : ["city"];
  if (!allowed.includes(need.scope)) {
    return {
      ok: false,
      tier: null,
      distanceKm,
      blockers: [
        emergency
          ? `Search scope ${need.scope} is not enabled for this request.`
          : "Routine and urgent requests search the requesting city only. Widen to the state or country only for an emergency.",
      ],
    };
  }

  if (need.scope === "country") {
    return {
      ok: emergency,
      tier: emergency ? (4 as const) : null,
      distanceKm,
      blockers: emergency ? [] : ["Country-wide institutional search is reserved for emergencies."],
    };
  }
  if (need.scope === "state") {
    return {
      ok: sameState,
      tier: sameState ? (3 as const) : null,
      distanceKm,
      blockers: sameState ? [] : ["This facility is outside the requesting state."],
    };
  }
  if (need.scope === "district") {
    const radius = need.maxDistanceKm ?? 75;
    const near = distanceKm != null && distanceKm <= radius;
    return {
      ok: sameState && near,
      tier: sameState && near ? (2 as const) : null,
      distanceKm,
      blockers: [
        ...(sameState ? [] : ["This facility is outside the requesting state."]),
        ...(near ? [] : [`This facility is outside the ${radius} km district radius.`]),
      ],
    };
  }
  return {
    ok: sameCity,
    tier: sameCity ? (1 as const) : null,
    distanceKm,
    blockers: sameCity ? [] : ["This facility is outside the requesting city."],
  };
}

export function evaluateCandidate(
  batch: BatchCandidate,
  need: SupplyNeed,
  options?: { today?: string; needPoint?: GeoPoint | null },
): CandidateEligibility {
  const today = options?.today ?? new Date().toISOString().slice(0, 10);
  const reasons: string[] = [];
  const blockers: string[] = [];

  const geo = geoEligibility(batch.city, need, batch.point, options?.needPoint ?? null);
  blockers.push(...geo.blockers);

  if (!batch.verified) blockers.push("Stock is not verified by an authorized facility.");
  if (!batch.screened) blockers.push("Batch has not been released by screening and testing.");
  if (!batch.released) blockers.push("Unit is not marked released for transfusion.");

  const expiryDays = daysUntil(batch.expiryDate, today);
  if (expiryDays == null) blockers.push("Expiry date is invalid.");
  else if (expiryDays < 0) blockers.push("Batch has passed its expiry date.");

  const usableUnits = Math.max(0, batch.unitsAvailable - batch.unitsReserved - batch.protectedReserve);
  if (usableUnits <= 0) blockers.push("No units are free outside the protected reserve.");

  const compat = compatibility(batch.bloodGroup, need.bloodGroup, need.component);
  if (!compat.compatible) blockers.push("ABO/Rh rules do not allow this component for the recipient.");
  else reasons.push(compat.note);

  if (batch.isDemo) reasons.push("Demo inventory — not live hospital stock.");

  const eligible = blockers.length === 0;

  if (eligible) {
    reasons.unshift(
      geo.tier === 1
        ? "Same city as the requesting facility"
        : geo.tier === 2
          ? `Within the district radius (${geo.distanceKm ?? "?"} km)`
          : geo.tier === 3
            ? "Elsewhere in the same state (emergency expansion)"
            : "Outside the state — emergency national search",
    );
    if (usableUnits >= need.units) reasons.push(`Can cover the full request (${usableUnits} free units)`);
    else reasons.push(`${usableUnits} free unit(s) available`);
    if (expiryDays != null) reasons.push(`${expiryDays} day(s) of shelf life remaining`);
  }

  return {
    eligible,
    tier: eligible ? geo.tier : geo.tier,
    distanceKm: geo.distanceKm,
    usableUnits,
    reasons,
    blockers,
  };
}

export type RankedCandidate = {
  candidate: BatchCandidate;
  eligibility: CandidateEligibility;
  score: number;
  warnings: string[];
};

/**
 * Transparent score (0–100). Distance alone can never outrank an
 * incompatible or unreleased unit because those are filtered out first.
 */
export function rankCandidate(
  batch: BatchCandidate,
  need: SupplyNeed,
  options?: { today?: string; needPoint?: GeoPoint | null },
): RankedCandidate {
  const today = options?.today ?? new Date().toISOString().slice(0, 10);
  const eligibility = evaluateCandidate(batch, need, { today, needPoint: options?.needPoint ?? null });
  if (!eligibility.eligible) {
    return { candidate: batch, eligibility, score: 0, warnings: eligibility.blockers };
  }

  let score = 30;
  const warnings: string[] = [];

  if (eligibility.tier === 1) score += 28;
  else if (eligibility.tier === 2) score += 20;
  else if (eligibility.tier === 3) score += 12;
  else score += 4;

  if (eligibility.distanceKm != null) {
    score += Math.max(0, 18 - eligibility.distanceKm / 12);
  }

  const expiryDays = daysUntil(batch.expiryDate, today) ?? 0;
  if (expiryDays <= 3) {
    score += 4;
    warnings.push("Expires within 3 days — dispatch only if transport is immediate.");
  } else if (expiryDays <= 7) {
    score += 10;
    warnings.push("Expires within a week.");
  } else if (expiryDays <= 21) {
    score += 16;
  } else {
    score += 20;
  }

  if (eligibility.usableUnits >= need.units) score += 12;
  else score += Math.min(10, eligibility.usableUnits * 2);

  if (batch.verified && batch.screened && batch.released) score += 10;
  if (need.urgency === "emergency") score += 4;

  return {
    candidate: batch,
    eligibility,
    score: Math.round(Math.min(100, Math.max(0, score))),
    warnings,
  };
}

export function rankCandidates(
  batches: BatchCandidate[],
  need: SupplyNeed,
  options?: { today?: string; needPoint?: GeoPoint | null },
): RankedCandidate[] {
  return batches
    .map((batch) => rankCandidate(batch, need, options))
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const ea = daysUntil(a.candidate.expiryDate, options?.today) ?? Number.MAX_SAFE_INTEGER;
      const eb = daysUntil(b.candidate.expiryDate, options?.today) ?? Number.MAX_SAFE_INTEGER;
      if (ea !== eb) return ea - eb;
      return a.candidate.id.localeCompare(b.candidate.id);
    });
}

/* ------------------------------------------------------------------ *
 * Partial allocation
 * ------------------------------------------------------------------ */

export type AllocationLine = {
  candidateId: string;
  organizationId: string;
  organizationName: string;
  city: string;
  bloodGroup: BloodGroup;
  component: Component;
  units: number;
  expiryDate: string;
  distanceKm: number | null;
  isDemo: boolean;
};

export type AllocationPlan = {
  allocations: AllocationLine[];
  unitsAllocated: number;
  shortfall: number;
  fullyCovered: boolean;
  candidatesEvaluated: number;
  blockedCandidates: number;
  notes: string[];
};

/**
 * Greedy allocation across ranked facilities. Partial allocation is allowed but
 * units are never taken past a batch's protected reserve, and a facility that
 * cannot cover the remainder still contributes what it can.
 */
export function planAllocation(
  ranked: RankedCandidate[],
  requiredUnits: number,
  options?: { maxFacilities?: number },
): AllocationPlan {
  const notes: string[] = [];
  const allocations: AllocationLine[] = [];
  let remaining = Math.max(0, Math.round(requiredUnits));
  const maxFacilities = options?.maxFacilities ?? 5;

  for (const entry of ranked) {
    if (remaining <= 0) break;
    if (!entry.eligibility.eligible || entry.eligibility.usableUnits <= 0) continue;
    if (allocations.length >= maxFacilities) {
      notes.push(`Stopped after ${maxFacilities} facilities to keep transport coordination reviewable.`);
      break;
    }
    const take = Math.min(remaining, entry.eligibility.usableUnits);
    if (take <= 0) continue;
    allocations.push({
      candidateId: entry.candidate.id,
      organizationId: entry.candidate.organizationId,
      organizationName: entry.candidate.organizationName,
      city: entry.candidate.city,
      bloodGroup: entry.candidate.bloodGroup,
      component: entry.candidate.component,
      units: take,
      expiryDate: entry.candidate.expiryDate,
      distanceKm: entry.eligibility.distanceKm,
      isDemo: entry.candidate.isDemo,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    notes.push(
      `${remaining} unit(s) remain unmet after institutional allocation. Donor fallback is required.`,
    );
  }

  return {
    allocations,
    unitsAllocated: requiredUnits - remaining,
    shortfall: remaining,
    fullyCovered: remaining === 0,
    candidatesEvaluated: ranked.length,
    blockedCandidates: ranked.filter((r) => !r.eligibility.eligible).length,
    notes,
  };
}

export function computeShortage(requiredUnits: number, eligibleUnits: number) {
  const required = Math.max(0, Math.round(requiredUnits));
  const available = Math.max(0, Math.round(eligibleUnits));
  return {
    required,
    available,
    shortage: Math.max(0, required - available),
    covered: available >= required,
    coveragePct: required === 0 ? 100 : Math.round((Math.min(available, required) / required) * 100),
  };
}

/* ------------------------------------------------------------------ *
 * Drone routing
 * ------------------------------------------------------------------ */

export type WaypointKind = "pickup" | "corridor" | "waypoint" | "diversion" | "landing";

export type Waypoint = {
  lat: number;
  lng: number;
  label: string;
  kind: WaypointKind;
};

export type RestrictedZone = {
  id: string;
  name: string;
  center: GeoPoint;
  radiusKm: number;
  kind: "restricted" | "corridor";
};

const round = (n: number, places = 5) => Number(n.toFixed(places));

/** Moves a point `km` perpendicular to the a→b bearing. */
function offsetPoint(a: GeoPoint, b: GeoPoint, fraction: number, offsetKm: number): GeoPoint {
  const lat = a.lat + (b.lat - a.lat) * fraction;
  const lng = a.lng + (b.lng - a.lng) * fraction;
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  const length = Math.hypot(dLat, dLng) || 1;
  const perpLat = -dLng / length;
  const perpLng = dLat / length;
  const kmPerDegLat = 110.574;
  const kmPerDegLng = Math.max(1, 111.32 * Math.cos((lat * Math.PI) / 180));
  return {
    lat: round(lat + (perpLat * offsetKm) / kmPerDegLat),
    lng: round(lng + (perpLng * offsetKm) / kmPerDegLng),
  };
}

export function polylineKm(points: GeoPoint[]) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += haversineKm(points[i - 1], points[i]);
  return Math.round(total * 100) / 100;
}

export function pointInZone(point: GeoPoint, zone: RestrictedZone) {
  return haversineKm(point, zone.center) <= zone.radiusKm;
}

export type RoutePlan = {
  waypoints: Waypoint[];
  outboundKm: number;
  returnKm: number;
  totalKm: number;
  corridorOffsetKm: number;
  intersectsZoneIds: string[];
  avoidedZoneIds: string[];
  /** Always false: this is a planning proxy, not an approved flight route. */
  approvedForFlight: false;
  note: string;
};

/**
 * Generates a multi-leg corridor route with a return leg. It deliberately
 * refuses to claim airworthiness: real flights need approved corridors,
 * obstacle data, NOTAMs and a certified remote pilot.
 */
export function planDroneRoute(input: {
  pickup: GeoPoint;
  dropoff: GeoPoint;
  pickupLabel?: string;
  dropoffLabel?: string;
  corridorOffsetKm?: number;
  zones?: RestrictedZone[];
}): RoutePlan {
  const offset = input.corridorOffsetKm ?? 0.9;
  const pickup = { ...input.pickup };
  const dropoff = { ...input.dropoff };
  const straightKm = haversineKm(pickup, dropoff);

  const candidates: Array<{ offset: number; mids: GeoPoint[] }> = [
    { offset, mids: [offsetPoint(pickup, dropoff, 0.34, offset), offsetPoint(pickup, dropoff, 0.7, offset)] },
    {
      offset: -offset,
      mids: [offsetPoint(pickup, dropoff, 0.34, -offset), offsetPoint(pickup, dropoff, 0.7, -offset)],
    },
  ];

  const zones = input.zones ?? [];
  let chosen = candidates[0];
  let intersects: string[] = [];
  for (const candidate of candidates) {
    const hit = zones.filter(
      (z) => z.kind === "restricted" && candidate.mids.some((p) => pointInZone(p, z)),
    );
    if (hit.length === 0) {
      chosen = candidate;
      intersects = [];
      break;
    }
    intersects = hit.map((z) => z.id);
  }

  const outbound: Waypoint[] = [
    { ...pickup, label: input.pickupLabel ?? "Pickup facility", kind: "pickup" },
    { ...chosen.mids[0], label: "Approved corridor checkpoint 1", kind: "corridor" },
    { ...chosen.mids[1], label: "Approved corridor checkpoint 2", kind: "corridor" },
    { ...dropoff, label: input.dropoffLabel ?? "Destination facility", kind: "landing" },
  ];

  const avoided = zones
    .filter(
      (z) =>
        z.kind === "restricted" &&
        !outbound.some((p) => pointInZone({ lat: p.lat, lng: p.lng }, z)),
    )
    .map((z) => z.id);

  const outboundKm = polylineKm(outbound);
  const returnKm = polylineKm([dropoff, { ...chosen.mids[1] }, { ...chosen.mids[0] }, pickup]);
  const intersectsFinal = zones
    .filter((z) => z.kind === "restricted" && outbound.some((p) => pointInZone(p, z)))
    .map((z) => z.id);

  return {
    waypoints: outbound,
    outboundKm,
    returnKm,
    totalKm: Math.round((outboundKm + returnKm) * 100) / 100,
    corridorOffsetKm: chosen.offset,
    intersectsZoneIds: intersectsFinal,
    avoidedZoneIds: avoided,
    approvedForFlight: false,
    note:
      straightKm < 0.2
        ? "Pickup and destination are within 200 m; confirm a shared landing zone before planning."
        : "Corridor proxy generated from facility coordinates. Verify obstacle data, NOTAMs and landing-zone approval before any real flight.",
  };
}

/* ------------------------------------------------------------------ *
 * Drone performance and preflight
 * ------------------------------------------------------------------ */

export type DroneSpec = {
  maxPayloadKg: number;
  batteryCapacityWh: number;
  maxRangeKm: number;
  cruiseSpeedKmh: number;
  batteryPct: number;
  linkStatus: "online" | "degraded" | "offline";
  gpsAvailable: boolean;
  maintenanceStatus: "ok" | "due" | "grounded";
  containerReady: boolean;
};

export type ComponentStorage = { minC: number; maxC: number; label: string };

export function storageRangeFor(component: Component): ComponentStorage {
  switch (component) {
    case "platelets":
      return { minC: 20, maxC: 24, label: "20–24 °C with agitation" };
    case "plasma":
      return { minC: -30, maxC: -18, label: "≤ −18 °C" };
    default:
      return { minC: 2, maxC: 6, label: "2–6 °C" };
  }
}

export function energyRequirement(input: {
  drone: Pick<DroneSpec, "batteryCapacityWh" | "maxRangeKm" | "maxPayloadKg" | "batteryPct">;
  totalKm: number;
  payloadKg: number;
  reservePct?: number;
}) {
  const { drone, totalKm, payloadKg } = input;
  const reservePct = input.reservePct ?? 25;
  const whPerKm = drone.maxRangeKm > 0 ? drone.batteryCapacityWh / drone.maxRangeKm : Infinity;
  const loadFactor = 1 + 0.55 * Math.min(1, Math.max(0, payloadKg / Math.max(0.1, drone.maxPayloadKg)));
  const requiredWh = Math.round(whPerKm * totalKm * loadFactor * 10) / 10;
  const reserveWh = Math.round((drone.batteryCapacityWh * reservePct) / 100 * 10) / 10;
  const availableWh = Math.round(((drone.batteryPct / 100) * drone.batteryCapacityWh - reserveWh) * 10) / 10;
  return {
    whPerKm: Math.round(whPerKm * 100) / 100,
    requiredWh,
    availableWh,
    reserveWh,
    reservePct,
    requiredPct: Math.round((requiredWh / drone.batteryCapacityWh) * 1000) / 10,
    feasible: availableWh >= requiredWh,
  };
}

export type PreflightCheck = {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  critical: boolean;
};

export type WeatherInput = {
  windKmh: number;
  precipitationPct: number;
  visibilityKm: number;
  temperatureC: number;
  source: "simulated" | "manual" | "provider";
  observedAt: number;
};

export type AirspaceInput = {
  routeAuthorized: boolean;
  zones: RestrictedZone[];
  authorizationRef?: string;
  simulated: boolean;
};

export function preflightChecks(input: {
  drone: DroneSpec;
  payloadKg: number;
  payloadUnits: number;
  outboundKm: number;
  totalKm: number;
  route: RoutePlan;
  weather: WeatherInput;
  airspace: AirspaceInput;
  landingZoneAvailable: boolean;
  component: Component;
  containerTempC: number;
}): { checks: PreflightCheck[]; passed: boolean; failures: number; warnings: number } {
  const checks: PreflightCheck[] = [];
  const add = (check: PreflightCheck) => checks.push(check);

  const energy = energyRequirement({
    drone: input.drone,
    totalKm: input.totalKm,
    payloadKg: input.payloadKg,
  });

  add({
    key: "battery",
    label: "Battery and energy reserve",
    status: input.drone.batteryPct >= 20 ? (energy.feasible ? "pass" : "fail") : "fail",
    detail: `${input.drone.batteryPct}% charged; ${energy.requiredWh} Wh needed including a ${energy.reservePct}% reserve (${energy.availableWh} Wh usable).`,
    critical: true,
  });
  add({
    key: "payload",
    label: "Payload capacity",
    status: input.payloadKg <= input.drone.maxPayloadKg ? "pass" : "fail",
    detail: `${input.payloadKg.toFixed(2)} kg payload against a ${input.drone.maxPayloadKg} kg limit (${input.payloadUnits} unit(s) plus container).`,
    critical: true,
  });
  add({
    key: "range",
    label: "Mission range",
    status: input.totalKm <= input.drone.maxRangeKm ? "pass" : "fail",
    detail: `${input.totalKm} km round trip against a ${input.drone.maxRangeKm} km rated range.`,
    critical: true,
  });
  add({
    key: "gps",
    label: "GPS / navigation fix",
    status: input.drone.gpsAvailable ? "pass" : "fail",
    detail: input.drone.gpsAvailable
      ? "Navigation fix available in the simulated flight controller."
      : "No navigation fix. Dispatch is blocked.",
    critical: true,
  });
  add({
    key: "link",
    label: "Command and telemetry link",
    status: input.drone.linkStatus === "online" ? "pass" : input.drone.linkStatus === "degraded" ? "warn" : "fail",
    detail:
      input.drone.linkStatus === "online"
        ? "MAVLink telemetry simulated as healthy."
        : input.drone.linkStatus === "degraded"
          ? "Degraded link: mission must hold if telemetry drops."
          : "Link offline. Dispatch is blocked.",
    critical: true,
  });
  add({
    key: "navigation",
    label: "Waypoint and navigation readiness",
    status: input.route.waypoints.length >= 3 ? "pass" : "fail",
    detail: `${input.route.waypoints.length} waypoint(s) generated in the corridor proxy.`,
    critical: true,
  });
  const weatherOk = input.weather.windKmh <= 35 && input.weather.visibilityKm >= 3 && input.weather.precipitationPct <= 60;
  add({
    key: "weather",
    label: "Weather limits",
    status: weatherOk ? "pass" : "fail",
    detail: `${input.weather.source} observation: wind ${input.weather.windKmh} km/h, visibility ${input.weather.visibilityKm} km, precipitation ${input.weather.precipitationPct}%.`,
    critical: true,
  });
  add({
    key: "airspace",
    label: "Airspace authorisation",
    status: !input.airspace.routeAuthorized
      ? "fail"
      : input.route.intersectsZoneIds.length > 0
        ? "fail"
        : "pass",
    detail: !input.airspace.routeAuthorized
      ? "No corridor authorisation recorded. Real flights require DGCA/ATC approval."
      : input.route.intersectsZoneIds.length > 0
        ? `Planned route enters ${input.route.intersectsZoneIds.length} restricted zone(s).`
        : `Route clear of ${input.airspace.zones.length} restricted zone(s) in the ${input.airspace.simulated ? "simulated" : "loaded"} dataset.`,
    critical: true,
  });
  add({
    key: "landing",
    label: "Landing zone availability",
    status: input.landingZoneAvailable ? "pass" : "fail",
    detail: input.landingZoneAvailable
      ? "Destination landing zone marked available."
      : "Destination landing zone is unavailable or not confirmed.",
    critical: true,
  });
  add({
    key: "return",
    label: "Return-to-base capability",
    status: energy.feasible ? "pass" : "fail",
    detail: `Return leg included: ${input.route.returnKm} km. Total plan ${input.totalKm} km.`,
    critical: true,
  });
  const storage = storageRangeFor(input.component);
  const tempOk = input.containerTempC >= storage.minC && input.containerTempC <= storage.maxC;
  add({
    key: "container",
    label: "Temperature-controlled container",
    status: input.drone.containerReady && tempOk ? "pass" : "fail",
    detail: input.drone.containerReady
      ? `Container reading ${input.containerTempC} °C; ${storage.label} required.`
      : "Container not confirmed ready.",
    critical: true,
  });
  add({
    key: "maintenance",
    label: "Airframe maintenance status",
    status: input.drone.maintenanceStatus === "ok" ? "pass" : input.drone.maintenanceStatus === "due" ? "warn" : "fail",
    detail:
      input.drone.maintenanceStatus === "ok"
        ? "Maintenance current."
        : input.drone.maintenanceStatus === "due"
          ? "Maintenance due soon; supervisor sign-off required."
          : "Airframe grounded for maintenance.",
    critical: input.drone.maintenanceStatus === "grounded",
  });

  const failures = checks.filter((c) => c.status === "fail").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  return { checks, passed: failures === 0, failures, warnings };
}

/* ------------------------------------------------------------------ *
 * Mission state machine
 * ------------------------------------------------------------------ */

export const MISSION_STATES = [
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
  "COMPLETED",
  "HOLD",
  "ABORTED",
  "EMERGENCY_LANDING",
] as const;
export type MissionState = (typeof MISSION_STATES)[number];

export const MISSION_STATE_LABELS: Record<MissionState, string> = {
  PLANNED: "Planned",
  PREFLIGHT_CHECKING: "Preflight checking",
  PREFLIGHT_PASSED: "Preflight passed",
  DISPATCHED_TO_PICKUP: "Dispatched to pickup",
  AT_PICKUP: "At pickup",
  PAYLOAD_LOADING: "Payload loading",
  PAYLOAD_LOADED: "Payload loaded",
  IN_TRANSIT_TO_DESTINATION: "In transit to destination",
  AT_DESTINATION: "At destination",
  DELIVERED: "Delivered",
  RETURNING_TO_BASE: "Returning to base",
  COMPLETED: "Completed",
  HOLD: "Hold",
  ABORTED: "Aborted",
  EMERGENCY_LANDING: "Emergency landing",
};

export const MISSION_TRANSITIONS: Record<MissionState, MissionState[]> = {
  PLANNED: ["PREFLIGHT_CHECKING", "HOLD", "ABORTED"],
  PREFLIGHT_CHECKING: ["PREFLIGHT_PASSED", "HOLD", "ABORTED"],
  PREFLIGHT_PASSED: ["DISPATCHED_TO_PICKUP", "HOLD", "ABORTED"],
  DISPATCHED_TO_PICKUP: ["AT_PICKUP", "HOLD", "ABORTED", "EMERGENCY_LANDING"],
  AT_PICKUP: ["PAYLOAD_LOADING", "HOLD", "ABORTED", "EMERGENCY_LANDING"],
  PAYLOAD_LOADING: ["PAYLOAD_LOADED", "HOLD", "ABORTED", "EMERGENCY_LANDING"],
  PAYLOAD_LOADED: ["IN_TRANSIT_TO_DESTINATION", "HOLD", "ABORTED", "EMERGENCY_LANDING"],
  IN_TRANSIT_TO_DESTINATION: ["AT_DESTINATION", "HOLD", "ABORTED", "EMERGENCY_LANDING"],
  AT_DESTINATION: ["DELIVERED", "HOLD", "ABORTED", "EMERGENCY_LANDING"],
  DELIVERED: ["RETURNING_TO_BASE"],
  RETURNING_TO_BASE: ["COMPLETED", "EMERGENCY_LANDING", "ABORTED"],
  COMPLETED: [],
  HOLD: ["PREFLIGHT_CHECKING", "DISPATCHED_TO_PICKUP", "RETURNING_TO_BASE", "ABORTED"],
  ABORTED: [],
  EMERGENCY_LANDING: ["ABORTED"],
};

export function canTransition(from: MissionState, to: MissionState) {
  return MISSION_TRANSITIONS[from]?.includes(to) ?? false;
}

export const ACTIVE_MISSION_STATES: MissionState[] = [
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
];

/** Payload mass proxy: 0.35 kg per unit plus the insulated container. */
export function payloadMassKg(units: number, containerKg = 1.4) {
  return Math.round((Math.max(0, units) * 0.35 + containerKg) * 100) / 100;
}

/* ------------------------------------------------------------------ *
 * Legacy demand-forecasting reference implementation
 *
 * This ridge code is retained only for historical unit tests. The active
 * Convex/React path uses the Python XGBoost service in ml_service/ and the
 * authenticated actions in src/convex/ml.ts. Do not wire this function into
 * new UI code.
 * ------------------------------------------------------------------ */

export type DailyPoint = { date: string; units: number };

export type ForecastMetrics = {
  mae: number;
  rmse: number;
  baselineMae: number;
  baselineRmse: number;
  trainSize: number;
  holdoutSize: number;
  meanActual: number;
};

export type DemandForecast = {
  status: "ok" | "insufficient_data";
  model: "ridge_ts_v1";
  sampleSize: number;
  metrics: ForecastMetrics | null;
  horizons: { h24: number | null; h7: number | null; h30: number | null };
  confidence: number | null;
  confidenceLabel: "high" | "medium" | "low" | null;
  explanation: string;
};

const historyFeatureRow = (points: DailyPoint[], index: number) => {
  const lag1 = points[index - 1]?.units ?? 0;
  const lag7 = points[index - 7]?.units ?? lag1;
  const window = points.slice(Math.max(0, index - 7), index);
  const mean7 = window.length ? window.reduce((sum, p) => sum + p.units, 0) / window.length : lag1;
  const dow = new Date(`${points[index].date}T00:00:00Z`).getUTCDay();
  return [1, lag1, lag7, mean7, Math.sin((2 * Math.PI * dow) / 7), Math.cos((2 * Math.PI * dow) / 7), index];
};

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let j = col; j <= n; j += 1) a[col][j] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= n; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[n]);
}

type Standardizer = { means: number[]; sds: number[] };

function fitStandardizer(rows: number[][]): Standardizer {
  const width = rows[0]?.length ?? 0;
  const means = Array(width).fill(0);
  const sds = Array(width).fill(0);
  for (const row of rows) {
    for (let j = 0; j < width; j += 1) means[j] += row[j];
  }
  for (let j = 0; j < width; j += 1) means[j] /= Math.max(1, rows.length);
  for (const row of rows) {
    for (let j = 0; j < width; j += 1) sds[j] += (row[j] - means[j]) ** 2;
  }
  for (let j = 0; j < width; j += 1) sds[j] = Math.sqrt(sds[j] / Math.max(1, rows.length)) || 1;
  return { means, sds };
}

function standardizeRow(row: number[], s: Standardizer) {
  // Column 0 is the intercept: standardising it to zero would make the ridge
  // system singular, so it is passed through unchanged.
  return row.map((value, index) =>
    index === 0 ? value : (value - s.means[index]) / s.sds[index],
  );
}

function fitRidge(rows: number[][], targets: number[], lambda = 2): number[] | null {
  const width = rows[0]?.length ?? 0;
  const xtx = Array.from({ length: width }, () => Array(width).fill(0));
  const xty = Array(width).fill(0);
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = 0; j < width; j += 1) {
      xty[j] += rows[i][j] * targets[i];
      for (let k = 0; k < width; k += 1) xtx[j][k] += rows[i][j] * rows[i][k];
    }
  }
  // Do not penalise the intercept.
  for (let j = 1; j < width; j += 1) xtx[j][j] += lambda;
  return solveLinearSystem(xtx, xty);
}

const roundMetric = (value: number) => Math.round(value * 100) / 100;

export function forecastDemand(pointsIn: DailyPoint[], opts?: { lambda?: number }): DemandForecast {
  // De-duplicate by date and keep chronological order: never mix future rows
  // into training data.
  const byDate = new Map<string, number>();
  for (const point of pointsIn) byDate.set(point.date, Math.max(0, point.units));
  const points = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, units]) => ({ date, units }));
  const model = "ridge_ts_v1" as const;

  if (points.length < 14) {
    return {
      status: "insufficient_data",
      model,
      sampleSize: points.length,
      metrics: null,
      horizons: { h24: null, h7: null, h30: null },
      confidence: null,
      confidenceLabel: null,
      explanation: `At least 14 daily demand points are required for a chronological evaluation; only ${points.length} are available. No forecast is shown rather than guessing.`,
    };
  }

  const rows: number[][] = [];
  const targets: number[] = [];
  const baseRows: number[][] = [];
  for (let i = 7; i < points.length; i += 1) {
    rows.push(historyFeatureRow(points, i));
    targets.push(points[i].units);
    const window = points.slice(Math.max(0, i - 7), i);
    baseRows.push([window.reduce((sum, p) => sum + p.units, 0) / Math.max(1, window.length)]);
  }

  const split = Math.max(8, Math.floor(rows.length * 0.8));
  const trainRows = rows.slice(0, split);
  const trainTargets = targets.slice(0, split);
  const testRows = rows.slice(split);
  const testTargets = targets.slice(split);
  const standardizer = fitStandardizer(trainRows);
  const standardizedTrain = trainRows.map((row) => standardizeRow(row, standardizer));
  const weights = fitRidge(standardizedTrain, trainTargets, opts?.lambda ?? 2);

  if (!weights || testRows.length === 0) {
    return {
      status: "insufficient_data",
      model,
      sampleSize: points.length,
      metrics: null,
      horizons: { h24: null, h7: null, h30: null },
      confidence: null,
      confidenceLabel: null,
      explanation: "The chronological holdout could not be fitted; no forecast is shown.",
    };
  }

  const predict = (row: number[]) =>
    Math.max(0, standardizeRow(row, standardizer).reduce((sum, v, i) => sum + v * weights[i], 0));

  let absError = 0;
  let sqError = 0;
  let baseAbs = 0;
  let baseSq = 0;
  for (let i = 0; i < testRows.length; i += 1) {
    const predicted = predict(testRows[i]);
    const baseline = baseRows[split + i][0];
    absError += Math.abs(predicted - testTargets[i]);
    sqError += (predicted - testTargets[i]) ** 2;
    baseAbs += Math.abs(baseline - testTargets[i]);
    baseSq += (baseline - testTargets[i]) ** 2;
  }
  const holdoutSize = testRows.length;
  const meanActual = testTargets.reduce((sum, v) => sum + v, 0) / Math.max(1, holdoutSize);
  const metrics: ForecastMetrics = {
    mae: roundMetric(absError / holdoutSize),
    rmse: roundMetric(Math.sqrt(sqError / holdoutSize)),
    baselineMae: roundMetric(baseAbs / holdoutSize),
    baselineRmse: roundMetric(Math.sqrt(baseSq / holdoutSize)),
    trainSize: trainRows.length,
    holdoutSize,
    meanActual: roundMetric(meanActual),
  };

  // Recursive forecast on the full series.
  const extended = [...points];
  const today = new Date();
  const predictedDaily: number[] = [];
  for (let step = 1; step <= 30; step += 1) {
    const date = new Date(today.getTime() + step * DAY_MS).toISOString().slice(0, 10);
    // Append the target day first so the feature helper can read its
    // day-of-week; lags still look backwards at observed/forecast days only.
    extended.push({ date, units: 0 });
    const row = historyFeatureRow(extended, extended.length - 1);
    const value = Math.round(predict(row) * 10) / 10;
    predictedDaily.push(value);
    extended[extended.length - 1] = { date, units: value };
  }

  const sum = (values: number[]) => Math.round(values.reduce((total, v) => total + v, 0) * 10) / 10;
  const confidence = Math.min(0.95, Math.max(0.05, 1 - metrics.rmse / Math.max(1, metrics.meanActual)));
  const confidenceLabel = confidence >= 0.7 ? "high" : confidence >= 0.45 ? "medium" : "low";

  return {
    status: "ok",
    model,
    sampleSize: points.length,
    metrics,
    horizons: { h24: predictedDaily[0], h7: sum(predictedDaily.slice(0, 7)), h30: sum(predictedDaily) },
    confidence: Math.round(confidence * 100) / 100,
    confidenceLabel,
    explanation: `Ridge regression (${model}) with day-of-week seasonality, 1- and 7-day lags and a rolling mean. Chronological holdout: last ${holdoutSize} of ${rows.length} samples. Baseline is a 7-day rolling mean.`,
  };
}

/* ------------------------------------------------------------------ *
 * Anomaly detection (statistical, explainable)
 * ------------------------------------------------------------------ */

export type AnomalyFinding = {
  date: string;
  observed: number;
  expected: number;
  zScore: number;
  direction: "spike" | "drop";
  severity: "warning" | "critical";
  reason: string;
};

export function detectAnomalies(pointsIn: DailyPoint[], threshold = 2.5): AnomalyFinding[] {
  const points = [...pointsIn].sort((a, b) => a.date.localeCompare(b.date));
  const findings: AnomalyFinding[] = [];
  for (let i = 8; i < points.length; i += 1) {
    const window = points.slice(Math.max(0, i - 28), i).map((p) => p.units);
    const mean = window.reduce((sum, v) => sum + v, 0) / window.length;
    const variance = window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / window.length;
    const sd = Math.sqrt(variance);
    if (sd < 0.5) continue;
    const z = (points[i].units - mean) / sd;
    if (Math.abs(z) < threshold) continue;
    findings.push({
      date: points[i].date,
      observed: points[i].units,
      expected: Math.round(mean * 10) / 10,
      zScore: Math.round(z * 100) / 100,
      direction: z > 0 ? "spike" : "drop",
      severity: Math.abs(z) >= 3.5 ? "critical" : "warning",
      reason: `${z > 0 ? "Unusual demand spike" : "Unexpected stock depletion"}: ${points[i].units} unit(s) against a trailing 28-day average of ${Math.round(mean * 10) / 10}.`,
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ *
 * Donor response model (optional; never used for eligibility)
 * ------------------------------------------------------------------ */

export type DonorSample = {
  distanceKm: number;
  daysSinceDonation: number;
  previousDonations: number;
  priorResponseRate: number;
  responded: boolean;
};

export type DonorResponseModel = {
  weights: number[];
  means: number[];
  sds: number[];
  sampleSize: number;
  trainedAt: number;
  baseRate: number;
};

export type DonorFeatures = Omit<DonorSample, "responded">;

function donorRow(features: DonorFeatures) {
  return [
    1,
    Math.min(200, Math.max(0, features.distanceKm)),
    Math.min(365, Math.max(0, features.daysSinceDonation)),
    Math.min(20, Math.max(0, features.previousDonations)),
    Math.min(1, Math.max(0, features.priorResponseRate)),
  ];
}

export function fitDonorModel(samples: DonorSample[], now = Date.now()): DonorResponseModel | null {
  if (samples.length < 20) return null;
  const positives = samples.filter((s) => s.responded).length;
  if (positives < 4 || positives > samples.length - 4) return null;

  const rows = samples.map(donorRow);
  const standardizer = fitStandardizer(rows);
  const weight = Array(rows[0].length).fill(0);
  const lr = 0.12;
  for (let iteration = 0; iteration < 400; iteration += 1) {
    const gradient = Array(weight.length).fill(0);
    for (let i = 0; i < rows.length; i += 1) {
      const x = standardizeRow(rows[i], standardizer);
      const z = x.reduce((sum, value, j) => sum + value * weight[j], 0);
      const p = 1 / (1 + Math.exp(-z));
      const error = p - (samples[i].responded ? 1 : 0);
      for (let j = 0; j < weight.length; j += 1) gradient[j] += error * x[j];
    }
    for (let j = 0; j < weight.length; j += 1) weight[j] -= (lr * gradient[j]) / rows.length;
  }
  return {
    weights: weight,
    means: standardizer.means,
    sds: standardizer.sds,
    sampleSize: samples.length,
    trainedAt: now,
    baseRate: Math.round((positives / samples.length) * 100) / 100,
  };
}

export function donorResponseProbability(
  features: DonorFeatures,
  model: DonorResponseModel | null,
): { probability: number | null; basis: "trained_logistic" | "untrained"; detail: string } {
  if (!model) {
    return {
      probability: null,
      basis: "untrained",
      detail:
        "No donor-response model is trained in this deployment (fewer than 20 labelled invitations). Invitations fall back to distance and eligibility ranking.",
    };
  }
  const row = donorRow(features);
  const z = row.reduce(
    (sum, value, index) =>
      sum +
      (index === 0 ? value : (value - model.means[index]) / model.sds[index]) * model.weights[index],
    0,
  );
  const probability = 1 / (1 + Math.exp(-z));
  return {
    probability: Math.round(probability * 100) / 100,
    basis: "trained_logistic",
    detail: `Logistic donor-response model trained on ${model.sampleSize} labelled invitations; base response rate ${Math.round(model.baseRate * 100)}%. This is a ranking aid only.`,
  };
}

/* ------------------------------------------------------------------ *
 * Donor fallback gate
 * ------------------------------------------------------------------ */

export type DonorInviteCandidate = {
  donorId: string;
  city: string;
  bloodGroup: BloodGroup;
  available: boolean;
  lastDonationDate?: string | null;
  shareLocationConsent: boolean;
  consentExpiresAt?: number | null;
};

export function donorInviteEligibility(
  donor: DonorInviteCandidate,
  need: Pick<SupplyNeed, "bloodGroup" | "component" | "city" | "urgency">,
  options?: { now?: number; minDaysBetweenDonations?: number },
) {
  const now = options?.now ?? Date.now();
  const blockers: string[] = [];
  if (!donor.available) blockers.push("Donor has paused availability.");
  if (!donor.shareLocationConsent) blockers.push("No active temporary location-sharing consent.");
  if (donor.consentExpiresAt != null && donor.consentExpiresAt < now) {
    blockers.push("Location-sharing consent has expired.");
  }
  const minDays = options?.minDaysBetweenDonations ?? 90;
  if (donor.lastDonationDate) {
    const days = Math.floor((now - new Date(donor.lastDonationDate).getTime()) / DAY_MS);
    if (Number.isFinite(days) && days < minDays) {
      blockers.push(`Only ${days} day(s) since the last donation; ${minDays}-day interval guidance not met.`);
    }
  }
  const location = geoEligibility(
    donor.city,
    { city: need.city, urgency: need.urgency, scope: need.urgency === "emergency" ? "state" : "city" },
  );
  blockers.push(...location.blockers);
  const compat = compatibility(donor.bloodGroup, need.bloodGroup, need.component);
  if (!compat.compatible) blockers.push("Blood group is not compatible with this need.");
  return {
    eligible: blockers.length === 0,
    blockers,
    /** Donors are never stock: only an invitation to donate. */
    invitationOnly: true as const,
  };
}

export const DONOR_FALLBACK_NOTE =
  "Donors are invited to donate; they are never treated as available blood units. Blood becomes issuable only after collection, screening, testing, processing and release by a licensed blood centre.";
