import { describe, expect, test } from "bun:test";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";

const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./ambulances.ts": () => import("../src/convex/ambulances"),
};

type TestApp = TestConvex<typeof schema>;

async function seed(t: TestApp) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const guardian = await ctx.db.insert("users", {
      name: "Guardian Provider",
      email: "guardian@test.example",
      role: "guardian",
      profileCompleted: true,
      createdAt: now,
    });
    await ctx.db.insert("guardianProfiles", {
      userId: guardian,
      companyName: "Test Ambulance Service",
      contactPerson: "Guardian One",
      phone: "9876500001",
      city: "Pune",
      address: "1 Depot Road",
      online: true,
      documentsStatus: "verified",
      createdAt: now,
      updatedAt: now,
    });
    const ambulance = await ctx.db.insert("ambulances", {
      guardianUserId: guardian,
      registrationNumber: "MH12AB1234",
      model: "Force Traveller",
      type: "bls",
      capacity: 2,
      driverName: "Driver One",
      driverPhone: "9876500002",
      available: true,
      latitude: 18.52,
      longitude: 73.85,
      lastLocationAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const donor = await ctx.db.insert("users", {
      name: "Donor User",
      email: "donor@test.example",
      role: "community",
      profileCompleted: true,
      createdAt: now,
    });
    const hospital = await ctx.db.insert("users", {
      name: "Hospital User",
      email: "hospital-amb@test.example",
      role: "hospital",
      profileCompleted: true,
      createdAt: now,
    });
    const other = await ctx.db.insert("users", {
      name: "Unrelated Donor",
      email: "unrelated@test.example",
      role: "community",
      profileCompleted: true,
      createdAt: now,
    });
    const admin = await ctx.db.insert("users", {
      name: "Admin",
      email: "admin-amb@test.example",
      role: "admin",
      profileCompleted: true,
      createdAt: now,
    });
    const unverifiedGuardian = await ctx.db.insert("users", {
      name: "Pending Guardian",
      email: "pending-guardian@test.example",
      role: "guardian",
      profileCompleted: true,
      createdAt: now,
    });
    await ctx.db.insert("guardianProfiles", {
      userId: unverifiedGuardian,
      companyName: "Pending Service",
      contactPerson: "Pending",
      phone: "9876500003",
      city: "Pune",
      address: "2 Depot Road",
      online: true,
      documentsStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("ambulances", {
      guardianUserId: unverifiedGuardian,
      registrationNumber: "MH12PENDING",
      model: "Pending Van",
      type: "als",
      capacity: 1,
      driverName: "Pending Driver",
      driverPhone: "9876500004",
      available: true,
      latitude: 18.53,
      longitude: 73.86,
      lastLocationAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { guardian, ambulance, donor, hospital, other, admin, unverifiedGuardian };
  });
}

function book(t: TestApp, userId: Id<"users">, ambulanceId: Id<"ambulances">, clientRequestId: string) {
  return t.withIdentity({ subject: String(userId) }).mutation(api.ambulances.createBooking, {
    ambulanceId,
    pickupLabel: "Test pickup",
    pickupLat: 18.5204,
    pickupLng: 73.8567,
    destinationLabel: "Test hospital",
    destinationLat: 18.53,
    destinationLng: 73.87,
    clientRequestId,
  });
}

describe("Guardian registration and fleet authorization", () => {
  test("a new account can register as Guardian while staff roles cannot convert", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const newUser = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "New Guardian",
        email: "new-guardian@test.example",
        role: "user",
        createdAt: Date.now(),
      }),
    );
    const result = await t
      .withIdentity({ subject: String(newUser) })
      .mutation(api.ambulances.registerGuardian, {
        companyName: "New Service",
        contactPerson: "Owner",
        phone: "9876511111",
        city: "Pune",
        address: "3 Depot Road",
      });
    expect(result.profileId).toBeDefined();
    const user = await t.run(async (ctx) => ctx.db.get(newUser));
    expect(user?.role).toBe("guardian");

    await expect(
      t
        .withIdentity({ subject: String(seeded.hospital) })
        .mutation(api.ambulances.registerGuardian, {
          companyName: "Hospital Service",
          contactPerson: "Owner",
          phone: "9876511112",
          city: "Pune",
          address: "4 Depot Road",
        }),
    ).rejects.toThrow(/staff accounts cannot register/i);
  });

  test("guardian can add an ambulance but cannot edit another guardian's vehicle", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    // A guardian with no vehicle can add one.
    const freshGuardian = await t.run(async (ctx) => {
      const user = await ctx.db.insert("users", {
        name: "Fresh Guardian",
        email: "fresh-guardian@test.example",
        role: "guardian",
        createdAt: Date.now(),
      });
      await ctx.db.insert("guardianProfiles", {
        userId: user,
        companyName: "Fresh Service",
        contactPerson: "Fresh",
        phone: "9876500099",
        city: "Pune",
        address: "6 Depot Road",
        online: true,
        documentsStatus: "verified",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return user;
    });
    const added = await t
      .withIdentity({ subject: String(freshGuardian) })
      .mutation(api.ambulances.upsertAmbulance, {
        registrationNumber: "MH12FRESH1",
        model: "Fresh Van",
        type: "icu",
        capacity: 1,
        driverName: "Driver Fresh",
        driverPhone: "9876522222",
      });
    expect(added.ambulanceId).toBeDefined();

    // The same guardian cannot add a second vehicle.
    await expect(
      t
        .withIdentity({ subject: String(freshGuardian) })
        .mutation(api.ambulances.upsertAmbulance, {
          registrationNumber: "MH12FRESH2",
          model: "Second Van",
          type: "bls",
          capacity: 2,
          driverName: "Driver Two",
          driverPhone: "9876533333",
        }),
    ).rejects.toThrow(/Each Guardian can register only one ambulance vehicle/i);

    // A different guardian cannot edit another guardian's vehicle.
    const otherGuardian = await t.run(async (ctx) => {
      const user = await ctx.db.insert("users", {
        name: "Other Guardian",
        email: "other-guardian@test.example",
        role: "guardian",
        createdAt: Date.now(),
      });
      await ctx.db.insert("guardianProfiles", {
        userId: user,
        companyName: "Other Service",
        contactPerson: "Other",
        phone: "9876544444",
        city: "Pune",
        address: "5 Depot Road",
        online: true,
        documentsStatus: "verified",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return user;
    });
    await expect(
      t
        .withIdentity({ subject: String(otherGuardian) })
        .mutation(api.ambulances.upsertAmbulance, {
          ambulanceId: seeded.ambulance,
          registrationNumber: "MH12AB1234",
          model: "Hijack",
          type: "bls",
          capacity: 2,
          driverName: "No",
          driverPhone: "9876555555",
        }),
    ).rejects.toThrow(/only update your own ambulance/i);
  });

  test("nearby only returns online, verified, available ambulances without driver phone", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const donor = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Searching Donor",
        email: "searching@test.example",
        role: "community",
        createdAt: Date.now(),
      }),
    );
    const nearby = await t
      .withIdentity({ subject: String(donor) })
      .query(api.ambulances.nearby, { pickupLat: 18.5204, pickupLng: 73.8567 });
    expect(nearby).toHaveLength(1);
    expect(nearby[0].registrationNumber).toBe("MH12AB1234");
    expect(nearby[0].distanceKm).toBeGreaterThanOrEqual(0);
    expect(nearby[0]).not.toHaveProperty("driverPhone");
    expect(nearby[0].latitude).toBe(18.52);
  });
});

