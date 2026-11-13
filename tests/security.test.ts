import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api, internal } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";

/**
 * Security regression suite.
 *
 * These tests exercise the real Convex functions (no mocks) with real
 * identities. They cover the 14 cases required by the security brief:
 * injection, XSS, brute force, OTP limits, role access, cross-user access,
 * malformed/oversized requests, ML token config, drone authorization, replay,
 * inventory/transfer authorization, information leakage and security headers.
 */
const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./security.ts": () => import("../src/convex/security"),
  "./authGate.ts": () => import("../src/convex/authGate"),
  "./contact.ts": () => import("../src/convex/contact"),
  "./requests.ts": () => import("../src/convex/requests"),
  "./inventory.ts": () => import("../src/convex/inventory"),
  "./drones.ts": () => import("../src/convex/drones"),
  "./allocation.ts": () => import("../src/convex/allocation"),
  "./profiles.ts": () => import("../src/convex/profiles"),
  "./donors.ts": () => import("../src/convex/donors"),
  "./ml.ts": () => import("../src/convex/ml"),
};

type TestApp = TestConvex<typeof schema>;
const DAY = 86_400_000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function setup(t: TestApp) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const org = (orgId: string, name: string, type: "hospital" | "red_cross") =>
      ctx.db.insert("organizations", {
        orgId,
        type,
        name,
        contactPerson: "Coordinator",
        phone: "02026128000",
        email: `${orgId.toLowerCase()}@test.example`,
        address: "1 Test Road",
        city: "Pune",
        latitude: 18.52,
        longitude: 73.87,
        status: "verified",
        transferAuthorized: true,
        autoAllocate: false,
        protectedReserveDefault: 0,
        createdAt: now,
        updatedAt: now,
      });

    const hospitalA = await org("HOSP-A", "Hospital A", "hospital");
    const hospitalB = await org("HOSP-B", "Hospital B", "hospital");
    const redCross = await org("RC-A", "Red Cross A", "red_cross");

    const user = (
      name: string,
      email: string,
      role: "hospital" | "red_cross" | "admin" | "donor" | "requestor" | "drone_ops",
      organizationId?: Id<"organizations">,
    ) =>
      ctx.db.insert("users", {
        name,
        email,
        role,
        organizationId,
        city: "Pune",
        phone: "9876543210",
        profileCompleted: true,
        createdAt: now,
      });

    const hospitalAUser = await user("Hospital A User", "a@test.example", "hospital", hospitalA);
    const hospitalBUser = await user("Hospital B User", "b@test.example", "hospital", hospitalB);
    const redCrossUser = await user("Red Cross User", "rc@test.example", "red_cross", redCross);
    const adminUser = await user("Admin", "admin@test.example", "admin");
    const donorUser = await user("Donor", "donor@test.example", "donor");
    const requestorA = await user("Requestor A", "ra@test.example", "requestor");
    const requestorB = await user("Requestor B", "rb@test.example", "requestor");
    const droneUser = await user("Drone Ops", "drone@test.example", "drone_ops", redCross);

    await ctx.db.insert("donorProfiles", {
      userId: donorUser,
      donorId: "DON-TEST-1",
      fullName: "Private Donor",
      bloodGroup: "O+",
      city: "Pune",
      phone: "9999999999",
      email: "private.donor@test.example",
      available: true,
      shareContact: false,
      createdAt: now,
      updatedAt: now,
    });

    const batch = await ctx.db.insert("inventory", {
      organizationId: redCross,
      bloodGroup: "O+",
      component: "red_cells",
      unitsAvailable: 10,
      unitsReserved: 0,
      collectionDate: iso(-14),
      expiryDate: iso(30),
      storageLocation: "Cold room",
      batchRef: "SEC-O-POS",
      lowStockThreshold: 2,
      verified: true,
      screened: true,
      released: true,
      protectedReserve: 0,
      lastUpdated: now,
      createdAt: now,
    });

    const drone = await ctx.db.insert("drones", {
      droneId: "DRN-TEST-1",
      baseId: await ctx.db.insert("droneBases", {
        organizationId: redCross,
        name: "Test base",
        latitude: 18.52,
        longitude: 73.87,
        createdAt: now,
        updatedAt: now,
      }),
      organizationId: redCross,
      model: "Sim",
      manufacturer: "LifeLink",
      maxPayloadKg: 5,
      batteryCapacityWh: 500,
      maxRangeKm: 40,
      cruiseSpeedKmh: 40,
      batteryPct: 90,
      status: "available",
      flightController: "px4",
      linkStatus: "online",
      gpsAvailable: true,
      maintenanceStatus: "ok",
      containerReady: true,
      containerTempC: 4,
      currentLat: 18.52,
      currentLng: 73.87,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const mission = await ctx.db.insert("droneMissions", {
      missionId: "DRM-SEC-1",
      droneId: drone,
      pickupOrgId: redCross,
      dropoffOrgId: hospitalA,
      bloodGroup: "O+",
      component: "red_cells",
      units: 2,
      payloadKg: 1.2,
      state: "IN_TRANSIT_TO_DESTINATION",
      simulated: true,
      route: [
        { lat: 18.52, lng: 73.87, label: "Base", kind: "pickup" },
        { lat: 18.53, lng: 73.88, label: "Hospital", kind: "dropoff" },
      ],
      outboundKm: 2,
      returnKm: 2,
      totalKm: 4,
      preflight: [],
      preflightPassed: true,
      weather: {
        windKmh: 10,
        precipitationPct: 0,
        visibilityKm: 10,
        temperatureC: 28,
        source: "simulated",
        observedAt: now,
      },
      airspace: { routeAuthorized: true, simulated: true, zoneIds: [] },
      containerTempC: 4,
      estimatedDurationMin: 10,
      stateHistory: [{ state: "IN_TRANSIT_TO_DESTINATION", at: now }],
      createdByUserId: droneUser,
      createdAt: now,
      updatedAt: now,
    });

    return {
      hospitalA,
      hospitalB,
      redCross,
      hospitalAUser,
      hospitalBUser,
      redCrossUser,
      adminUser,
      donorUser,
      requestorA,
      requestorB,
      droneUser,
      batch,
      mission,
    };
  });
}

