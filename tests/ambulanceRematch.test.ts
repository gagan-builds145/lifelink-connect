import { describe, expect, test } from "bun:test";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api, internal } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";
import {
  AMBULANCE_MAX_REMATCH_ATTEMPTS,
  AMBULANCE_SEARCH_WINDOW_MS,
} from "../src/lib/ambulance";

const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./ambulances.ts": () => import("../src/convex/ambulances"),
};

type TestApp = TestConvex<typeof schema>;

async function seed(
  t: TestApp,
  options: { online?: boolean; available?: boolean; donors?: number } = {},
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const donors: Id<"users">[] = [];
    for (let index = 0; index < (options.donors ?? 1); index += 1) {
      donors.push(
        await ctx.db.insert("users", {
          name: `Rematch Donor ${index + 1}`,
          email: `rematch-donor-${index + 1}@test.example`,
          role: "community",
          roles: ["community"],
          city: "Pune",
          profileCompleted: true,
          createdAt: now,
        }),
      );
    }
    const guardian = await ctx.db.insert("users", {
      name: "Rematch Guardian",
      email: "rematch-guardian@test.example",
      role: "guardian",
      roles: ["guardian"],
      profileCompleted: true,
      createdAt: now,
    });
    const profile = await ctx.db.insert("guardianProfiles", {
      userId: guardian,
      companyName: "Rematch Service",
      contactPerson: "Guardian",
      phone: "+919876550000",
      city: "Pune",
      address: "Depot",
      online: options.online ?? true,
      documentsStatus: "verified",
      status: "APPROVED",
      driver: {
        fullName: "Driver One",
        phone: "+919876550001",
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
      registrationNumber: "MH12RM1111",
      model: "Traveller",
      type: "bls",
      capacity: 2,
      driverName: "Driver One",
      driverPhone: "+919876550001",
      available: options.available ?? true,
      latitude: 18.52,
      longitude: 73.85,
      lastLocationAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { donors, guardian, profile, ambulance };
  });
}

function createSearching(t: TestApp, donor: Id<"users">, requestId: string) {
  return t.withIdentity({ subject: donor }).mutation(
    api.ambulances.createEmergencyBooking,
    {
      pickupLat: 18.521,
      pickupLng: 73.856,
      clientRequestId: requestId,
    },
  );
}

async function dueNow(t: TestApp, bookingId: Id<"ambulanceBookings">) {
  await t.run(async (ctx) => {
    await ctx.db.patch(bookingId, { nextRematchAt: Date.now() - 1 });
  });
}

describe("bounded ambulance re-matching", () => {
  test("no ambulance initially available stays searching, then a newly available vehicle is matched on retry", async () => {
    const t = convexTest(schema, modules);
    const { donors, ambulance } = await seed(t, { available: false });
    const created = await createSearching(t, donors[0], "rematch-0001");
    expect(created.status).toBe("searching");
    expect(created.assigned).toBe(false);

    await t.run(async (ctx) => {
      await ctx.db.patch(ambulance, { available: true, updatedAt: Date.now() });
    });
    await dueNow(t, created.bookingId);
    const result = await t.mutation(internal.ambulances.rematchSearchingBookings, {});

    expect(result.assigned).toBe(1);
    const booking = await t.run(async (ctx) => ctx.db.get(created.bookingId));
    expect(booking?.status).toBe("searching");
    expect(booking?.targetAmbulanceId).toBe(ambulance);
    expect(booking?.assignedAmbulanceId).toBeUndefined();
    expect(booking?.rematchAttempts).toBe(1);
    expect(booking?.nextRematchAt).toBeUndefined();
  });

  test("an offline provider that comes online is matched, and a vehicle that becomes unavailable is not", async () => {
    const t = convexTest(schema, modules);
    const { donors, profile, ambulance } = await seed(t, { online: false });
    const first = await createSearching(t, donors[0], "rematch-0002");
    expect(first.status).toBe("searching");

    await dueNow(t, first.bookingId);
    const noMatch = await t.mutation(internal.ambulances.rematchSearchingBookings, {});
    expect(noMatch.assigned).toBe(0);
    const stillSearching = await t.run(async (ctx) => ctx.db.get(first.bookingId));
    expect(stillSearching?.targetAmbulanceId).toBeUndefined();
    expect(stillSearching?.rematchAttempts).toBe(1);

    await t.run(async (ctx) => {
      await ctx.db.patch(profile, { online: true, updatedAt: Date.now() });
    });
    await dueNow(t, first.bookingId);
    const matched = await t.mutation(internal.ambulances.rematchSearchingBookings, {});
    expect(matched.assigned).toBe(1);
    expect((await t.run(async (ctx) => ctx.db.get(first.bookingId)))?.targetAmbulanceId).toBe(
      ambulance,
    );
  });

  test("two searching bookings compete for one vehicle without conflicting assignment", async () => {
    const t = convexTest(schema, modules);
    const { donors, ambulance } = await seed(t, {
      available: false,
      donors: 2,
    });
    const first = await createSearching(t, donors[0], "rematch-0003");
    const second = await createSearching(t, donors[1], "rematch-0004");
    await t.run(async (ctx) => {
      await ctx.db.patch(ambulance, { available: true, updatedAt: Date.now() });
      await ctx.db.patch(first.bookingId, { nextRematchAt: Date.now() - 1 });
      await ctx.db.patch(second.bookingId, { nextRematchAt: Date.now() - 1 });
    });

    const result = await t.mutation(internal.ambulances.rematchSearchingBookings, {});
    expect(result.assigned).toBe(1);
    const rows = await t.run(async (ctx) => ({
      first: await ctx.db.get(first.bookingId),
      second: await ctx.db.get(second.bookingId),
    }));
    const targets = [rows.first?.targetAmbulanceId, rows.second?.targetAmbulanceId].filter(
      Boolean,
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).toBe(ambulance);

    await t.run(async (ctx) => {
      await ctx.db.patch(second.bookingId, { nextRematchAt: Date.now() - 1 });
    });
    const again = await t.mutation(internal.ambulances.rematchSearchingBookings, {});
    expect(again.assigned).toBe(0);
    expect((await t.run(async (ctx) => ctx.db.get(second.bookingId)))?.targetAmbulanceId).toBe(
      undefined,
    );
  });

  test("a cancelled searching booking is never matched", async () => {
    const t = convexTest(schema, modules);
    const { donors, ambulance } = await seed(t, { available: false });
    const created = await createSearching(t, donors[0], "rematch-0005");
    await t
      .withIdentity({ subject: donors[0] })
      .mutation(api.ambulances.cancelBooking, { bookingId: created.bookingId });
    await t.run(async (ctx) => {
      await ctx.db.patch(ambulance, { available: true, updatedAt: Date.now() });
      await ctx.db.patch(created.bookingId, { nextRematchAt: Date.now() - 1 });
    });

    const result = await t.mutation(internal.ambulances.rematchSearchingBookings, {});
    expect(result.assigned).toBe(0);
    expect(
      (await t.run(async (ctx) => ctx.db.get(created.bookingId)))?.targetAmbulanceId,
    ).toBeUndefined();
  });

  test("duplicate retry execution is idempotent and does not reassign", async () => {
    const t = convexTest(schema, modules);
    const { donors, ambulance } = await seed(t, { available: false });
    const created = await createSearching(t, donors[0], "rematch-0006");
    await t.run(async (ctx) => {
      await ctx.db.patch(ambulance, { available: true, updatedAt: Date.now() });
      await ctx.db.patch(created.bookingId, { nextRematchAt: Date.now() - 1 });
    });

    const first = await t.mutation(internal.ambulances.rematchSearchingBookings, {});
    const second = await t.mutation(internal.ambulances.rematchSearchingBookings, {});
    expect(first.assigned).toBe(1);
    expect(second.assigned).toBe(0);
    const booking = await t.run(async (ctx) => ctx.db.get(created.bookingId));
    expect(booking?.targetAmbulanceId).toBe(ambulance);
    expect(booking?.rematchAttempts).toBe(1);
  });

  test("the retry limit closes the booking honestly instead of looping forever", async () => {
    const t = convexTest(schema, modules);
    const { donors } = await seed(t, { available: false });
    const created = await createSearching(t, donors[0], "rematch-0007");
    await t.run(async (ctx) => {
      await ctx.db.patch(created.bookingId, {
        rematchAttempts: AMBULANCE_MAX_REMATCH_ATTEMPTS,
        nextRematchAt: Date.now() - 1,
      });
    });

    const result = await t.mutation(internal.ambulances.rematchSearchingBookings, {});
    expect(result.expired).toBe(1);
    const booking = await t.run(async (ctx) => ctx.db.get(created.bookingId));
    expect(booking?.status).toBe("expired");
    expect(booking?.rematchExhaustedAt).toBeDefined();
    expect(booking?.cancellationReason).toMatch(/no approved ambulance/i);
    expect(booking?.targetAmbulanceId).toBeUndefined();
  });

  test("the search window expiry leaves a truthful unresolved record and notification", async () => {
    const t = convexTest(schema, modules);
    const { donors } = await seed(t, { available: false });
    const created = await createSearching(t, donors[0], "rematch-0008");
    await t.run(async (ctx) => {
      await ctx.db.patch(created.bookingId, {
        searchExpiresAt: Date.now() - 1,
        nextRematchAt: Date.now() - 1,
      });
    });

    const result = await t.mutation(internal.ambulances.rematchSearchingBookings, {});
    expect(result.expired).toBe(1);
    const rows = await t.run(async (ctx) => ({
      booking: await ctx.db.get(created.bookingId),
      events: await ctx.db
        .query("ambulanceBookingEvents")
        .withIndex("by_booking", (q) => q.eq("bookingId", created.bookingId))
        .collect(),
      notifications: await ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", donors[0]))
        .collect(),
    }));
    expect(rows.booking?.status).toBe("expired");
    expect(rows.events.some((event) => event.status === "expired")).toBe(true);
    expect(
      rows.notifications.some((notification) =>
        /no ambulance confirmed/i.test(notification.title),
      ),
    ).toBe(true);
  });

  test("a matched provider can accept during the retry flow, and assignment only then becomes confirmed", async () => {
    const t = convexTest(schema, modules);
    const { donors, guardian, ambulance } = await seed(t, { available: false });
    const created = await createSearching(t, donors[0], "rematch-0009");
    await t.run(async (ctx) => {
      await ctx.db.patch(ambulance, { available: true, updatedAt: Date.now() });
      await ctx.db.patch(created.bookingId, { nextRematchAt: Date.now() - 1 });
    });
    await t.mutation(internal.ambulances.rematchSearchingBookings, {});
    const before = await t.run(async (ctx) => ctx.db.get(created.bookingId));
    expect(before?.status).toBe("searching");
    expect(before?.assignedAmbulanceId).toBeUndefined();

    await t
      .withIdentity({ subject: guardian })
      .mutation(api.ambulances.acceptBooking, { bookingId: created.bookingId });
    const after = await t.run(async (ctx) => ctx.db.get(created.bookingId));
    expect(after?.status).toBe("guardian_assigned");
    expect(after?.assignedAmbulanceId).toBe(ambulance);
    expect(after?.assignedGuardianUserId).toBe(guardian);
  });

  test("searchExpiresAt is bounded and survives the initial no-ambulance booking", async () => {
    const t = convexTest(schema, modules);
    const { donors } = await seed(t, { available: false });
    const before = Date.now();
    const created = await createSearching(t, donors[0], "rematch-0010");
    const booking = await t.run(async (ctx) => ctx.db.get(created.bookingId));
    expect(booking?.searchExpiresAt).toBeGreaterThanOrEqual(
      before + AMBULANCE_SEARCH_WINDOW_MS - 5_000,
    );
    expect(booking?.searchExpiresAt).toBeLessThanOrEqual(
      Date.now() + AMBULANCE_SEARCH_WINDOW_MS + 5_000,
    );
  });
});
