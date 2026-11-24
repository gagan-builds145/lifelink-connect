import { describe, expect, test } from "bun:test";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";
import { AMBULANCE_LOCATION_STALE_MS } from "../src/lib/ambulance";

const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./ambulances.ts": () => import("../src/convex/ambulances"),
};

type TestApp = TestConvex<typeof schema>;

async function seed(t: TestApp) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const donor = await ctx.db.insert("users", {
      name: "Discovery Donor",
      email: "discovery@test.example",
      role: "community",
      roles: ["community"],
      city: "Pune",
      profileCompleted: true,
      createdAt: now,
    });
    const other = await ctx.db.insert("users", {
      name: "Other Donor",
      email: "other-discovery@test.example",
      role: "community",
      roles: ["community"],
      city: "Pune",
      profileCompleted: true,
      createdAt: now,
    });
    const guardian = await ctx.db.insert("users", {
      name: "Approved Guardian",
      email: "approved-discovery@test.example",
      role: "guardian",
      roles: ["guardian"],
      profileCompleted: true,
      createdAt: now,
    });
    const pendingGuardian = await ctx.db.insert("users", {
      name: "Pending Guardian",
      email: "pending-discovery@test.example",
      role: "guardian",
      roles: ["guardian"],
      profileCompleted: true,
      createdAt: now,
    });
    const offlineGuardian = await ctx.db.insert("users", {
      name: "Offline Guardian",
      email: "offline-discovery@test.example",
      role: "guardian",
      roles: ["guardian"],
      profileCompleted: true,
      createdAt: now,
    });
    const addProfile = (userId: Id<"users">, online: boolean, status: "APPROVED" | "PENDING") =>
      ctx.db.insert("guardianProfiles", {
        userId,
        companyName: `${status} Service`,
        contactPerson: "Owner",
        phone: "+919876560000",
        city: "Pune",
        address: "Depot",
        online,
        documentsStatus: status === "APPROVED" ? "verified" : "pending",
        status,
        createdAt: now,
        updatedAt: now,
      });
    await addProfile(guardian, true, "APPROVED");
    await addProfile(pendingGuardian, true, "PENDING");
    await addProfile(offlineGuardian, false, "APPROVED");

    const addAmbulance = (guardianUserId: Id<"users">, reg: string, patch: Record<string, unknown> = {}) =>
      ctx.db.insert("ambulances", {
        guardianUserId,
        registrationNumber: reg,
        model: "Traveller",
        type: "bls",
        capacity: 2,
        driverName: "Driver",
        driverPhone: "+919876560001",
        available: true,
        latitude: 18.52,
        longitude: 73.85,
        lastLocationAt: now,
        createdAt: now,
        updatedAt: now,
        ...patch,
      });

    const eligible = await addAmbulance(guardian, "MH12ELIGIBLE");
    await addAmbulance(pendingGuardian, "MH12PENDING");
    await addAmbulance(offlineGuardian, "MH12OFFLINE");
    await addAmbulance(guardian, "MH12STALE", {
      lastLocationAt: now - AMBULANCE_LOCATION_STALE_MS - 1_000,
    });
    await addAmbulance(guardian, "MH12BUSY", { available: false });
    await addAmbulance(guardian, "MH12FAR", { latitude: 21.17, longitude: 75.5 });
    const reserved = await addAmbulance(guardian, "MH12RESERVED");
    const targetBooking = await ctx.db.insert("ambulanceBookings", {
      bookingRef: "AMB-90001",
      requesterUserId: donor,
      requesterRole: "community",
      pickupLabel: "Pickup",
      pickupLat: 18.5204,
      pickupLng: 73.8567,
      destinationLabel: "Destination",
      status: "requested",
      targetAmbulanceId: reserved,
      clientRequestId: "reservation-seed-0001",
      requestedAt: now,
      updatedAt: now,
    });

    return {
      donor,
      other,
      guardian,
      pendingGuardian,
      eligible,
      reserved,
      targetBooking,
    };
  });
}