type Network = Awaited<ReturnType<typeof setup>>;

async function createRequest(t: TestApp, network: Network, overrides: Record<string, unknown> = {}) {
  return await t.withIdentity({ subject: String(network.requestorA) }).mutation(api.requests.create, {
    source: "requestor",
    requestorName: "Requestor A",
    requestorType: "family",
    requesterPhone: "9876543210",
    requesterEmail: "ra@test.example",
    patientName: "Synthetic Patient",
    patientRef: "SYN-1",
    patientAge: 40,
    hospitalName: "Hospital A",
    city: "Pune",
    area: "Ward 1",
    bloodGroup: "O+",
    component: "red_cells",
    units: 2,
    requiredBy: Date.now() + 6 * 3_600_000,
    urgency: "urgent",
    reason: "Synthetic post-operative haemorrhage requiring transfusion.",
    consent: true,
    clientRequestId: `sec-${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  } as never);
}

describe("security firewall", () => {
  test("1. injection payloads are stored inert and never grant access", async () => {
    const t = convexTest(schema, modules);
    const network = await setup(t);
    const payload = "'; DROP TABLE users; -- {\"$ne\": null}";
    const created = await createRequest(t, network, { patientName: payload });
    const detail = await t
      .withIdentity({ subject: String(network.requestorA) })
      .query(api.requests.getDetail, { id: created.id });
    expect(detail?.request.patientName).toBe(payload);
    // The payload did not alter the users table or grant another user access.
    const other = await t
      .withIdentity({ subject: String(network.requestorB) })
      .query(api.requests.getDetail, { id: created.id });
    expect(other).toBeNull();
  });

  test("2. XSS payloads are rejected or returned as inert text", async () => {
    const t = convexTest(schema, modules);
    const network = await setup(t);
    await expect(
      t.mutation(api.contact.submit, {
        name: "Attacker",
        email: "attacker@test.example",
        subject: "Hello",
        message: "<script>alert(document.cookie)</script>",
      }),
    ).rejects.toThrow();

    const xss = '<img src=x onerror="alert(1)">';
    const created = await createRequest(t, network, { reason: xss });
    const detail = await t
      .withIdentity({ subject: String(network.requestorA) })
      .query(api.requests.getDetail, { id: created.id });
    expect(detail?.request.reason).toBe(xss);
  });

  test("3. brute-force / OTP requests are rate limited and logged", async () => {
    const t = convexTest(schema, modules);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const allowed = await t.mutation(internal.authGate.reserveOtp, { email: "target@test.example" });
      expect(allowed.allowed).toBe(true);
    }
    const blocked = await t.mutation(internal.authGate.reserveOtp, {
      email: "target@test.example",
    });
    expect(blocked.allowed).toBe(false);

    const events = await t.run(async (ctx) => ctx.db.query("securityEvents").collect());
    expect(events.some((event) => event.kind === "otp_rate_limited")).toBe(true);
    // No OTP code or token is ever persisted in the event.
    expect(JSON.stringify(events)).not.toMatch(/\b\d{6}\b/);
  });

  test("4. OTP limits are per address, not global", async () => {
    const t = convexTest(schema, modules);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await t.mutation(internal.authGate.reserveOtp, { email: "one@test.example" });
    }
    expect(
      (await t.mutation(internal.authGate.reserveOtp, { email: "one@test.example" })).allowed,
    ).toBe(false);
    expect(
      (await t.mutation(internal.authGate.reserveOtp, { email: "two@test.example" })).allowed,
    ).toBe(true);
  });

  test("5. unauthorized roles cannot reach admin security monitoring", async () => {
    const t = convexTest(schema, modules);
    const network = await setup(t);
    for (const subject of [network.donorUser, network.hospitalAUser, network.redCrossUser]) {
      await expect(
        t.withIdentity({ subject: String(subject) }).query(api.security.securityEventCounts, {}),
      ).rejects.toThrow(/administrators/i);
    }
    const counts = await t
      .withIdentity({ subject: String(network.adminUser) })
      .query(api.security.securityEventCounts, {});
    expect(counts.total).toBeGreaterThanOrEqual(0);
  });

  test("6. cross-user request access is denied and masked", async () => {
    const t = convexTest(schema, modules);
    const network = await setup(t);
    const created = await createRequest(t, network);

    const stranger = await t
      .withIdentity({ subject: String(network.requestorB) })
      .query(api.requests.getDetail, { id: created.id });
    expect(stranger).toBeNull();

    await expect(
      t.withIdentity({ subject: String(network.requestorB) }).mutation(api.requests.updateStatus, {
        id: created.id,
        status: "cancelled",
      }),
    ).rejects.toThrow();

    // A compatible donor sees the request but never the patient identity.
    const donorView = await t
      .withIdentity({ subject: String(network.donorUser) })
      .query(api.requests.getDetail, { id: created.id });
    expect(donorView?.viewer).toBe("donor");
    expect(donorView?.request.patientName).toBe("Confidential");
    expect(donorView?.request.patientRef).toBe("Restricted");
  });

  test("7. malformed API requests are rejected by schema validation", async () => {
    const t = convexTest(schema, modules);
    const network = await setup(t);
    await expect(createRequest(t, network, { units: 0 })).rejects.toThrow();
    await expect(createRequest(t, network, { units: 999 })).rejects.toThrow();
    await expect(createRequest(t, network, { bloodGroup: "Z+" })).rejects.toThrow();
    await expect(
      t.withIdentity({ subject: String(network.requestorA) }).mutation(api.requests.create, {
        source: "requestor",
      } as never),
    ).rejects.toThrow();
  });

  test("8. oversized requests are rejected", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(api.contact.submit, {
        name: "Big",
        email: "big@test.example",
        subject: "Oversized",
        message: "x".repeat(5000),
      }),
    ).rejects.toThrow(/too large|too long/i);
  });

  test("9. ML service enforces token auth, size caps and safe errors", () => {
    const source = readFileSync("ml_service/app/main.py", "utf8");
    expect(source).toContain("ML_SERVICE_TOKEN");
    expect(source).toContain("hmac.compare_digest");
    expect(source).toContain("MAX_REQUEST_BYTES");
    expect(source).toContain("status_code=413");
    expect(source).toContain("status_code=429");
    expect(source).toContain("status_code=504");
    expect(source).toContain("Wildcard CORS is not allowed");
    // No stack traces or payload logging in the service entrypoint.
    expect(source).not.toContain("traceback.print_exc");
    expect(source).not.toContain("logger.info(request.json");
  });

  test("10. unauthorized drone commands are refused", async () => {
    const t = convexTest(schema, modules);
    const network = await setup(t);
    for (const subject of [network.donorUser, network.hospitalAUser, network.requestorA]) {
      await expect(
        t.withIdentity({ subject: String(subject) }).mutation(api.drones.emergencyStop, {
          missionId: network.mission,
        }),
      ).rejects.toThrow();
    }
    await expect(
      t.withIdentity({ subject: String(network.donorUser) }).mutation(api.drones.registerBase, {
        organizationId: network.redCross,
        name: "Rogue base",
        latitude: 18.5,
        longitude: 73.8,
      }),
    ).rejects.toThrow();
  });

  test("11. replayed drone commands are idempotent, not duplicated", async () => {
    const t = convexTest(schema, modules);
    const network = await setup(t);
    const asDrone = t.withIdentity({ subject: String(network.droneUser) });
    const first = await asDrone.mutation(api.drones.emergencyStop, {
      missionId: network.mission,
      reason: "Test stop",
    });
    expect(first.duplicate).toBe(false);
    const second = await asDrone.mutation(api.drones.emergencyStop, {
      missionId: network.mission,
      reason: "Test stop",
    });
    expect(second.duplicate).toBe(true);
    const events = await t.run(async (ctx) =>
      ctx.db
        .query("missionEvents")
        .withIndex("by_mission", (q) => q.eq("missionId", network.mission))
        .collect(),
    );
    expect(events.filter((event) => event.toState === "EMERGENCY_LANDING")).toHaveLength(1);
  });

  test("12. inventory and transfer writes are ownership-checked", async () => {
    const t = convexTest(schema, modules);
    const network = await setup(t);
    // Hospital B cannot modify Red Cross A's batch.
    await expect(
      t.withIdentity({ subject: String(network.hospitalBUser) }).mutation(api.inventory.updateStock, {
        inventoryId: network.batch,
        unitsAvailable: 1,
      }),
    ).rejects.toThrow();
    // Adding stock always lands in the caller's own organization.
    const added = await t
      .withIdentity({ subject: String(network.hospitalBUser) })
      .mutation(api.inventory.addStock, {
        bloodGroup: "A+",
        component: "whole_blood",
        unitsAvailable: 2,
        collectionDate: iso(-1),
        expiryDate: iso(30),
        storageLocation: "Ward fridge",
        lowStockThreshold: 1,
      });
    const row = await t.run(async (ctx) => ctx.db.get(added.id));
    expect(row?.organizationId).toBe(network.hospitalB);
  });

  test("13. errors and security events never leak sensitive internals", async () => {
    const t = convexTest(schema, modules);
    const network = await setup(t);
    const created = await createRequest(t, network);
    let message = "";
    try {
      await t.withIdentity({ subject: String(network.requestorB) }).mutation(api.requests.updateStatus, {
        id: created.id,
        status: "cancelled",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toMatch(/at .*\.ts:\d+|ConvexError|stack|_generated|table/i);
    expect(message).not.toContain("Synthetic Patient");

    const events = await t.run(async (ctx) => ctx.db.query("securityEvents").collect());
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("Synthetic Patient");
    expect(serialized).not.toContain("private.donor@test.example");
  });

  test("14. security headers and CSP are configured", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("default-src 'self'");
    expect(html).toContain("object-src 'none'");
    expect(html).toContain('name="referrer"');

    const nginx = readFileSync("deploy/nginx/lifelink.conf", "utf8");
    for (const header of [
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Content-Security-Policy",
      "Permissions-Policy",
    ]) {
      expect(nginx).toContain(header);
    }
    expect(nginx).toContain("limit_req_zone");
    expect(nginx).toContain("client_max_body_size");
  });

  test("15. denied ML invocations are rejected and durably logged", async () => {
    const t = convexTest(schema, modules);
    const network = await setup(t);

    // A donor is not facility staff: prediction must fail before any model call.
    await expect(
      t
        .withIdentity({ subject: String(network.donorUser) })
        .action(api.ml.refreshDemandForecasts, {}),
    ).rejects.toThrow(/staff/i);

    // Admin-only retraining is refused for a hospital account.
    await expect(
      t
        .withIdentity({ subject: String(network.hospitalAUser) })
        .action(api.ml.trainDemandModel, {}),
    ).rejects.toThrow(/administrator/i);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("securityEvents")
        .withIndex("by_service", (q) => q.eq("service", "ml_service"))
        .collect(),
    );
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((event) => event.kind === "unauthorized_access")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("donor@test.example");
  });
});