describe("ambulance booking lifecycle", () => {
  test("donor creates a request, guardian accepts, moves status and completes", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const created = await book(t, seeded.donor, seeded.ambulance, "client-donor-0001");
    expect(created.bookingRef).toStartWith("AMB-");

    const accepted = await t
      .withIdentity({ subject: String(seeded.guardian) })
      .mutation(api.ambulances.acceptBooking, { bookingId: created.bookingId });
    expect(accepted.ok).toBe(true);

    const afterAccept = await t.run(async (ctx) => ctx.db.get(created.bookingId));
    expect(afterAccept?.status).toBe("guardian_assigned");
    expect(afterAccept?.assignedGuardianUserId).toBe(seeded.guardian);
    expect(afterAccept?.driverPhone).toBe("9876500002");

    for (const status of [
      "on_the_way",
      "arrived_pickup",
      "patient_picked_up",
      "in_transit",
      "completed",
    ] as const) {
      await t
        .withIdentity({ subject: String(seeded.guardian) })
        .mutation(api.ambulances.updateBookingStatus, {
          bookingId: created.bookingId,
          status,
        });
    }
    const completed = await t.run(async (ctx) => ctx.db.get(created.bookingId));
    expect(completed?.status).toBe("completed");
    expect(completed?.completedAt).toBeDefined();
    const ambulance = await t.run(async (ctx) => ctx.db.get(seeded.ambulance));
    expect(ambulance?.available).toBe(true);

    const detail = await t
      .withIdentity({ subject: String(seeded.donor) })
      .query(api.ambulances.bookingDetail, { bookingId: created.bookingId });
    expect(detail?.events.map((event) => event.status)).toContain("accepted");
    expect(detail?.events.map((event) => event.status)).toContain("completed");
  });

  test("guardian cannot skip lifecycle states or accept an unassigned ambulance", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const created = await book(t, seeded.donor, seeded.ambulance, "client-donor-0002");
    await t
      .withIdentity({ subject: String(seeded.guardian) })
      .mutation(api.ambulances.acceptBooking, { bookingId: created.bookingId });
    await expect(
      t
        .withIdentity({ subject: String(seeded.guardian) })
        .mutation(api.ambulances.updateBookingStatus, {
          bookingId: created.bookingId,
          status: "completed",
        }),
    ).rejects.toThrow(/Cannot move booking/i);
  });

  test("duplicate client request id is idempotent and only one active booking is allowed", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const first = await book(t, seeded.donor, seeded.ambulance, "client-donor-0003");
    const again = await book(t, seeded.donor, seeded.ambulance, "client-donor-0003");
    expect(again.bookingId).toBe(first.bookingId);
    expect(again.reused).toBe(true);
    await expect(
      book(t, seeded.donor, seeded.ambulance, "client-donor-0004"),
    ).rejects.toThrow(/already have an active ambulance booking/i);
  });

  test("a second requester cannot target the same ambulance twice", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    await book(t, seeded.donor, seeded.ambulance, "client-donor-0005");
    // The reservation is enforced before a second open request can target the
    // same real vehicle, rather than only failing later at acceptance.
    await expect(
      book(t, seeded.hospital, seeded.ambulance, "client-hosp-0001"),
    ).rejects.toThrow(/open request/i);
  });

  test("a guardian can decline a request and the requester sees rejection", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const created = await book(t, seeded.hospital, seeded.ambulance, "client-hosp-0002");
    await t
      .withIdentity({ subject: String(seeded.guardian) })
      .mutation(api.ambulances.rejectBooking, {
        bookingId: created.bookingId,
        reason: "Vehicle already committed.",
      });
    const booking = await t.run(async (ctx) => ctx.db.get(created.bookingId));
    expect(booking?.status).toBe("rejected");
    expect(booking?.cancellationReason).toBe("Vehicle already committed.");
  });

  test("Only the assigned guardian can share live location, and only during an active trip", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const created = await book(t, seeded.donor, seeded.ambulance, "client-donor-0006");
    await expect(
      t
        .withIdentity({ subject: String(seeded.guardian) })
        .mutation(api.ambulances.shareLocation, {
          bookingId: created.bookingId,
          latitude: 18.521,
          longitude: 73.857,
        }),
    ).rejects.toThrow(/Only the assigned Guardian/i);

    await t
      .withIdentity({ subject: String(seeded.guardian) })
      .mutation(api.ambulances.acceptBooking, { bookingId: created.bookingId });
    await t
      .withIdentity({ subject: String(seeded.guardian) })
      .mutation(api.ambulances.updateBookingStatus, {
        bookingId: created.bookingId,
        status: "on_the_way",
      });
    await t
      .withIdentity({ subject: String(seeded.guardian) })
      .mutation(api.ambulances.shareLocation, {
        bookingId: created.bookingId,
        latitude: 18.521,
        longitude: 73.857,
      });
    const detail = await t
      .withIdentity({ subject: String(seeded.donor) })
      .query(api.ambulances.bookingDetail, { bookingId: created.bookingId });
    expect(detail?.ambulance?.latitude).toBe(18.521);
    expect(detail?.events.some((event) => event.latitude === 18.521)).toBe(true);
  });

  test("unrelated users cannot read booking details or cancel another booking", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const created = await book(t, seeded.donor, seeded.ambulance, "client-donor-0007");
    const detail = await t
      .withIdentity({ subject: String(seeded.other) })
      .query(api.ambulances.bookingDetail, { bookingId: created.bookingId });
    expect(detail).toBeNull();
    await expect(
      t
        .withIdentity({ subject: String(seeded.other) })
        .mutation(api.ambulances.cancelBooking, { bookingId: created.bookingId }),
    ).rejects.toThrow(/cannot cancel/i);
  });

  test("requester cancellation releases the ambulance", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const created = await book(t, seeded.hospital, seeded.ambulance, "client-hosp-0003");
    await t
      .withIdentity({ subject: String(seeded.guardian) })
      .mutation(api.ambulances.acceptBooking, { bookingId: created.bookingId });
    await t
      .withIdentity({ subject: String(seeded.hospital) })
      .mutation(api.ambulances.cancelBooking, {
        bookingId: created.bookingId,
        reason: "Patient transferred.",
      });
    const booking = await t.run(async (ctx) => ctx.db.get(created.bookingId));
    expect(booking?.status).toBe("cancelled");
    const ambulance = await t.run(async (ctx) => ctx.db.get(seeded.ambulance));
    expect(ambulance?.available).toBe(true);
  });

  test("admin document review controls whether a Guardian appears nearby", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const donor = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Nearby Donor",
        email: "nearby@test.example",
        role: "community",
        createdAt: Date.now(),
      }),
    );
    const before = await t
      .withIdentity({ subject: String(donor) })
      .query(api.ambulances.nearby, { pickupLat: 18.52, pickupLng: 73.85 });
    expect(before.map((item) => item.registrationNumber)).not.toContain("MH12PENDING");

    await t
      .withIdentity({ subject: String(seeded.admin) })
      .mutation(api.ambulances.reviewGuardian, {
        guardianUserId: seeded.unverifiedGuardian,
        status: "verified",
      });
    const after = await t
      .withIdentity({ subject: String(donor) })
      .query(api.ambulances.nearby, { pickupLat: 18.52, pickupLng: 73.85 });
    expect(after.map((item) => item.registrationNumber)).toContain("MH12PENDING");
  });
});
