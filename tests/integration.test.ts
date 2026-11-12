import { describe, expect, test } from "bun:test";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api, internal } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";

/**
 * Bun does not provide Vite's import.meta.glob, so register the real Convex
 * modules explicitly. The keys mirror their function paths.
 */
const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./requests.ts": () => import("../src/convex/requests"),
  "./allocation.ts": () => import("../src/convex/allocation"),
  "./donorFallback.ts": () => import("../src/convex/donorFallback"),
  "./donorPrediction.ts": () => import("../src/convex/donorPrediction"),
  "./ml.ts": () => import("../src/convex/ml"),
  "./integrations.ts": () => import("../src/convex/integrations"),
  "./drones.ts": () => import("../src/convex/drones"),
  "./profiles.ts": () => import("../src/convex/profiles"),
  "./inventory.ts": () => import("../src/convex/inventory"),
  "./notificationsQueue.ts": () => import("../src/convex/notificationsQueue"),
};

type TestApp = TestConvex<typeof schema>;

const DAY = 86_400_000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function setupNetwork(t: TestApp) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const hospitalOrg = await ctx.db.insert("organizations", {
      orgId: "HOSP-TEST-001",
      type: "hospital",
      name: "Test Hospital",
      contactPerson: "Hospital Coordinator",
      phone: "02026128000",
      email: "hospital@test.example",
      address: "1 Hospital Road",
      city: "Pune",
      latitude: 18.5255,
      longitude: 73.8734,
      status: "verified",
      transferAuthorized: true,
      autoAllocate: false,
      protectedReserveDefault: 0,
      createdAt: now,
      updatedAt: now,
    });
    const redCrossOrg = await ctx.db.insert("organizations", {
      orgId: "RC-TEST-001",
      type: "red_cross",
      name: "Test Red Cross",
      contactPerson: "Blood Bank Officer",
      phone: "02025501000",
      email: "redcross@test.example",
      address: "2 Blood Bank Road",
      city: "Pune",
      latitude: 18.5158,
      longitude: 73.8798,
      status: "verified",
      transferAuthorized: true,
      autoAllocate: true,
      protectedReserveDefault: 1,
      createdAt: now,
      updatedAt: now,
    });

    const hospitalUser = await ctx.db.insert("users", {
      name: "Hospital User",
      email: "hospital.user@test.example",
      role: "hospital",
      organizationId: hospitalOrg,
      city: "Pune",
      phone: "9876543210",
      profileCompleted: true,
      createdAt: now,
    });
    const redCrossUser = await ctx.db.insert("users", {
      name: "Red Cross User",
      email: "redcross.user@test.example",
      role: "red_cross",
      organizationId: redCrossOrg,
      city: "Pune",
      phone: "9876543211",
      profileCompleted: true,
      createdAt: now,
    });
    const droneUser = await ctx.db.insert("users", {
      name: "Drone Operator",
      email: "drone.user@test.example",
      role: "drone_ops",
      organizationId: redCrossOrg,
      city: "Pune",
      phone: "9876543212",
      profileCompleted: true,
      createdAt: now,
    });

    const batch = await ctx.db.insert("inventory", {
      organizationId: redCrossOrg,
      bloodGroup: "O+",
      component: "red_cells",
      unitsAvailable: 10,
      unitsReserved: 0,
      collectionDate: iso(-14),
      expiryDate: iso(30),
      storageLocation: "Main cold room",
      batchRef: "TEST-O-POS",
      lowStockThreshold: 2,
      verified: true,
      screened: true,
      released: true,
      protectedReserve: 1,
      lastUpdated: now,
      createdAt: now,
    });

    return { hospitalOrg, redCrossOrg, hospitalUser, redCrossUser, droneUser, batch };
  });
}

type Network = Awaited<ReturnType<typeof setupNetwork>>;

async function createRequest(
  t: TestApp,
  network: Network,
  overrides: Partial<{
    units: number;
    bloodGroup: "O+" | "A+" | "B+" | "AB+" | "O-" | "A-" | "B-" | "AB-";
    component: "whole_blood" | "red_cells" | "platelets" | "plasma";
    urgency: "routine" | "urgent" | "emergency";
    clientRequestId: string;
    city: string;
  }> = {},
) {
  return await t
    .withIdentity({ subject: String(network.hospitalUser) })
    .mutation(api.requests.create, {
      source: "hospital",
      requestorName: "Hospital Coordinator",
      requestorType: "representative",
      requesterPhone: "02026128000",
      requesterEmail: "hospital@test.example",
      patientName: "Synthetic Patient",
      patientRef: `SYN-${Math.random().toString(36).slice(2, 8)}`,
      patientAge: 42,
      hospitalName: "Test Hospital",
      city: overrides.city ?? "Pune",
      area: "Ward 4",
      bloodGroup: overrides.bloodGroup ?? "O+",
      component: overrides.component ?? "red_cells",
      units: overrides.units ?? 3,
      requiredBy: Date.now() + 6 * 3_600_000,
      urgency: overrides.urgency ?? "emergency",
      reason: "Synthetic post-operative haemorrhage requiring a compatibility-checked transfusion.",
      doctorName: "Dr Test",
      doctorContact: "02026128001",
      consent: true,
      clientRequestId: overrides.clientRequestId,
    });
}