describe("nearby ambulance discovery", () => {
  test("counts only approved, online, available, fresh, unreserved vehicles in radius", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const nearby = await t
      .withIdentity({ subject: String(seeded.donor) })
      .query(api.ambulances.nearby, { pickupLat: 18.5204, pickupLng: 73.8567 });

    expect(nearby.map((row) => row.registrationNumber)).toEqual(["MH12ELIGIBLE"]);
    expect(nearby[0].lastLocationAt).toBeGreaterThan(Date.now() - 60_000);
  });

  test("an owner can publish live GPS for an available vehicle, but other providers cannot", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.eligible, {
        latitude: undefined,
        longitude: undefined,
        lastLocationAt: undefined,
      });
    });
    const before = await t
      .withIdentity({ subject: String(seeded.donor) })
      .query(api.ambulances.nearby, { pickupLat: 18.5204, pickupLng: 73.8567 });
    expect(before).toHaveLength(0);

    await expect(
      t
        .withIdentity({ subject: String(seeded.pendingGuardian) })
        .mutation(api.ambulances.publishAmbulanceLocation, {
          ambulanceId: seeded.eligible,
          latitude: 18.5204,
          longitude: 73.8567,
        }),
    ).rejects.toThrow("your own ambulance");

    await t
      .withIdentity({ subject: String(seeded.guardian) })
      .mutation(api.ambulances.publishAmbulanceLocation, {
        ambulanceId: seeded.eligible,
        latitude: 18.5204,
        longitude: 73.8567,
      });

    const after = await t
      .withIdentity({ subject: String(seeded.donor) })
      .query(api.ambulances.nearby, { pickupLat: 18.5204, pickupLng: 73.8567 });
    expect(after.map((row) => row.registrationNumber)).toEqual(["MH12ELIGIBLE"]);
  });

  test("reports every eligible vehicle without truncating the count", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let index = 0; index < 14; index += 1) {
        await ctx.db.insert("ambulances", {
          guardianUserId: seeded.guardian,
          registrationNumber: `MH12FLEET${index}`,
          model: "Traveller",
          type: "bls",
          capacity: 2,
          driverName: "Driver",
          driverPhone: "+919876560002",
          available: true,
          latitude: 18.521 + index * 0.0001,
          longitude: 73.851,
          lastLocationAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const nearby = await t
      .withIdentity({ subject: String(seeded.donor) })
      .query(api.ambulances.nearby, { pickupLat: 18.5204, pickupLng: 73.8567 });

    expect(nearby).toHaveLength(15);
    expect(new Set(nearby.map((row) => row.registrationNumber)).size).toBe(15);
  });

  test("stale coordinates are excluded and never returned as live", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.eligible, {
        lastLocationAt: Date.now() - AMBULANCE_LOCATION_STALE_MS - 5_000,
      });
    });
    const nearby = await t
      .withIdentity({ subject: String(seeded.donor) })
      .query(api.ambulances.nearby, { pickupLat: 18.5204, pickupLng: 73.8567 });
    expect(nearby).toHaveLength(0);
  });

  test("a searching state is created when every real vehicle is stale", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("ambulances").collect();
      for (const row of rows) {
        await ctx.db.patch(row._id, {
          lastLocationAt: Date.now() - AMBULANCE_LOCATION_STALE_MS - 1_000,
        });
      }
    });
    const result = await t
      .withIdentity({ subject: String(seeded.other) })
      .mutation(api.ambulances.createEmergencyBooking, {
        pickupLat: 18.5204,
        pickupLng: 73.8567,
        clientRequestId: "stale-search-0001",
      });
    expect(result.assigned).toBe(false);
    expect(result.status).toBe("searching");
  });
});

describe("live ambulance tracking authorization", () => {
  test("only the requester and assigned provider can see live coordinates", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const booking = await t
      .withIdentity({ subject: String(seeded.other) })
      .mutation(api.ambulances.createEmergencyBooking, {
        pickupLat: 18.5204,
        pickupLng: 73.8567,
        clientRequestId: "tracking-0001",
      });
    expect(booking.assigned).toBe(true);

    await t
      .withIdentity({ subject: String(seeded.guardian) })
      .mutation(api.ambulances.acceptBooking, { bookingId: booking.bookingId });
    await t
      .withIdentity({ subject: String(seeded.guardian) })
      .mutation(api.ambulances.shareLocation, {
        bookingId: booking.bookingId,
        latitude: 18.5215,
        longitude: 73.8575,
      });

    const requesterView = await t
      .withIdentity({ subject: String(seeded.other) })
      .query(api.ambulances.bookingDetail, { bookingId: booking.bookingId });
    expect(requesterView?.ambulance?.latitude).toBeCloseTo(18.5215);

    const strangerView = await t
      .withIdentity({ subject: String(seeded.donor) })
      .query(api.ambulances.bookingDetail, { bookingId: booking.bookingId });
    expect(strangerView).toBeNull();

    await expect(
      t
        .withIdentity({ subject: String(seeded.donor) })
        .mutation(api.ambulances.shareLocation, {
          bookingId: booking.bookingId,
          latitude: 18.6,
          longitude: 73.9,
        }),
    ).rejects.toThrow(/not authorized|assigned guardian/i);
  });

  test("terminal booking clears shared coordinates and stops live access", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const booking = await t
      .withIdentity({ subject: String(seeded.other) })
      .mutation(api.ambulances.createEmergencyBooking, {
        pickupLat: 18.5204,
        pickupLng: 73.8567,
        clientRequestId: "tracking-terminal-0001",
      });
    await t
      .withIdentity({ subject: String(seeded.guardian) })
      .mutation(api.ambulances.acceptBooking, { bookingId: booking.bookingId });
    await t
      .withIdentity({ subject: String(seeded.guardian) })
      .mutation(api.ambulances.shareLocation, {
        bookingId: booking.bookingId,
        latitude: 18.5215,
        longitude: 73.8575,
      });
    await t
      .withIdentity({ subject: String(seeded.other) })
      .mutation(api.ambulances.cancelBooking, {
        bookingId: booking.bookingId,
        reason: "Test terminal cleanup",
      });

    const after = await t
      .withIdentity({ subject: String(seeded.other) })
      .query(api.ambulances.bookingDetail, { bookingId: booking.bookingId });
    expect(after?.ambulance?.latitude).toBeNull();
    expect(after?.ambulance?.longitude).toBeNull();
    const vehicle = await t.run(async (ctx) => ctx.db.get(seeded.eligible));
    expect(vehicle?.lastLocationAt).toBeUndefined();
    expect(vehicle?.latitude).toBeUndefined();
  });
});
