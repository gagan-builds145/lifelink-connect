import { describe, expect, test } from "bun:test";
import { compatibility } from "../src/lib/blood";
import {
  canTransition,
  computeShortage,
  daysUntil,
  detectAnomalies,
  donorInviteEligibility,
  donorResponseProbability,
  energyRequirement,
  evaluateCandidate,
  fitDonorModel,
  forecastDemand,
  geoEligibility,
  payloadMassKg,
  planAllocation,
  planDroneRoute,
  preflightChecks,
  rankCandidates,
  storageRangeFor,
  type BatchCandidate,
  type DailyPoint,
  type DonorSample,
  type DroneSpec,
  type SupplyNeed,
} from "../src/lib/supply";

const TODAY = "2026-11-08";
const PUNE = { lat: 18.5204, lng: 73.8567 };
const MUMBAI = { lat: 19.076, lng: 72.8777 };

function batch(overrides: Partial<BatchCandidate> = {}): BatchCandidate {
  return {
    id: "BATCH-1",
    organizationId: "ORG-1",
    organizationName: "Pune Blood Bank",
    city: "Pune",
    point: PUNE,
    bloodGroup: "O-",
    component: "red_cells",
    unitsAvailable: 6,
    unitsReserved: 0,
    protectedReserve: 2,
    expiryDate: "2026-12-01",
    verified: true,
    screened: true,
    released: true,
    isDemo: false,
    ...overrides,
  };
}

function need(overrides: Partial<SupplyNeed> = {}): SupplyNeed {
  return {
    bloodGroup: "O+",
    component: "red_cells",
    units: 4,
    city: "Pune",
    urgency: "urgent",
    scope: "city",
    ...overrides,
  };
}

const drone: DroneSpec = {
  maxPayloadKg: 6,
  batteryCapacityWh: 1000,
  maxRangeKm: 50,
  cruiseSpeedKmh: 54,
  batteryPct: 100,
  linkStatus: "online",
  gpsAvailable: true,
  maintenanceStatus: "ok",
  containerReady: true,
};

const weather = {
  windKmh: 12,
  precipitationPct: 5,
  visibilityKm: 9,
  temperatureC: 27,
  source: "simulated" as const,
  observedAt: Date.now(),
};

const airspace = { routeAuthorized: true, zones: [], simulated: true };

/* ------------------------------------------------------------------ */
/* 1. Dates, compatibility and geospatial scope                        */
/* ------------------------------------------------------------------ */