describe("Convex blood supply workflow", () => {
  test("hospital request, atomic reservation, dispatch and receipt update the ledger", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const created = await createRequest(t, network);
    const asRedCross = t.withIdentity({ subject: String(network.redCrossUser) });
    const asHospital = t.withIdentity({ subject: String(network.hospitalUser) });

    expect(created.duplicate).toBe(false);
    await asRedCross.mutation(api.requests.updateStatus, {
      id: created.id,
      status: "under_verification",
    });
    await asRedCross.mutation(api.requests.updateStatus, {
      id: created.id,
      status: "approved",
      assignedOrgId: network.redCrossOrg,
    });
    await asRedCross.mutation(api.requests.reserveStock, {
      id: created.id,
      inventoryId: network.batch,
      units: 3,
    });

    let batch = await t.run((ctx) => ctx.db.get(network.batch));
    expect(batch?.unitsReserved).toBe(3);

    await asRedCross.mutation(api.requests.dispatch, { id: created.id });
    batch = await t.run((ctx) => ctx.db.get(network.batch));
    expect(batch?.unitsAvailable).toBe(7);
    expect(batch?.unitsReserved).toBe(0);

    await asHospital.mutation(api.requests.updateStatus, {
      id: created.id,
      status: "received",
      note: "Synthetic receipt confirmed at the ward.",
    });

    const detail = await asHospital.query(api.requests.getDetail, { id: created.id });
    expect(detail?.request.status).toBe("received");
    const reservations = await t.run((ctx) =>
      ctx.db
        .query("inventoryReservations")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .collect(),
    );
    expect(reservations).toHaveLength(1);
    expect(reservations[0].status).toBe("consumed");

    const transactions = await t.run((ctx) =>
      ctx.db
        .query("inventoryTransactions")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .collect(),
    );
    expect(transactions.map((row) => row.type)).toEqual(["reserve", "dispatch", "receipt"]);
    expect(transactions.reduce((sum, row) => sum + row.units, 0)).toBe(9);

    const auditRows = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(auditRows.some((row) => row.action === "inventory.dispatched")).toBe(true);
    expect(auditRows.some((row) => row.action === "request.created")).toBe(true);
  });

  test("insufficient stock is rejected without changing the reservation", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const created = await createRequest(t, network, { units: 20, bloodGroup: "O+" });
    const asRedCross = t.withIdentity({ subject: String(network.redCrossUser) });

    await asRedCross.mutation(api.requests.updateStatus, {
      id: created.id,
      status: "under_verification",
    });
    await expect(
      asRedCross.mutation(api.requests.reserveStock, {
        id: created.id,
        inventoryId: network.batch,
        units: 20,
      }),
    ).rejects.toThrow(/Only 9 unreserved unit/i);
    expect((await t.run((ctx) => ctx.db.get(network.batch)))?.unitsReserved).toBe(0);
    const batch = await t.run((ctx) => ctx.db.get(network.batch));
    expect(batch?.unitsReserved).toBe(0);
  });

  test("expired and incompatible batches are blocked before allocation", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    await t.run((ctx) => ctx.db.patch(network.batch, { unitsAvailable: 0 }));
    const expired = await t.run((ctx) =>
      ctx.db.insert("inventory", {
        organizationId: network.redCrossOrg,
        bloodGroup: "O+",
        component: "red_cells",
        unitsAvailable: 5,
        unitsReserved: 0,
        collectionDate: "2020-01-01",
        expiryDate: "2020-01-20",
        storageLocation: "Expired demo rack",
        batchRef: "TEST-EXPIRED",
        lowStockThreshold: 1,
        verified: true,
        screened: true,
        released: true,
        lastUpdated: Date.now(),
        createdAt: Date.now(),
      }),
    );
    const incompatible = await t.run((ctx) =>
      ctx.db.insert("inventory", {
        organizationId: network.redCrossOrg,
        bloodGroup: "A+",
        component: "red_cells",
        unitsAvailable: 5,
        unitsReserved: 0,
        collectionDate: iso(-10),
        expiryDate: iso(30),
        storageLocation: "Wrong group rack",
        batchRef: "TEST-INCOMPATIBLE",
        lowStockThreshold: 1,
        verified: true,
        screened: true,
        released: true,
        lastUpdated: Date.now(),
        createdAt: Date.now(),
      }),
    );
    const created = await createRequest(t, network, { units: 2, bloodGroup: "O+" });
    const asHospital = t.withIdentity({ subject: String(network.hospitalUser) });

    const search = await asHospital.query(api.allocation.searchSupply, {
      requestId: created.id,
      scope: "city",
    });
    const blocked = search.candidates.filter(
      (row) => row.batchId === String(expired) || row.batchId === String(incompatible),
    );
    expect(blocked).toHaveLength(2);
    expect(blocked.every((row) => row.eligible === false)).toBe(true);
    expect(blocked.some((row) => row.blockers.join(" ").includes("expiry"))).toBe(true);
    expect(blocked.some((row) => row.blockers.join(" ").includes("ABO/Rh"))).toBe(true);
    expect(search.preview.allocations).toHaveLength(0);

    const allocation = await asHospital.action(api.allocation.autoAllocate, {
      requestId: created.id,
      scope: "city",
    });
    expect(allocation.allocated).toBe(0);
    expect(allocation.transfers).toHaveLength(0);
  });

  test("two requests cannot reserve the same units concurrently", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    await t.run((ctx) => ctx.db.patch(network.batch, { unitsAvailable: 2, protectedReserve: 0 }));
    const first = await createRequest(t, network, { units: 2 });
    const second = await createRequest(t, network, { units: 2 });
    const asRedCross = t.withIdentity({ subject: String(network.redCrossUser) });
    for (const request of [first, second]) {
      await asRedCross.mutation(api.requests.updateStatus, {
        id: request.id,
        status: "under_verification",
      });
    }

    const results = await Promise.allSettled([
      asRedCross.mutation(api.requests.reserveStock, {
        id: first.id,
        inventoryId: network.batch,
        units: 2,
      }),
      asRedCross.mutation(api.requests.reserveStock, {
        id: second.id,
        inventoryId: network.batch,
        units: 2,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const batch = await t.run((ctx) => ctx.db.get(network.batch));
    expect(batch?.unitsReserved).toBe(2);
  });

  test("reservation cancellation returns units to the available ledger", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const created = await createRequest(t, network, { units: 2 });
    const asRedCross = t.withIdentity({ subject: String(network.redCrossUser) });

    await asRedCross.mutation(api.requests.updateStatus, {
      id: created.id,
      status: "under_verification",
    });
    await asRedCross.mutation(api.requests.reserveStock, {
      id: created.id,
      inventoryId: network.batch,
      units: 2,
    });
    const released = await asRedCross.mutation(api.requests.releaseReservation, {
      id: created.id,
      note: "Synthetic cancellation test.",
    });
    expect(released.released).toBe(2);

    const batch = await t.run((ctx) => ctx.db.get(network.batch));
    expect(batch?.unitsReserved).toBe(0);
    const reservations = await t.run((ctx) =>
      ctx.db
        .query("inventoryReservations")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .collect(),
    );
    expect(reservations[0].status).toBe("released");
  });

  test("role guards reject hospital-only and staff-only actions for the wrong account", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const donorUser = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Role Test Donor",
        email: "role.donor@test.example",
        role: "donor",
        city: "Pune",
        phone: "9876543215",
        profileCompleted: true,
        createdAt: Date.now(),
      }),
    );
    const asDonor = t.withIdentity({ subject: String(donorUser) });
    const asHospital = t.withIdentity({ subject: String(network.hospitalUser) });
    const created = await createRequest(t, network);

    await expect(
      asDonor.mutation(api.requests.create, {
        source: "hospital",
        requestorName: "Unauthorized",
        requestorType: "representative",
        requesterPhone: "02026128000",
        patientName: "Synthetic Patient",
        patientRef: "SYN-ROLE",
        hospitalName: "Test Hospital",
        city: "Pune",
        bloodGroup: "O+",
        component: "red_cells",
        units: 1,
        requiredBy: Date.now() + 3_600_000,
        urgency: "urgent",
        reason: "Synthetic role-guard test with sufficient reason length.",
        consent: true,
      }),
    ).rejects.toThrow(/only verified hospital staff/i);
    await expect(
      asDonor.query(api.allocation.searchSupply, { requestId: created.id }),
    ).rejects.toThrow(/not authorized|signed in/i);
    await expect(
      asHospital.mutation(api.requests.updateStatus, {
        id: created.id,
        status: "approved",
      }),
    ).rejects.toThrow(/Hospitals may only confirm receipt/i);
  });

  test("duplicate form retries return the same request instead of creating a second one", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const first = await createRequest(t, network, { clientRequestId: "stable-retry-key" });
    const second = await createRequest(t, network, { clientRequestId: "stable-retry-key" });

    expect(second.id).toBe(first.id);
    expect(second.requestId).toBe(first.requestId);
    expect(second.duplicate).toBe(true);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("bloodRequests")
        .withIndex("by_creator", (q) => q.eq("createdByUserId", network.hospitalUser))
        .collect(),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("Convex facility connectors", () => {
  test("mock sync is idempotent and a live sync with missing credentials records failure", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const integrationId = await t.run((ctx) =>
      ctx.db.insert("facilityIntegrations", {
        organizationId: network.redCrossOrg,
        kind: "blood_bank_api",
        label: "Synthetic mock connector",
        authScheme: "none",
        syncMode: "manual",
        status: "connected",
        isMock: true,
        lastSyncStatus: "never",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const liveIntegrationId = await t.run((ctx) =>
      ctx.db.insert("facilityIntegrations", {
        organizationId: network.redCrossOrg,
        kind: "hms_api",
        label: "Synthetic unconfigured live connector",
        baseUrl: "https://facility.invalid",
        authScheme: "bearer",
        credentialEnvVar: "LIFELINK_TEST_UNSET_FACILITY_KEY",
        syncMode: "manual",
        status: "connected",
        isMock: false,
        lastSyncStatus: "never",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const asRedCross = t.withIdentity({ subject: String(network.redCrossUser) });

    const before = await t.run((ctx) => ctx.db.query("inventory").collect());
    const first = await asRedCross.mutation(api.integrations.runMockSync, {
      integrationId,
    });
    const afterFirst = await t.run((ctx) => ctx.db.query("inventory").collect());
    expect(first.isMock).toBe(true);
    expect(first.recordsApplied).toBeGreaterThan(0);
    expect(afterFirst.length).toBe(before.length + first.recordsApplied);
    await asRedCross.mutation(api.integrations.runMockSync, { integrationId });
    const afterSecond = await t.run((ctx) => ctx.db.query("inventory").collect());
    expect(afterSecond.length).toBe(afterFirst.length);

    const live = await asRedCross.action(api.integrations.runLiveSync, {
      integrationId: liveIntegrationId,
    });
    expect(live.failed).toBe(true);
    const failedIntegration = await t.run((ctx) => ctx.db.get(liveIntegrationId));
    expect(failedIntegration?.status).toBe("error");
    expect(failedIntegration?.lastError).toContain("LIFELINK_TEST_UNSET_FACILITY_KEY");
    const failures = await t.run((ctx) =>
      ctx.db
        .query("anomalyEvents")
        .filter((q) => q.eq(q.field("kind"), "sync_failure"))
        .collect(),
    );
    expect(failures).toHaveLength(1);
  });
});

describe("Convex donor fallback and notifications", () => {
  test("auto allocation reserves stock first, then invites a consented eligible donor once", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(network.batch, { unitsAvailable: 2, protectedReserve: 1 });
      const donorUser = await ctx.db.insert("users", {
        name: "Test Donor",
        email: "donor@test.example",
        role: "donor",
        city: "Pune",
        phone: "9876543213",
        profileCompleted: true,
        createdAt: Date.now(),
      });
      const donorProfile = await ctx.db.insert("donorProfiles", {
        userId: donorUser,
        donorId: "DON-TEST-001",
        fullName: "Test Donor",
        bloodGroup: "O-",
        dateOfBirth: "1990-01-01",
        phone: "9876543213",
        email: "donor@test.example",
        address: "3 Donor Lane",
        city: "Pune",
        available: true,
        shareContact: true,
        lastDonationDate: iso(-200),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("donorConsents", {
        donorUserId: donorUser,
        donorProfileId: donorProfile,
        shareLocation: true,
        grantedAt: Date.now(),
        expiresAt: Date.now() + DAY,
        updatedAt: Date.now(),
      });
      return { donorUser, donorProfile };
    });
    const created = await createRequest(t, network, { units: 3, bloodGroup: "O+" });
    const asHospital = t.withIdentity({ subject: String(network.hospitalUser) });

    const allocation = await asHospital.action(api.allocation.autoAllocate, {
      requestId: created.id,
      scope: "city",
    });
    expect(allocation.allocated).toBe(1);
    expect(allocation.shortfall).toBe(2);
    expect(allocation.transfers).toHaveLength(1);
    expect(allocation.invitations?.invited).toBe(1);
    expect(allocation.invitations?.model).toBe("ml_not_configured");
    expect(allocation.donorFallbackError).toBeNull();

    const batch = await t.run((ctx) => ctx.db.get(network.batch));
    expect(batch?.unitsAvailable).toBe(2);
    expect(batch?.unitsReserved).toBe(1);
    const invitations = await t.run((ctx) => ctx.db.query("donorInvitations").collect());
    expect(invitations).toHaveLength(1);
    expect(invitations[0].status).toBe("sent");
    expect(invitations[0].responseProbability).toBeUndefined();
    expect(invitations[0].responseModel).toBe("ml_not_configured");
    expect(invitations[0].responseExplanation).toContain("distance only");

    const retry = await asHospital.action(api.allocation.autoAllocate, {
      requestId: created.id,
      scope: "city",
    });
    expect(retry.allocated).toBe(0);
    expect(retry.invitations?.invited).toBe(0);
    expect(await t.run((ctx) => ctx.db.query("donorInvitations").collect())).toHaveLength(1);

    const donorUser = invitations[0].donorUserId;
    await t
      .withIdentity({ subject: String(donorUser) })
      .mutation(api.donorFallback.respond, {
        invitationId: invitations[0]._id,
        action: "accept",
        note: "Synthetic donor acceptance.",
      });
    const afterAccept = await t.run((ctx) => ctx.db.get(invitations[0]._id));
    expect(afterAccept?.status).toBe("accepted");
    expect(afterAccept?.appointmentAt).toBeGreaterThan(Date.now());
    const batchAfter = await t.run((ctx) => ctx.db.get(network.batch));
    expect(batchAfter?.unitsAvailable).toBe(2);
    expect(batchAfter?.unitsReserved).toBe(1);
  });

  test("withdrawn consent prevents donor invitations", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const donor = await t.run(async (ctx) => {
      await ctx.db.patch(network.batch, { unitsAvailable: 1, protectedReserve: 1 });
      const donorUser = await ctx.db.insert("users", {
        name: "Withdrawn Donor",
        email: "withdrawn@test.example",
        role: "donor",
        city: "Pune",
        phone: "9876543214",
        profileCompleted: true,
        createdAt: Date.now(),
      });
      const donorProfile = await ctx.db.insert("donorProfiles", {
        userId: donorUser,
        donorId: "DON-TEST-002",
        fullName: "Withdrawn Donor",
        bloodGroup: "O-",
        dateOfBirth: "1990-01-01",
        phone: "9876543214",
        email: "withdrawn@test.example",
        address: "4 Donor Lane",
        city: "Pune",
        available: true,
        shareContact: true,
        lastDonationDate: iso(-200),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("donorConsents", {
        donorUserId: donorUser,
        donorProfileId: donorProfile,
        shareLocation: true,
        grantedAt: Date.now() - DAY,
        expiresAt: Date.now() + DAY,
        revokedAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { donorUser };
    });
    const created = await createRequest(t, network, { units: 1, bloodGroup: "O+" });
    const allocation = await t
      .withIdentity({ subject: String(network.hospitalUser) })
      .action(api.allocation.autoAllocate, { requestId: created.id, scope: "city" });

    expect(allocation.allocated).toBe(0);
    expect(allocation.invitations?.invited).toBe(0);
    expect(await t.run((ctx) => ctx.db.query("donorInvitations").collect())).toHaveLength(0);
    const consent = await t.run((ctx) =>
      ctx.db
        .query("donorConsents")
        .withIndex("by_donor", (q) => q.eq("donorUserId", donor.donorUser))
        .unique(),
    );
    expect(consent?.revokedAt).toBeDefined();
  });

  test("notification retry records missing providers and does not claim delivery", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const notificationId = await t.run((ctx) =>
      ctx.db.insert("notifications", {
        userId: network.hospitalUser,
        title: "Synthetic notification",
        body: "Testing the outbox without a provider.",
        kind: "system",
        read: false,
        createdAt: Date.now(),
      }),
    );
    const jobId = await t.run((ctx) =>
      ctx.db.insert("notificationJobs", {
        userId: network.hospitalUser,
        notificationId,
        channel: "email",
        recipient: "hospital@test.example",
        subject: "Synthetic notification",
        body: "Testing the outbox without a provider.",
        idempotencyKey: "test-notification-1:email",
        status: "queued",
        attempts: 0,
        createdAt: Date.now(),
      }),
    );

    const result = await t.action(internal.notificationsQueue.dispatchPending, {});
    expect(result).toMatchObject({ processed: 1, sent: 0, failed: 0, skipped: 1, retrying: 0 });
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("skipped_no_provider");
    expect(job?.attempts).toBe(1);
    expect(job?.lastError).toContain("RESEND_API_KEY");

    const second = await t.action(internal.notificationsQueue.dispatchPending, {});
    expect(second.processed).toBe(0);
  });
});

describe("Convex drone simulation boundary", () => {
  async function setupDrone(t: TestApp, network: Network) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const baseId = await ctx.db.insert("droneBases", {
        organizationId: network.redCrossOrg,
        name: "Test Simulated Base",
        city: "Pune",
        latitude: 18.5158,
        longitude: 73.8798,
        status: "active",
        createdAt: now,
      });
      const droneId = await ctx.db.insert("drones", {
        droneId: "DRN-TEST-001",
        baseId,
        organizationId: network.redCrossOrg,
        model: "AeroMed Test (Simulated)",
        manufacturer: "LifeLink SITL Lab",
        maxPayloadKg: 4,
        batteryCapacityWh: 420,
        maxRangeKm: 32,
        cruiseSpeedKmh: 54,
        batteryPct: 94,
        status: "available",
        flightController: "px4",
        linkStatus: "online",
        gpsAvailable: true,
        maintenanceStatus: "ok",
        containerReady: true,
        containerTempC: 4,
        currentLat: 18.5158,
        currentLng: 73.8798,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const transferId = await ctx.db.insert("transfers", {
        transferId: "TRF-TEST-001",
        requestingOrgId: network.hospitalOrg,
        supplyingOrgId: network.redCrossOrg,
        bloodGroup: "O+",
        component: "red_cells",
        units: 2,
        status: "reserved",
        reservationIds: [],
        auto: false,
        createdAt: now,
        updatedAt: now,
      });
      return { baseId, droneId, transferId };
    });
  }

  test("a valid simulated mission reaches preflight and can be aborted without hardware", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const droneSetup = await setupDrone(t, network);
    const asDrone = t.withIdentity({ subject: String(network.droneUser) });

    const planned = await asDrone.mutation(api.drones.planMission, {
      transferId: droneSetup.transferId,
      droneId: droneSetup.droneId,
      routeAuthorized: true,
      landingZoneAvailable: true,
      containerTempC: 4,
    });
    expect(planned.passed).toBe(true);
    expect(planned.state).toBe("PREFLIGHT_PASSED");
    const mission = await t.run((ctx) =>
      ctx.db
        .query("droneMissions")
        .withIndex("by_transfer", (q) => q.eq("transferId", droneSetup.transferId))
        .first(),
    );
    expect(mission?.simulated).toBe(true);
    expect(mission?.route.length).toBeGreaterThan(2);
    expect(mission?.deliveryCode).toMatch(/^\d{6}$/);

    await asDrone.mutation(api.drones.dispatchMission, { missionId: mission!._id });
    const dispatched = await t.run((ctx) => ctx.db.get(mission!._id));
    expect(dispatched?.state).toBe("DISPATCHED_TO_PICKUP");

    await asDrone.mutation(api.drones.abortMission, {
      missionId: mission!._id,
      reason: "Synthetic abort during integration test.",
    });
    const aborted = await t.run((ctx) => ctx.db.get(mission!._id));
    expect(aborted?.state).toBe("ABORTED");
  });

  test("unauthorized route holds preflight and blocks dispatch", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const droneSetup = await setupDrone(t, network);
    const asDrone = t.withIdentity({ subject: String(network.droneUser) });

    const planned = await asDrone.mutation(api.drones.planMission, {
      transferId: droneSetup.transferId,
      droneId: droneSetup.droneId,
      routeAuthorized: false,
      landingZoneAvailable: true,
      containerTempC: 4,
    });
    expect(planned.passed).toBe(false);
    expect(planned.state).toBe("HOLD");
    const mission = await t.run((ctx) =>
      ctx.db
        .query("droneMissions")
        .withIndex("by_transfer", (q) => q.eq("transferId", droneSetup.transferId))
        .first(),
    );
    await expect(
      asDrone.mutation(api.drones.dispatchMission, { missionId: mission!._id }),
    ).rejects.toThrow(/passed every preflight/i);
  });
});

describe("Transfer receipt and request fulfilment lifecycle", () => {
  type TestGroup = "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-";
  type TestComponent = "whole_blood" | "red_cells" | "platelets" | "plasma";

  const verifiedChecks = {
    labelVerified: true,
    screeningAndReleaseConfirmed: true,
    temperatureOk: true,
    packagingIntact: true,
    crossMatchConfirmed: true,
  };

  async function addSource(
    t: TestApp,
    options: {
      label: string;
      units: number;
      bloodGroup?: TestGroup;
      component?: TestComponent;
    },
  ) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const suffix = `${options.label}-${Math.random().toString(36).slice(2, 7)}`;
      const org = await ctx.db.insert("organizations", {
        orgId: `RC-${suffix}`,
        type: "red_cross",
        name: `Receipt Source ${suffix}`,
        contactPerson: "Test Blood Bank Officer",
        phone: "02025501999",
        email: `source.${suffix}@test.example`,
        address: "99 Test Blood Bank Road",
        city: "Pune",
        latitude: 18.52,
        longitude: 73.86,
        status: "verified",
        transferAuthorized: true,
        autoAllocate: true,
        protectedReserveDefault: 0,
        createdAt: now,
        updatedAt: now,
      });
      const user = await ctx.db.insert("users", {
        name: `Receipt Source User ${suffix}`,
        email: `source.user.${suffix}@test.example`,
        role: "red_cross",
        organizationId: org,
        city: "Pune",
        phone: "9876500000",
        profileCompleted: true,
        createdAt: now,
      });
      const batch = await ctx.db.insert("inventory", {
        organizationId: org,
        bloodGroup: options.bloodGroup ?? "O+",
        component: options.component ?? "red_cells",
        unitsAvailable: options.units,
        unitsReserved: 0,
        collectionDate: iso(-10),
        expiryDate: iso(30),
        storageLocation: "Verified receipt test rack",
        batchRef: `SRC-${suffix}`,
        lowStockThreshold: 0,
        verified: true,
        screened: true,
        released: true,
        protectedReserve: 0,
        lastUpdated: now,
        createdAt: now,
      });
      return { org, user, batch };
    });
  }

  async function approve(t: TestApp, network: Network, id: Id<"bloodRequests">) {
    const asRedCross = t.withIdentity({ subject: String(network.redCrossUser) });
    await asRedCross.mutation(api.requests.updateStatus, {
      id,
      status: "under_verification",
    });
    await asRedCross.mutation(api.requests.updateStatus, {
      id,
      status: "approved",
      assignedOrgId: network.redCrossOrg,
    });
  }

  async function prepareSingleSource(
    t: TestApp,
    network: Network,
    options: {
      requestUnits: number;
      sourceUnits: number;
      bloodGroup?: TestGroup;
      component?: TestComponent;
    },
  ) {
    await t.run((ctx) =>
      ctx.db.patch(network.batch, {
        unitsAvailable: 0,
        unitsReserved: 0,
        protectedReserve: 0,
      }),
    );
    const source = await addSource(t, {
      label: "single",
      units: options.sourceUnits,
      bloodGroup: options.bloodGroup,
      component: options.component,
    });
    const created = await createRequest(t, network, {
      units: options.requestUnits,
      bloodGroup: options.bloodGroup ?? "O+",
      component: options.component ?? "red_cells",
    });
    await approve(t, network, created.id);
    const asHospital = t.withIdentity({ subject: String(network.hospitalUser) });
    const allocation = await asHospital.action(api.allocation.autoAllocate, {
      requestId: created.id,
      scope: "city",
    });
    const transfer = await t.run((ctx) =>
      ctx.db
        .query("transfers")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .first(),
    );
    if (!transfer) throw new Error("Test setup expected an allocated transfer.");
    await t.withIdentity({ subject: String(source.user) }).mutation(
      api.allocation.dispatchTransfer,
      { transferId: transfer._id },
    );
    return { created, source, transfer, allocation, asHospital };
  }

  async function hospitalBatches(t: TestApp, network: Network) {
    return await t.run((ctx) =>
      ctx.db
        .query("inventory")
        .withIndex("by_organization", (q) => q.eq("organizationId", network.hospitalOrg))
        .collect(),
    );
  }

  test("full verified receipt credits inventory once and fulfils the request", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const { created, transfer, asHospital, allocation } = await prepareSingleSource(t, network, {
      requestUnits: 3,
      sourceUnits: 4,
    });
    expect(allocation.allocated).toBe(3);
    expect(transfer.units).toBe(3);
    expect(transfer.bloodGroup).toBe("O+");

    const result = await asHospital.mutation(api.allocation.receiveTransfer, {
      transferId: transfer._id,
      receivedUnits: 3,
      verifiedBloodGroup: "O+",
      verifiedComponent: "red_cells",
      verification: verifiedChecks,
      note: "Synthetic full verified receipt.",
    });
    expect(result.duplicate).toBe(false);
    expect(result.receivedUnits).toBe(3);
    expect(result.requestStatus).toBe("fulfilled");

    const request = await t.run((ctx) => ctx.db.get(created.id));
    expect(request?.status).toBe("fulfilled");
    const receipts = await t.run((ctx) =>
      ctx.db
        .query("transferReceipts")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .collect(),
    );
    expect(receipts).toHaveLength(1);
    expect(receipts[0].units).toBe(3);
    const batches = await hospitalBatches(t, network);
    expect(batches).toHaveLength(1);
    expect(batches[0].unitsAvailable).toBe(3);
    expect(batches[0].batchRef).toBe(transfer.transferId);
    const transactions = await t.run((ctx) =>
      ctx.db
        .query("inventoryTransactions")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .collect(),
    );
    expect(transactions.filter((row) => row.type === "receipt")).toHaveLength(1);
    const audits = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(audits.some((row) => row.action === "request.fulfilled")).toBe(true);
    expect(audits.some((row) => row.action === "transfer.received")).toBe(true);
  });

  test("a compatible source group is credited under its verified label", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    await t.run((ctx) =>
      ctx.db.patch(network.batch, { unitsAvailable: 0, unitsReserved: 0, protectedReserve: 0 }),
    );
    const source = await addSource(t, { label: "compatible", units: 2, bloodGroup: "O-" });
    const created = await createRequest(t, network, { units: 2, bloodGroup: "O+" });
    await approve(t, network, created.id);
    const asHospital = t.withIdentity({ subject: String(network.hospitalUser) });
    await asHospital.action(api.allocation.autoAllocate, {
      requestId: created.id,
      scope: "city",
    });
    const transfer = await t.run((ctx) =>
      ctx.db
        .query("transfers")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .first(),
    );
    expect(transfer?.bloodGroup).toBe("O-");
    await t.withIdentity({ subject: String(source.user) }).mutation(
      api.allocation.dispatchTransfer,
      { transferId: transfer!._id },
    );
    const result = await asHospital.mutation(api.allocation.receiveTransfer, {
      transferId: transfer!._id,
      receivedUnits: 2,
      verifiedBloodGroup: "O-",
      verifiedComponent: "red_cells",
      verification: verifiedChecks,
    });
    expect(result.requestStatus).toBe("fulfilled");
    const batches = await hospitalBatches(t, network);
    expect(batches).toHaveLength(1);
    expect(batches[0].bloodGroup).toBe("O-");
    expect(batches[0].unitsAvailable).toBe(2);
  });

  test("partial verified receipt leaves the request partially fulfilled", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const { created, transfer, asHospital } = await prepareSingleSource(t, network, {
      requestUnits: 4,
      sourceUnits: 2,
    });

    const result = await asHospital.mutation(api.allocation.receiveTransfer, {
      transferId: transfer._id,
      receivedUnits: 2,
      verifiedBloodGroup: "O+",
      verifiedComponent: "red_cells",
      verification: verifiedChecks,
    });
    expect(result.receivedUnits).toBe(2);
    expect(result.requestStatus).toBe("partially_fulfilled");
    const request = await t.run((ctx) => ctx.db.get(created.id));
    expect(request?.status).toBe("partially_fulfilled");
    expect(request?.units).toBe(4);
    const detail = await asHospital.query(api.requests.getDetail, { id: created.id });
    expect(detail?.request.receivedUnits).toBe(2);
    expect(detail?.request.remainingUnits).toBe(2);
    await expect(
      t.withIdentity({ subject: String(network.redCrossUser) }).mutation(
        api.requests.updateStatus,
        { id: created.id, status: "fulfilled", note: "Attempt to bypass verified quantity." },
      ),
    ).rejects.toThrow(/must remain partially fulfilled/i);
  });

  test("multiple transfers complete one request in verified increments", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    await t.run((ctx) =>
      ctx.db.patch(network.batch, { unitsAvailable: 0, unitsReserved: 0, protectedReserve: 0 }),
    );
    const firstSource = await addSource(t, { label: "multi-a", units: 2 });
    const secondSource = await addSource(t, { label: "multi-b", units: 2 });
    const created = await createRequest(t, network, { units: 3 });
    await approve(t, network, created.id);
    const asHospital = t.withIdentity({ subject: String(network.hospitalUser) });
    const allocation = await asHospital.action(api.allocation.autoAllocate, {
      requestId: created.id,
      scope: "city",
    });
    expect(allocation.allocated).toBe(3);
    expect(allocation.transfers).toHaveLength(2);
    const transfers = await t.run((ctx) =>
      ctx.db
        .query("transfers")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .collect(),
    );
    expect(transfers).toHaveLength(2);

    for (const transfer of transfers) {
      const supplier = transfer.supplyingOrgId === firstSource.org ? firstSource : secondSource;
      await t.withIdentity({ subject: String(supplier.user) }).mutation(
        api.allocation.dispatchTransfer,
        { transferId: transfer._id },
      );
    }

    const first = transfers[0];
    const firstResult = await asHospital.mutation(api.allocation.receiveTransfer, {
      transferId: first._id,
      receivedUnits: first.units,
      verifiedBloodGroup: "O+",
      verifiedComponent: "red_cells",
      verification: verifiedChecks,
    });
    expect(firstResult.requestStatus).toBe("partially_fulfilled");
    const second = transfers[1];
    const secondResult = await asHospital.mutation(api.allocation.receiveTransfer, {
      transferId: second._id,
      receivedUnits: second.units,
      verifiedBloodGroup: "O+",
      verifiedComponent: "red_cells",
      verification: verifiedChecks,
    });
    expect(secondResult.requestStatus).toBe("fulfilled");
    const request = await t.run((ctx) => ctx.db.get(created.id));
    expect(request?.status).toBe("fulfilled");
    expect((await hospitalBatches(t, network)).reduce((sum, b) => sum + b.unitsAvailable, 0)).toBe(3);
    const receipts = await t.run((ctx) =>
      ctx.db
        .query("transferReceipts")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .collect(),
    );
    expect(receipts.reduce((sum, receipt) => sum + receipt.units, 0)).toBe(3);
  });

  test("incomplete verification is rejected before any inventory or request change", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const { created, transfer, asHospital } = await prepareSingleSource(t, network, {
      requestUnits: 2,
      sourceUnits: 2,
    });

    await expect(
      asHospital.mutation(api.allocation.receiveTransfer, {
        transferId: transfer._id,
        receivedUnits: 2,
        verifiedBloodGroup: "O+",
        verifiedComponent: "red_cells",
        verification: { ...verifiedChecks, temperatureOk: false },
      }),
    ).rejects.toThrow(/verification is incomplete/i);
    expect((await t.run((ctx) => ctx.db.get(created.id)))?.status).toBe("approved");
    expect(await hospitalBatches(t, network)).toHaveLength(0);
    const receipts = await t.run((ctx) => ctx.db.query("transferReceipts").collect());
    expect(receipts).toHaveLength(0);
  });

  test("duplicate receipt confirmation is idempotent and never credits twice", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const { transfer, asHospital, created } = await prepareSingleSource(t, network, {
      requestUnits: 2,
      sourceUnits: 2,
    });
    const args = {
      transferId: transfer._id,
      receivedUnits: 2,
      verifiedBloodGroup: "O+" as const,
      verifiedComponent: "red_cells" as const,
      verification: verifiedChecks,
    };
    const first = await asHospital.mutation(api.allocation.receiveTransfer, args);
    const second = await asHospital.mutation(api.allocation.receiveTransfer, args);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.receiptBatchId).toBe(first.receiptBatchId);
    expect(await hospitalBatches(t, network)).toHaveLength(1);
    const receipts = await t.run((ctx) =>
      ctx.db
        .query("transferReceipts")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .collect(),
    );
    expect(receipts).toHaveLength(1);
    const receiptTransactions = await t.run((ctx) =>
      ctx.db
        .query("inventoryTransactions")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .collect(),
    );
    expect(receiptTransactions.filter((row) => row.type === "receipt")).toHaveLength(1);
  });

  test("incorrect component, quantity or group cannot be credited", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const { transfer, asHospital, created } = await prepareSingleSource(t, network, {
      requestUnits: 2,
      sourceUnits: 2,
    });

    await expect(
      asHospital.mutation(api.allocation.receiveTransfer, {
        transferId: transfer._id,
        receivedUnits: 2,
        verifiedBloodGroup: "O+",
        verifiedComponent: "platelets",
        verification: verifiedChecks,
      }),
    ).rejects.toThrow(/component/i);
    await expect(
      asHospital.mutation(api.allocation.receiveTransfer, {
        transferId: transfer._id,
        receivedUnits: 3,
        verifiedBloodGroup: "O+",
        verifiedComponent: "red_cells",
        verification: verifiedChecks,
      }),
    ).rejects.toThrow(/cannot exceed/i);
    await expect(
      asHospital.mutation(api.allocation.receiveTransfer, {
        transferId: transfer._id,
        receivedUnits: 2,
        verifiedBloodGroup: "A+",
        verifiedComponent: "red_cells",
        verification: verifiedChecks,
      }),
    ).rejects.toThrow(/not compatible/i);
    expect((await t.run((ctx) => ctx.db.get(created.id)))?.status).toBe("approved");
    expect(await hospitalBatches(t, network)).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("transferReceipts").collect())).toHaveLength(0);
  });

  test("only the receiving facility or an authorized staff account can verify receipt", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const { transfer } = await prepareSingleSource(t, network, {
      requestUnits: 1,
      sourceUnits: 1,
    });
    const otherHospitalUser = await t.run(async (ctx) => {
      const now = Date.now();
      const org = await ctx.db.insert("organizations", {
        orgId: "HOSP-OTHER-001",
        type: "hospital",
        name: "Other Hospital",
        contactPerson: "Other Coordinator",
        phone: "02026128999",
        email: "other.hospital@test.example",
        address: "8 Other Road",
        city: "Pune",
        status: "verified",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("users", {
        name: "Other Hospital User",
        email: "other.hospital.user@test.example",
        role: "hospital",
        organizationId: org,
        city: "Pune",
        phone: "9876543999",
        profileCompleted: true,
        createdAt: now,
      });
    });
    const donorUser = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Receipt Donor",
        email: "receipt.donor@test.example",
        role: "donor",
        city: "Pune",
        phone: "9876543998",
        profileCompleted: true,
        createdAt: Date.now(),
      }),
    );
    const args = {
      transferId: transfer._id,
      receivedUnits: 1,
      verifiedBloodGroup: "O+" as const,
      verifiedComponent: "red_cells" as const,
      verification: verifiedChecks,
    };
    await expect(
      t.withIdentity({ subject: String(otherHospitalUser) }).mutation(
        api.allocation.receiveTransfer,
        args,
      ),
    ).rejects.toThrow(/only the receiving facility/i);
    await expect(
      t.withIdentity({ subject: String(donorUser) }).mutation(
        api.allocation.receiveTransfer,
        args,
      ),
    ).rejects.toThrow(/not authorized/i);
    expect(await hospitalBatches(t, network)).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("transferReceipts").collect())).toHaveLength(0);

    const adminUser = await t.run((ctx) =>
      ctx.db.insert("users", {
        name: "Receipt Admin",
        email: "receipt.admin@test.example",
        role: "admin",
        city: "Pune",
        phone: "9876543997",
        profileCompleted: true,
        createdAt: Date.now(),
      }),
    );
    const adminResult = await t.withIdentity({ subject: String(adminUser) }).mutation(
      api.allocation.receiveTransfer,
      args,
    );
    expect(adminResult.requestStatus).toBe("fulfilled");
    expect(await hospitalBatches(t, network)).toHaveLength(1);
  });

  test("cancelling a pending request releases its reserved transfer atomically", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    await t.run((ctx) =>
      ctx.db.patch(network.batch, { unitsAvailable: 0, unitsReserved: 0, protectedReserve: 0 }),
    );
    const source = await addSource(t, { label: "cancel-release", units: 2 });
    const created = await createRequest(t, network, { units: 2 });
    const asHospital = t.withIdentity({ subject: String(network.hospitalUser) });
    const allocation = await asHospital.action(api.allocation.autoAllocate, {
      requestId: created.id,
      scope: "city",
    });
    expect(allocation.allocated).toBe(2);
    const transfer = await t.run((ctx) =>
      ctx.db
        .query("transfers")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .first(),
    );
    expect(transfer?.status).toBe("reserved");

    await asHospital.mutation(api.requests.updateStatus, {
      id: created.id,
      status: "cancelled",
      note: "Synthetic cancellation with a reserved transfer.",
    });
    expect((await t.run((ctx) => ctx.db.get(created.id)))?.status).toBe("cancelled");
    expect((await t.run((ctx) => ctx.db.get(transfer!._id)))?.status).toBe("cancelled");
    expect((await t.run((ctx) => ctx.db.get(source.batch)))?.unitsReserved).toBe(0);
    const releases = await t.run((ctx) =>
      ctx.db
        .query("inventoryTransactions")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .collect(),
    );
    expect(releases.filter((row) => row.type === "release")).toHaveLength(1);
  });

  test("a cancelled request cannot be fulfilled by a later transfer receipt", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const created = await createRequest(t, network, { units: 1 });
    const asHospital = t.withIdentity({ subject: String(network.hospitalUser) });
    await asHospital.mutation(api.requests.updateStatus, {
      id: created.id,
      status: "cancelled",
      note: "Synthetic cancellation before dispatch.",
    });
    const transfer = await t.run((ctx) =>
      ctx.db.insert("transfers", {
        transferId: "TRF-CANCELLED-TEST",
        requestId: created.id,
        requestingOrgId: network.hospitalOrg,
        supplyingOrgId: network.redCrossOrg,
        bloodGroup: "O+",
        component: "red_cells",
        units: 1,
        status: "dispatched",
        reservationIds: [],
        auto: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(
      asHospital.mutation(api.allocation.receiveTransfer, {
        transferId: transfer,
        receivedUnits: 1,
        verifiedBloodGroup: "O+",
        verifiedComponent: "red_cells",
        verification: verifiedChecks,
      }),
    ).rejects.toThrow(/cancelled request/i);
    expect((await t.run((ctx) => ctx.db.get(created.id)))?.status).toBe("cancelled");
    expect(await hospitalBatches(t, network)).toHaveLength(0);
  });

  test("a failed transfer is never received or credited", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const { created, transfer, asHospital } = await prepareSingleSource(t, network, {
      requestUnits: 1,
      sourceUnits: 1,
    });
    await t.run((ctx) =>
      ctx.db.patch(transfer._id, { status: "failed", updatedAt: Date.now() }),
    );
    await expect(
      asHospital.mutation(api.allocation.receiveTransfer, {
        transferId: transfer._id,
        receivedUnits: 1,
        verifiedBloodGroup: "O+",
        verifiedComponent: "red_cells",
        verification: verifiedChecks,
      }),
    ).rejects.toThrow(/failed transfer/i);
    expect((await t.run((ctx) => ctx.db.get(created.id)))?.status).toBe("approved");
    expect(await hospitalBatches(t, network)).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("transferReceipts").collect())).toHaveLength(0);
  });

  test("concurrent receipt attempts produce one ledger credit", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    const { created, transfer, asHospital } = await prepareSingleSource(t, network, {
      requestUnits: 2,
      sourceUnits: 2,
    });
    const args = {
      transferId: transfer._id,
      receivedUnits: 2,
      verifiedBloodGroup: "O+" as const,
      verifiedComponent: "red_cells" as const,
      verification: verifiedChecks,
    };
    const results = await Promise.allSettled([
      asHospital.mutation(api.allocation.receiveTransfer, args),
      asHospital.mutation(api.allocation.receiveTransfer, args),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const receipts = await t.run((ctx) =>
      ctx.db
        .query("transferReceipts")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .collect(),
    );
    expect(receipts).toHaveLength(1);
    const batches = await hospitalBatches(t, network);
    expect(batches).toHaveLength(1);
    expect(batches[0].unitsAvailable).toBe(2);
    const receiptTransactions = await t.run((ctx) =>
      ctx.db
        .query("inventoryTransactions")
        .withIndex("by_request", (q) => q.eq("requestId", created.id))
        .collect(),
    );
    expect(receiptTransactions.filter((row) => row.type === "receipt")).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(created.id)))?.status).toBe("fulfilled");
  });
});
