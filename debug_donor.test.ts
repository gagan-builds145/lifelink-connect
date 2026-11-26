import { describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "./src/convex/schema";
import { api, internal } from "./src/convex/_generated/api";

const modules = {
  "./_generated/api.js": () => import("./src/convex/_generated/api"),
  "./_generated/server.js": () => import("./src/convex/_generated/server"),
  "./requests.ts": () => import("./src/convex/requests"),
  "./allocation.ts": () => import("./src/convex/allocation"),
  "./donorFallback.ts": () => import("./src/convex/donorFallback"),
  "./donorPrediction.ts": () => import("./src/convex/donorPrediction"),
  "./ml.ts": () => import("./src/convex/ml"),
  "./profiles.ts": () => import("./src/convex/profiles"),
  "./integrations.ts": () => import("./src/convex/integrations"),
  "./drones.ts": () => import("./src/convex/drones"),
  "./notificationsQueue.ts": () => import("./src/convex/notificationsQueue"),
  "./inventory.ts": () => import("./src/convex/inventory"),
};

const DAY = 86_400_000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function setupNetwork(t: ReturnType<typeof convexTest>["extends"]) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const hospitalOrg = await ctx.db.insert("organizations", {
      orgId: "HOSP-TEST-001", type: "hospital", name: "Test Hospital",
      contactPerson: "Hospital Coordinator", phone: "02026128000", email: "hospital@test.example",
      address: "1 Hospital Road", city: "Pune", latitude: 18.5255, longitude: 73.8734,
      status: "verified", transferAuthorized: true, autoAllocate: false,
      protectedReserveDefault: 0, createdAt: now, updatedAt: now,
    });
    const redCrossOrg = await ctx.db.insert("organizations", {
      orgId: "RC-TEST-001", type: "red_cross", name: "Test Red Cross",
      contactPerson: "Blood Bank Officer", phone: "02025501000", email: "redcross@test.example",
      address: "2 Blood Bank Road", city: "Pune", latitude: 18.5158, longitude: 73.8798,
      status: "verified", transferAuthorized: true, autoAllocate: true,
      protectedReserveDefault: 1, createdAt: now, updatedAt: now,
    });
    const hospitalUser = await ctx.db.insert("users", {
      name: "Hospital User", email: "hospital.user@test.example", role: "hospital",
      organizationId: hospitalOrg, city: "Pune", phone: "9876543210",
      profileCompleted: true, createdAt: now,
    });
    const redCrossUser = await ctx.db.insert("users", {
      name: "Red Cross User", email: "redcross.user@test.example", role: "red_cross",
      organizationId: redCrossOrg, city: "Pune", phone: "9876543211",
      profileCompleted: true, createdAt: now,
    });
    const droneUser = await ctx.db.insert("users", {
      name: "Drone Operator", email: "drone.user@test.example", role: "drone_ops",
      organizationId: redCrossOrg, city: "Pune", phone: "9876543212",
      profileCompleted: true, createdAt: now,
    });
    const batch = await ctx.db.insert("inventory", {
      organizationId: redCrossOrg, bloodGroup: "O+", component: "red_cells",
      unitsAvailable: 10, unitsReserved: 0, collectionDate: iso(-14), expiryDate: iso(30),
      storageLocation: "Main cold room", batchRef: "TEST-O-POS", lowStockThreshold: 2,
      verified: true, screened: true, released: true, protectedReserve: 1,
      lastUpdated: now, createdAt: now,
    });
    return { hospitalOrg, redCrossOrg, hospitalUser, redCrossUser, droneUser, batch };
  });
}

describe("debug donor (exact integration setup)", () => {
  test("full autoAllocate with EXACT integration setup", async () => {
    const t = convexTest(schema, modules);
    const network = await setupNetwork(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(network.batch, { unitsAvailable: 2, protectedReserve: 1 });
      const donorUser = await ctx.db.insert("users", {
        name: "Test Donor", email: "donor@test.example", role: "donor",
        city: "Pune", phone: "9876543213", profileCompleted: true, createdAt: Date.now(),
      });
      const donorProfile = await ctx.db.insert("donorProfiles", {
        userId: donorUser, donorId: "DON-TEST-001", fullName: "Test Donor",
        bloodGroup: "O-", dateOfBirth: "1990-01-01", phone: "9876543213",
        email: "donor@test.example", address: "3 Donor Lane", city: "Pune",
        available: true, shareContact: true, lastDonationDate: iso(-200),
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.insert("donorConsents", {
        donorUserId: donorUser, donorProfileId: donorProfile,
        shareLocation: true, grantedAt: Date.now(), expiresAt: Date.now() + DAY, updatedAt: Date.now(),
      });
      return { donorUser, donorProfile };
    });
    const created = await t.withIdentity({ subject: String(network.hospitalUser) }).mutation(api.requests.create, {
      source: "hospital", requestorName: "Hospital Coordinator", requestorType: "representative",
      requesterPhone: "02026128000", requesterEmail: "hospital@test.example",
      patientName: "Synthetic Patient", patientRef: `SYN-${Math.random().toString(36).slice(2, 8)}`,
      patientAge: 42, hospitalName: "Test Hospital", city: "Pune", area: "Ward 4",
      bloodGroup: "O+", component: "red_cells", units: 3,
      requiredBy: Date.now() + 6 * 3_600_000, urgency: "emergency",
      reason: "Synthetic post-operative haemorrhage requiring a compatibility-checked transfusion.",
      doctorName: "Dr Test", doctorContact: "0202612801", consent: true,
      clientRequestId: Math.random().toString(36).slice(2, 8),
    });
    const asHospital = t.withIdentity({ subject: String(network.hospitalUser) });
    const allocation = await asHospital.action(api.allocation.autoAllocate, { requestId: created.id, scope: "city" });
    console.log("ALLOC:", JSON.stringify({ allocated: allocation.allocated, shortfall: allocation.shortfall, transfers: allocation.transfers.length, invited: allocation.invitations?.invited, model: allocation.invitations?.model, fallbackError: allocation.donorFallbackError }));
    const inv = await t.run((ctx) => ctx.db.query("donorInvitations").collect());
    console.log("INV:", inv.length, inv.map(i => ({ status: i.status, respModel: i.responseModel, respExpl: i.responseExplanation })));
    const res = await t.run((ctx) => ctx.db.query("inventoryReservations").collect());
    console.log("RES:", res.length, res.map(r => ({ status: r.status, units: r.units })));
    expect(allocation.invited).toBe(1);
  });
});