describe("supply eligibility primitives", () => {
  test("daysUntil handles valid and invalid dates", () => {
    expect(daysUntil("2026-11-08", TODAY)).toBe(0);
    expect(daysUntil("2026-11-18", TODAY)).toBe(10);
    expect(daysUntil("2026-11-01", TODAY)).toBe(-7);
    expect(daysUntil("not-a-date", TODAY)).toBeNull();
  });

  test("component-specific compatibility is deterministic", () => {
    expect(compatibility("O-", "O+", "red_cells").compatible).toBe(true);
    expect(compatibility("AB+", "O+", "red_cells").compatible).toBe(false);
    expect(compatibility("B+", "A+", "red_cells").compatible).toBe(false);
    expect(compatibility("O-", "A+", "red_cells").compatible).toBe(true);
    expect(compatibility("AB+", "A+", "plasma").compatible).toBe(true);
    expect(compatibility("A+", "B+", "plasma").compatible).toBe(false);
    expect(compatibility("", "O+", "red_cells").compatible).toBe(false);
  });

  test("routine requests stay city-only while emergencies can widen scope", () => {
    const routine = geoEligibility("Mumbai", need(), MUMBAI, PUNE);
    expect(routine.ok).toBe(false);
    expect(routine.blockers[0]).toContain("outside the requesting city");

    const emergencyDistrict = geoEligibility(
      "Mumbai",
      need({ urgency: "emergency", scope: "district", maxDistanceKm: 150 }),
      MUMBAI,
      PUNE,
    );
    expect(emergencyDistrict.ok).toBe(true);
    expect(emergencyDistrict.tier).toBe(2);
    expect(emergencyDistrict.distanceKm).toBeGreaterThan(100);

    const tooFar = geoEligibility(
      "Mumbai",
      need({ urgency: "emergency", scope: "district", maxDistanceKm: 25 }),
      MUMBAI,
      PUNE,
    );
    expect(tooFar.ok).toBe(false);
    expect(tooFar.blockers.join(" ")).toContain("25 km district radius");
  });

  test("emergency state and country search exclude other states unless country-wide", () => {
    const state = geoEligibility(
      "New Delhi",
      need({ urgency: "emergency", scope: "state" }),
      { lat: 28.6139, lng: 77.209 },
      PUNE,
    );
    expect(state.ok).toBe(false);
    expect(state.blockers.join(" ")).toContain("outside the requesting state");

    const country = geoEligibility(
      "New Delhi",
      need({ urgency: "emergency", scope: "country" }),
      { lat: 28.6139, lng: 77.209 },
      PUNE,
    );
    expect(country.ok).toBe(true);
    expect(country.tier).toBe(4);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Candidate eligibility and safety filters                         */
/* ------------------------------------------------------------------ */

describe("candidate eligibility and ranking", () => {
  test("protected reserve is excluded from usable units", () => {
    const result = evaluateCandidate(batch(), need({ units: 6 }), {
      today: TODAY,
      needPoint: PUNE,
    });
    expect(result.eligible).toBe(true);
    expect(result.usableUnits).toBe(4);
    expect(result.reasons.join(" ")).toContain("4 free unit(s)");
  });

  test("expired, unreleased, unscreened and incompatible units are blocked", () => {
    expect(
      evaluateCandidate(batch({ expiryDate: "2026-11-01" }), need(), { today: TODAY }).blockers,
    ).toContain("Batch has passed its expiry date.");

    expect(
      evaluateCandidate(batch({ released: false }), need(), { today: TODAY }).blockers,
    ).toContain("Unit is not marked released for transfusion.");

    expect(
      evaluateCandidate(batch({ screened: false }), need(), { today: TODAY }).blockers,
    ).toContain("Batch has not been released by screening and testing.");

    const incompatible = evaluateCandidate(batch({ bloodGroup: "AB+" }), need(), {
      today: TODAY,
    });
    expect(incompatible.eligible).toBe(false);
    expect(incompatible.blockers.join(" ")).toContain("ABO/Rh rules");
  });

  test("a fully protected batch has no allocatable units", () => {
    const result = evaluateCandidate(batch({ unitsAvailable: 4, protectedReserve: 4 }), need(), {
      today: TODAY,
    });
    expect(result.eligible).toBe(false);
    expect(result.usableUnits).toBe(0);
    expect(result.blockers).toContain("No units are free outside the protected reserve.");
  });

  test("ranking filters before scoring and prefers nearer, longer-dated stock", () => {
    const near = batch({ id: "NEAR", organizationId: "A" });
    const far = batch({ id: "FAR", organizationId: "B", city: "Mumbai", point: MUMBAI });
    const expired = batch({ id: "EXPIRED", organizationId: "C", expiryDate: "2026-10-01" });
    const ranked = rankCandidates(
      [far, expired, near],
      need({ urgency: "emergency", scope: "state" }),
      { today: TODAY, needPoint: PUNE },
    );
    expect(ranked[0].candidate.id).toBe("NEAR");
    expect(ranked.find((r) => r.candidate.id === "EXPIRED")?.eligibility.eligible).toBe(false);
    expect(ranked.find((r) => r.candidate.id === "EXPIRED")?.score).toBe(0);
    expect(ranked.find((r) => r.candidate.id === "FAR")?.eligibility.eligible).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Shortage and multi-facility partial allocation                   */
/* ------------------------------------------------------------------ */

describe("allocation planning", () => {
  test("shortage maths never returns a negative shortfall", () => {
    expect(computeShortage(10, 4)).toEqual({
      required: 10,
      available: 4,
      shortage: 6,
      covered: false,
      coveragePct: 40,
    });
    expect(computeShortage(5, 8)).toMatchObject({ shortage: 0, covered: true, coveragePct: 100 });
    expect(computeShortage(-3, -2)).toMatchObject({ required: 0, available: 0, shortage: 0 });
  });

  test("partial allocation spans facilities, respects reserves and reports shortfall", () => {
    const ranked = rankCandidates(
      [
        batch({ id: "A1", organizationId: "A", unitsAvailable: 4, protectedReserve: 2 }),
        batch({ id: "B1", organizationId: "B", unitsAvailable: 3, protectedReserve: 1 }),
        batch({ id: "C1", organizationId: "C", unitsAvailable: 5, protectedReserve: 5 }),
      ],
      need({ units: 5 }),
      { today: TODAY, needPoint: PUNE },
    );
    const plan = planAllocation(ranked, 5);
    expect(plan.unitsAllocated).toBe(4);
    expect(plan.shortfall).toBe(1);
    expect(plan.fullyCovered).toBe(false);
    expect(plan.allocations.map((a) => a.units)).toEqual([2, 2]);
    expect(plan.allocations.every((a) => a.units <= 2)).toBe(true);
    expect(plan.notes.join(" ")).toContain("Donor fallback is required");
  });

  test("allocation stops at the facility cap", () => {
    const ranked = rankCandidates(
      Array.from({ length: 6 }, (_, index) =>
        batch({
          id: `B${index}`,
          organizationId: `ORG-${index}`,
          unitsAvailable: 2,
          protectedReserve: 0,
        }),
      ),
      need({ units: 10 }),
      { today: TODAY, needPoint: PUNE },
    );
    const plan = planAllocation(ranked, 10, { maxFacilities: 3 });
    expect(plan.allocations).toHaveLength(3);
    expect(plan.unitsAllocated).toBe(6);
    expect(plan.shortfall).toBe(4);
    expect(plan.notes.join(" ")).toContain("Stopped after 3 facilities");
  });
});

/* ------------------------------------------------------------------ */
/* 4. Drone routing, energy and preflight                              */
/* ------------------------------------------------------------------ */

describe("drone planning and preflight", () => {
  const nearDropoff = { lat: 18.575, lng: 73.91 };

  test("returns a multi-leg corridor with a return leg, never claiming approval", () => {
    const route = planDroneRoute({
      pickup: PUNE,
      dropoff: nearDropoff,
      pickupLabel: "Pune pickup",
      dropoffLabel: "Pune destination",
    });
    expect(route.waypoints).toHaveLength(4);
    expect(route.waypoints[0].kind).toBe("pickup");
    expect(route.waypoints.at(-1)?.kind).toBe("landing");
    expect(route.outboundKm).toBeGreaterThan(0);
    expect(route.returnKm).toBeGreaterThan(0);
    expect(route.totalKm).toBeCloseTo(route.outboundKm + route.returnKm, 1);
    expect(route.approvedForFlight).toBe(false);
    expect(route.note).toContain("Corridor proxy");
  });

  test("detects when both corridor alternatives enter a restricted zone", () => {
    const center = { lat: (PUNE.lat + nearDropoff.lat) / 2, lng: (PUNE.lng + nearDropoff.lng) / 2 };
    const route = planDroneRoute({
      pickup: PUNE,
      dropoff: nearDropoff,
      zones: [
        { id: "Z1", name: "Test zone", center, radiusKm: 20, kind: "restricted" },
        { id: "Z2", name: "Open corridor", center, radiusKm: 1, kind: "corridor" },
      ],
    });
    expect(route.intersectsZoneIds).toContain("Z1");
    expect(route.intersectsZoneIds).not.toContain("Z2");
  });

  test("payload and storage rules are component-specific", () => {
    expect(payloadMassKg(4)).toBe(2.8);
    expect(payloadMassKg(0)).toBe(1.4);
    expect(storageRangeFor("red_cells").minC).toBe(2);
    expect(storageRangeFor("platelets").maxC).toBe(24);
    expect(storageRangeFor("plasma").maxC).toBe(-18);
  });

  test("preflight passes a safe mission and fails each critical safety gate", () => {
    const route = planDroneRoute({ pickup: PUNE, dropoff: nearDropoff });
    const base = {
      drone,
      payloadKg: 2.8,
      payloadUnits: 4,
      outboundKm: route.outboundKm,
      totalKm: route.totalKm,
      route,
      weather,
      airspace,
      landingZoneAvailable: true,
      component: "red_cells" as const,
      containerTempC: 4,
    };
    const ok = preflightChecks(base);
    expect(ok.passed).toBe(true);
    expect(ok.failures).toBe(0);

    expect(preflightChecks({ ...base, drone: { ...drone, batteryPct: 10 } }).passed).toBe(false);
    expect(preflightChecks({ ...base, drone: { ...drone, gpsAvailable: false } }).passed).toBe(false);
    expect(preflightChecks({ ...base, drone: { ...drone, linkStatus: "offline" } }).passed).toBe(false);
    expect(preflightChecks({ ...base, drone: { ...drone, maxPayloadKg: 1 } }).passed).toBe(false);
    expect(preflightChecks({ ...base, containerTempC: 15 }).passed).toBe(false);
    expect(
      preflightChecks({ ...base, airspace: { ...airspace, routeAuthorized: false } }).passed,
    ).toBe(false);
    expect(preflightChecks({ ...base, landingZoneAvailable: false }).passed).toBe(false);
    expect(
      preflightChecks({ ...base, weather: { ...weather, windKmh: 60 } }).passed,
    ).toBe(false);
    expect(preflightChecks({ ...base, drone: { ...drone, maintenanceStatus: "due" } }).warnings).toBeGreaterThan(0);
    expect(preflightChecks({ ...base, drone: { ...drone, maintenanceStatus: "grounded" } }).passed).toBe(false);
  });

  test("energy reserve makes an otherwise full battery infeasible for a long mission", () => {
    const feasible = energyRequirement({ drone, totalKm: 20, payloadKg: 2.8 });
    expect(feasible.feasible).toBe(true);
    expect(feasible.requiredWh).toBeGreaterThan(0);
    expect(feasible.reservePct).toBe(25);

    const infeasible = energyRequirement({ drone, totalKm: 200, payloadKg: 5 });
    expect(infeasible.feasible).toBe(false);
    expect(infeasible.availableWh).toBeLessThan(infeasible.requiredWh);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Mission state machine                                           */
/* ------------------------------------------------------------------ */

describe("mission state machine", () => {
  test("enforces the documented happy path", () => {
    const path = [
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
    ] as const;
    for (let i = 1; i < path.length; i += 1) {
      expect(canTransition(path[i - 1], path[i])).toBe(true);
    }
  });

  test("rejects unsafe jumps and terminal transitions", () => {
    expect(canTransition("PLANNED", "DELIVERED")).toBe(false);
    expect(canTransition("AT_PICKUP", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "RETURNING_TO_BASE")).toBe(false);
    expect(canTransition("ABORTED", "PLANNED")).toBe(false);
    expect(canTransition("EMERGENCY_LANDING", "COMPLETED")).toBe(false);
    expect(canTransition("HOLD", "PREFLIGHT_CHECKING")).toBe(true);
    expect(canTransition("HOLD", "ABORTED")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Forecasting and anomaly detection                               */
/* ------------------------------------------------------------------ */

function demandSeries(days: number): DailyPoint[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.UTC(2026, 6, 1) + index * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekly = [6, 8, 10, 9, 11, 7, 5][weekday];
    return { date, units: weekly + (index % 3) };
  });
}

describe("demand forecasting", () => {
  test("refuses to fabricate a forecast from a short series", () => {
    const result = forecastDemand(demandSeries(10));
    expect(result.status).toBe("insufficient_data");
    expect(result.metrics).toBeNull();
    expect(result.horizons.h24).toBeNull();
    expect(result.explanation).toContain("At least 14 daily demand points");
  });

  test("produces genuine chronological holdout metrics and all horizons", () => {
    const result = forecastDemand(demandSeries(90));
    expect(result.status).toBe("ok");
    expect(result.metrics).not.toBeNull();
    expect(result.metrics!.trainSize).toBeGreaterThan(0);
    expect(result.metrics!.holdoutSize).toBeGreaterThan(0);
    expect(Number.isFinite(result.metrics!.mae)).toBe(true);
    expect(Number.isFinite(result.metrics!.rmse)).toBe(true);
    expect(Number.isFinite(result.metrics!.baselineMae)).toBe(true);
    expect(result.horizons.h24).not.toBeNull();
    expect(result.horizons.h7).not.toBeNull();
    expect(result.horizons.h30).not.toBeNull();
    expect(result.horizons.h7!).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(["high", "medium", "low"]).toContain(result.confidenceLabel);
  });

  test("de-duplicates dates and sorts chronologically", () => {
    const points = demandSeries(40);
    const shuffled = [...points].reverse();
    shuffled.push({ date: points[3].date, units: 999 });
    const result = forecastDemand(shuffled);
    expect(result.status).toBe("ok");
    expect(result.sampleSize).toBe(points.length);
  });
});

describe("anomaly detection", () => {
  test("flags a demand spike and a collapse with explainable z-scores", () => {
    const points = Array.from({ length: 35 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 8, 1) + index * 86_400_000).toISOString().slice(0, 10),
      units: 10 + (index % 2),
    }));
    points[34] = { ...points[34], units: 60 };
    const findings = detectAnomalies(points);
    const spike = findings.find((f) => f.date === points[34].date);
    expect(spike?.direction).toBe("spike");
    expect(spike?.severity).toBe("critical");
    expect(spike?.zScore).toBeGreaterThan(2.5);
    expect(spike?.reason).toContain("Unusual demand spike");
  });

  test("does not flag stable demand", () => {
    const points = Array.from({ length: 35 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 8, 1) + index * 86_400_000).toISOString().slice(0, 10),
      units: 10,
    }));
    expect(detectAnomalies(points)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* 7. Donor fallback and response model                               */
/* ------------------------------------------------------------------ */

function donorSamples(count = 40): DonorSample[] {
  return Array.from({ length: count }, (_, index) => ({
    distanceKm: 5 + (index % 20) * 3,
    daysSinceDonation: 100 + (index % 100),
    previousDonations: index % 5,
    priorResponseRate: (index % 10) / 10,
    responded: index % 3 !== 0,
  }));
}

describe("donor fallback", () => {
  test("requires consent, availability, interval and compatibility", () => {
    const donor = {
      donorId: "D1",
      city: "Pune",
      bloodGroup: "O-" as const,
      available: true,
      lastDonationDate: null,
      shareLocationConsent: true,
      consentExpiresAt: Date.now() + 3_600_000,
    };
    const eligible = donorInviteEligibility(donor, {
      bloodGroup: "O+",
      component: "red_cells",
      city: "Pune",
      urgency: "urgent",
    });
    expect(eligible.eligible).toBe(true);
    expect(eligible.invitationOnly).toBe(true);

    expect(
      donorInviteEligibility(
        { ...donor, shareLocationConsent: false },
        { bloodGroup: "O+", component: "red_cells", city: "Pune", urgency: "urgent" },
      ).blockers,
    ).toContain("No active temporary location-sharing consent.");

    expect(
      donorInviteEligibility(
        { ...donor, consentExpiresAt: Date.now() - 1000 },
        { bloodGroup: "O+", component: "red_cells", city: "Pune", urgency: "urgent" },
      ).blockers.join(" "),
    ).toContain("expired");

    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    expect(
      donorInviteEligibility(
        { ...donor, bloodGroup: "B+", lastDonationDate: recent },
        { bloodGroup: "O+", component: "red_cells", city: "Pune", urgency: "urgent" },
      ).blockers.join(" "),
    ).toContain("90-day interval");

    expect(
      donorInviteEligibility(
        { ...donor, bloodGroup: "B+" },
        {
          bloodGroup: "A+",
          component: "red_cells",
          city: "Pune",
          urgency: "urgent",
        },
      ).blockers.join(" "),
    ).toContain("not compatible");

    expect(
      donorInviteEligibility(
        { ...donor, city: "Mumbai" },
        { bloodGroup: "O+", component: "red_cells", city: "Pune", urgency: "urgent" },
      ).blockers.join(" "),
    ).toContain("outside the requesting city");
  });

  test("refuses to train on too few or one-sided outcomes", () => {
    expect(fitDonorModel(donorSamples(12))).toBeNull();
    expect(
      fitDonorModel(donorSamples(30).map((sample) => ({ ...sample, responded: true }))),
    ).toBeNull();

    const model = fitDonorModel(donorSamples(40));
    expect(model).not.toBeNull();
    expect(model!.sampleSize).toBe(40);
    expect(model!.weights).toHaveLength(5);
    expect(model!.baseRate).toBeGreaterThan(0);
    expect(model!.baseRate).toBeLessThan(1);
  });

  test("response probability is bounded and untrained deployments return no fake score", () => {
    const features = {
      distanceKm: 12,
      daysSinceDonation: 140,
      previousDonations: 3,
      priorResponseRate: 0.6,
    };
    const untrained = donorResponseProbability(features, null);
    expect(untrained.probability).toBeNull();
    expect(untrained.basis).toBe("untrained");

    const model = fitDonorModel(donorSamples(40))!;
    const trained = donorResponseProbability(features, model);
    expect(trained.basis).toBe("trained_logistic");
    expect(trained.probability).not.toBeNull();
    expect(trained.probability!).toBeGreaterThanOrEqual(0);
    expect(trained.probability!).toBeLessThanOrEqual(1);
    expect(trained.detail).toContain("ranking aid only");
  });
});
