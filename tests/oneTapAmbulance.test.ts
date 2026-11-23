import { describe, expect, test } from "bun:test";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";

const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./ambulances.ts": () => import("../src/convex/ambulances"),
};

type TestApp = TestConvex<typeof schema>;

async function seed(t: TestApp, options: { online?: boolean; available?: boolean } = {}) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const donor = await ctx.db.insert("users", {
      name: "One Tap Donor",
      email: "onetap@test.example",
      role: "community",
      roles: ["community"],
      city: "Pune",
      profileCompleted: true,
      createdAt: now,
    });
    const guardian = await ctx.db.insert("users", {
      name: "Guardian",
      email: "guardian-onetap@test.example",
      role: "guardian",
      roles: ["guardian"],
      profileCompleted: true,
      createdAt: now,
    });
    await ctx.db.insert("guardianProfiles", {
      userId: guardian,
      companyName: "One Tap Service",
      contactPerson: "Guardian",
      phone: "+919876540000",
      city: "Pune",
      address: "Depot",
      online: options.online ?? true,
      documentsStatus: "verified",
      status: "APPROVED",
      driver: {
        fullName: "Driver One",
        phone: "+919876540001",
        licenceNumber: "MH1220200012345",
        licenceCategory: "LMV",
        licenceExpiryDate: "2030-12-31",
        available: true,
      },
      createdAt: now,
      updatedAt: now,
    });
    const ambulance = await ctx.db.insert("ambulances", {
      guardianUserId: guardian,
      registrationNumber: "MH12OT1111",
      model: "Traveller",
      type: "bls",
      capacity: 2,
      driverName: "Driver One",
      driverPhone: "+919876540001",
      available: options.available ?? true,
      latitude: 18.52,
      longitude: 73.85,
      lastLocationAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { donor, guardian, ambulance };
  });
}

describe("one-tap ambulance booking", () => {
  test("live coordinates create a booking and select a genuinely available approved ambulance", async () => {
    const t = convexTest(schema, modules);
    const { donor, ambulance } = await seed(t);
    const asDonor = t.withIdentity({ subject: donor });
    const result = await asDonor.mutation(api.ambulances.createEmergencyBooking, {
      pickupLat: 18.521,
      pickupLng: 73.856,
      clientRequestId: "onetap-0001",
    });
    expect(result.bookingRef).toMatch(/^AMB-/);
    expect(result.assigned).toBe(true);
    expect(result.status).toBe("requested");
    const booking = await t.run(async (ctx) => ctx.db.get(result.bookingId));
    expect(booking?.targetAmbulanceId).toBe(ambulance);
    expect(booking?.destinationLabel).toMatch(/coordinated/i);
    expect(booking?.destinationLat).toBeUndefined();
    expect(booking?.patientName).toBeUndefined();
  });

  test("the same request id is idempotent and does not create a duplicate", async () => {
    const t = convexTest(schema, modules);
    const { donor } = await seed(t);
    const asDonor = t.withIdentity({ subject: donor });
    const first = await asDonor.mutation(api.ambulances.createEmergencyBooking, {
      pickupLat: 18.521,
      pickupLng: 73.856,
      clientRequestId: "onetap-0002",
    });
    const retry = await asDonor.mutation(api.ambulances.createEmergencyBooking, {
      pickupLat: 18.521,
      pickupLng: 73.856,
      clientRequestId: "onetap-0002",
    });
    expect(retry.bookingId).toBe(first.bookingId);
    expect(retry.reused).toBe(true);
    const count = await t.run(async (ctx) =>
      (await ctx.db.query("ambulanceBookings").collect()).length,
    );
    expect(count).toBe(1);
  });

  test("an active booking is returned instead of creating a second one", async () => {
    const t = convexTest(schema, modules);
    const { donor } = await seed(t);
    const asDonor = t.withIdentity({ subject: donor });
    const first = await asDonor.mutation(api.ambulances.createEmergencyBooking, {
      pickupLat: 18.521,
      pickupLng: 73.856,
      clientRequestId: "onetap-0003",
    });
    const second = await asDonor.mutation(api.ambulances.createEmergencyBooking, {
      pickupLat: 18.522,
      pickupLng: 73.857,
      clientRequestId: "onetap-0004",
    });
    expect(second.bookingId).toBe(first.bookingId);
    expect(second.reused).toBe(true);
  });

  test("no available ambulance yields a real searching status, never a fake assignment", async () => {
    const t = convexTest(schema, modules);
    const { donor } = await seed(t, { online: false });
    const asDonor = t.withIdentity({ subject: donor });
    const result = await asDonor.mutation(api.ambulances.createEmergencyBooking, {
      pickupLat: 18.521,
      pickupLng: 73.856,
      clientRequestId: "onetap-0005",
    });
    expect(result.assigned).toBe(false);
    expect(result.status).toBe("searching");
    const booking = await t.run(async (ctx) => ctx.db.get(result.bookingId));
    expect(booking?.targetAmbulanceId).toBeUndefined();
  });

  test("invalid coordinates are refused", async () => {
    const t = convexTest(schema, modules);
    const { donor } = await seed(t);
    const asDonor = t.withIdentity({ subject: donor });
    await expect(
      asDonor.mutation(api.ambulances.createEmergencyBooking, {
        pickupLat: 500,
        pickupLng: 73.856,
        clientRequestId: "onetap-0006",
      }),
    ).rejects.toThrow(/valid live GPS/i);
  });
});
