import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";

/**
 * Unified community dashboard regression suite.
 *
 * Covers both capabilities on one account, the merged activity feed, verified
 * receipt tracking, notification centre behaviour, ownership isolation and the
 * legacy-route redirects.
 */
const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./community.ts": () => import("../src/convex/community"),
  "./profiles.ts": () => import("../src/convex/profiles"),
  "./requests.ts": () => import("../src/convex/requests"),
  "./donors.ts": () => import("../src/convex/donors"),
  "./donorFallback.ts": () => import("../src/convex/donorFallback"),
  "./notifications.ts": () => import("../src/convex/notifications"),
  "./ml.ts": () => import("../src/convex/ml"),
};

type TestApp = TestConvex<typeof schema>;
const NOW = Date.now();
const DAY = 86_400_000;
const iso = (days: number) => new Date(NOW + days * DAY).toISOString().slice(0, 10);

type SeededUser = {
  id: Id<"users">;
  donorId?: Id<"donorProfiles">;
  requestorId?: Id<"requestorProfiles">;
};

async function seedCommunityUser(
  t: TestApp,
  options: {
    email: string;
    name?: string;
    role?: "community" | "hospital";
    donor?: boolean;
    requestor?: boolean;
  },
): Promise<SeededUser> {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      name: options.name ?? "Community Member",
      email: options.email,
      role: options.role ?? "community",
      city: "Pune",
      phone: "9876543210",
      profileCompleted: true,
      createdAt: NOW,
    });
    let donorId: Id<"donorProfiles"> | undefined;
    let requestorId: Id<"requestorProfiles"> | undefined;
    if (options.donor) {
      donorId = await ctx.db.insert("donorProfiles", {
        userId: id,
        donorId: `LL-D-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        fullName: options.name ?? "Community Member",
        bloodGroup: "O+",
        dateOfBirth: "1992-04-11",
        phone: "9876543210",
        email: options.email,
        address: "12 Test Lane",
        city: "Pune",
        available: true,
        shareContact: true,
        lastDonationDate: iso(-120),
        createdAt: NOW - 30 * DAY,
        updatedAt: NOW - 5 * DAY,
      });
    }
    if (options.requestor) {
      requestorId = await ctx.db.insert("requestorProfiles", {
        userId: id,
        requestorId: `LL-P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        fullName: options.name ?? "Community Member",
        phone: "9876543210",
        email: options.email,
        requestorType: "family",
        city: "Pune",
        createdAt: NOW - 20 * DAY,
      });
    }
    return { id, donorId, requestorId };
  });
}

async function seedNetwork(t: TestApp) {
  return await t.run(async (ctx) => {
    const hospitalOrg = await ctx.db.insert("organizations", {
      orgId: "HOSP-COMM-001",
      type: "hospital",
      name: "Community Test Hospital",
      contactPerson: "Coordinator",
      phone: "02026128000",
      email: "hospital@community.example",
      address: "1 Hospital Road",
      city: "Pune",
      status: "verified",
      transferAuthorized: true,
      autoAllocate: false,
      protectedReserveDefault: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const redCrossOrg = await ctx.db.insert("organizations", {
      orgId: "RC-COMM-001",
      type: "red_cross",
      name: "Community Test Red Cross",
      contactPerson: "Officer",
      phone: "02025501000",
      email: "rc@community.example",
      address: "2 Blood Bank Road",
      city: "Pune",
      status: "verified",
      transferAuthorized: true,
      autoAllocate: true,
      protectedReserveDefault: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const staff = await ctx.db.insert("users", {
      name: "Red Cross Staff",
      email: "staff@community.example",
      role: "red_cross",
      organizationId: redCrossOrg,
      city: "Pune",
      phone: "9876543211",
      profileCompleted: true,
      createdAt: NOW,
    });
    const inventoryId = await ctx.db.insert("inventory", {
      organizationId: redCrossOrg,
      bloodGroup: "O+",
      component: "red_cells",
      unitsAvailable: 10,
      unitsReserved: 0,
      collectionDate: iso(-10),
      expiryDate: iso(25),
      storageLocation: "Cold room",
      batchRef: "COMM-O-POS",
      lowStockThreshold: 2,
      verified: true,
      screened: true,
      released: true,
      protectedReserve: 1,
      lastUpdated: NOW,
      createdAt: NOW,
    });
    return { hospitalOrg, redCrossOrg, staff, inventoryId };
  });
}

async function seedRequest(
  t: TestApp,
  input: {
    userId: Id<"users">;
    hospitalOrgId: Id<"organizations">;
    requestId: string;
    status?: "pending" | "under_verification" | "partially_fulfilled" | "fulfilled" | "received";
    units?: number;
    urgency?: "routine" | "urgent" | "emergency";
    createdAt?: number;
  },
) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("bloodRequests", {
      requestId: input.requestId,
      source: "requestor",
      createdByUserId: input.userId,
      requestorName: "Community Member",
      requestorType: "family",
      requesterPhone: "9876543210",
      patientName: "Synthetic Patient",
      patientRef: "SYN-REF-1",
      hospitalName: "Community Test Hospital",
      hospitalOrgId: input.hospitalOrgId,
      city: "Pune",
      bloodGroup: "O+",
      component: "red_cells",
      units: input.units ?? 2,
      requiredBy: NOW + 3 * DAY,
      urgency: input.urgency ?? "urgent",
      reason: "Synthetic post-operative need requiring a compatibility-checked transfusion.",
      consent: true,
      status: input.status ?? "pending",
      createdAt: input.createdAt ?? NOW - DAY,
      updatedAt: NOW - DAY,
    });
    await ctx.db.insert("requestStatusHistory", {
      requestId: id,
      status: input.status ?? "pending",
      actorRole: "requestor",
      actorUserId: input.userId,
      note: "Synthetic seed history.",
      createdAt: input.createdAt ?? NOW - DAY,
    });
    return id;
  });
}

describe("unified community account", () => {
  test("donor-only account exposes donor capability and honest empty request states", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedCommunityUser(t, {
      email: "donor.only@community.example",
      donor: true,
    });

    const overview = await t
      .withIdentity({ subject: String(seeded.id) })
      .query(api.community.overview, {});

    expect(overview.donor?.donorId).toBeDefined();
    expect(overview.requestor).toBeNull();
    expect(overview.requests.total).toBe(0);
    expect(overview.donations.count).toBe(0);
    expect(overview.invitations.awaiting).toBe(0);
    expect(overview.recentActivity).toEqual([]);
  });

  test("requestor-only account exposes request capability and can activate donor access without a new login", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedCommunityUser(t, {
      email: "requestor.only@community.example",
      requestor: true,
    });
    const asUser = t.withIdentity({ subject: String(seeded.id) });

    let overview = await asUser.query(api.community.overview, {});
    expect(overview.requestor?.requestorId).toBeDefined();
    expect(overview.donor).toBeNull();

    await asUser.mutation(api.profiles.registerDonor, {
      fullName: "Community Member",
      bloodGroup: "A+",
      dateOfBirth: "1991-02-02",
      phone: "9876543210",
      address: "9 Existing Lane",
      city: "Pune",
      available: true,
      shareContact: true,
      consent: true,
    });

    overview = await asUser.query(api.community.overview, {});
    expect(overview.donor?.bloodGroup).toBe("A+");
    expect(overview.requestor?.requestorId).toBeDefined();
    expect(overview.role).toBe("community");
  });

  test("a new user can activate both capabilities and keep one identity", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedCommunityUser(t, { email: "both.new@community.example" });
    const asUser = t.withIdentity({ subject: String(seeded.id) });

    // Neither profile yet: the dashboard must offer onboarding, not fake data.
    const empty = await asUser.query(api.community.overview, {});
    expect(empty.donor).toBeNull();
    expect(empty.requestor).toBeNull();
    expect(empty.requests.total).toBe(0);

    await asUser.mutation(api.profiles.registerDonor, {
      fullName: "Community Member",
      bloodGroup: "B+",
      dateOfBirth: "1990-01-01",
      phone: "9876543210",
      address: "4 New Lane",
      city: "Pune",
      available: true,
      shareContact: false,
      consent: true,
    });
    await asUser.mutation(api.profiles.registerRequestor, {
      fullName: "Community Member",
      phone: "9876543210",
      requestorType: "patient",
      city: "Pune",
      consent: true,
    });

    const me = await asUser.query(api.profiles.me, {});
    expect(me.donor?.bloodGroup).toBe("B+");
    expect(me.requestor?.requestorType).toBe("patient");
    expect(me.user.role).toBe("community");

    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(1);

    const overview = await asUser.query(api.community.overview, {});
    expect(overview.donor).not.toBeNull();
    expect(overview.requestor).not.toBeNull();
  });

  test("donation and request history appear together in one activity feed", async () => {
    const t = convexTest(schema, modules);
    const network = await seedNetwork(t);
    const seeded = await seedCommunityUser(t, {
      email: "history@community.example",
      donor: true,
      requestor: true,
    });
    const requestId = await seedRequest(t, {
      userId: seeded.id,
      hospitalOrgId: network.hospitalOrg,
      requestId: "LL-REQ-7001",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("donations", {
        donorProfileId: seeded.donorId!,
        donorUserId: seeded.id,
        organizationId: network.redCrossOrg,
        donationDate: iso(-12),
        component: "whole_blood",
        units: 1,
        recordedByUserId: network.staff,
        createdAt: NOW - 12 * DAY,
      });
    });

    const activity = await t
      .withIdentity({ subject: String(seeded.id) })
      .query(api.community.activity, {});

    expect(activity.items.some((item) => item.kind === "donation")).toBe(true);
    expect(
      activity.items.some(
        (item) => item.kind === "request" && item.requestCode === "LL-REQ-7001",
      ),
    ).toBe(true);

    const overview = await t
      .withIdentity({ subject: String(seeded.id) })
      .query(api.community.overview, {});
    expect(overview.donations.count).toBe(1);
    expect(overview.requests.total).toBe(1);
    expect(overview.requests.pending).toBe(1);
    expect(overview.donations.monthly).toHaveLength(6);

    void requestId;
  });
});

describe("donor invitations in the unified dashboard", () => {
  test("an invitation is counted, appears in activity and acceptance is recorded with a timestamp", async () => {
    const t = convexTest(schema, modules);
    const network = await seedNetwork(t);
    const seeded = await seedCommunityUser(t, {
      email: "invited@community.example",
      donor: true,
    });
    const inviteId = await t.run(async (ctx) =>
      ctx.db.insert("donorInvitations", {
        requestingOrgId: network.hospitalOrg,
        donorUserId: seeded.id,
        donorProfileId: seeded.donorId!,
        bloodGroup: "O+",
        component: "red_cells",
        units: 1,
        distanceKm: 3,
        responseProbability: 0.71,
        responseModel: "random_forest_donor_response",
        responseModelVersion: "test-v1",
        responseModelSynthetic: true,
        status: "sent",
        idempotencyKey: "test-invite-1",
        createdAt: NOW - 2 * 3_600_000,
      }),
    );
    const asDonor = t.withIdentity({ subject: String(seeded.id) });

    let overview = await asDonor.query(api.community.overview, {});
    expect(overview.invitations.awaiting).toBe(1);
    const before = await asDonor.query(api.community.activity, {});
    expect(before.items.some((item) => item.kind === "invitation" && item.action === "received")).toBe(
      true,
    );

    await asDonor.mutation(api.donorFallback.respond, { invitationId: inviteId, action: "accept" });

    overview = await asDonor.query(api.community.overview, {});
    expect(overview.invitations.awaiting).toBe(0);
    expect(overview.invitations.accepted).toBe(1);

    const after = await asDonor.query(api.community.activity, {});
    const accepted = after.items.find(
      (item) => item.kind === "invitation" && item.action === "accepted",
    );
    expect(accepted).toBeDefined();
    expect(accepted!.at).toBeGreaterThan(before.items[0].at);
  });

  test("availability and consent changes are recorded once with their own timestamps", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedCommunityUser(t, {
      email: "availability@community.example",
      donor: true,
    });
    const asDonor = t.withIdentity({ subject: String(seeded.id) });

    await asDonor.mutation(api.profiles.setAvailability, { available: false });
    await asDonor.mutation(api.profiles.setAvailability, { available: true });

    const activity = await asDonor.query(api.community.activity, {});
    const availabilityEvents = activity.items.filter((item) => item.kind === "availability");
    expect(availabilityEvents).toHaveLength(2);
    expect(availabilityEvents[0].title).toBe("Availability turned on");
    expect(availabilityEvents[1].title).toBe("Availability paused");
  });
});

describe("request lifecycle in the unified dashboard", () => {
  test("partial fulfilment, allocation and verified receipts surface in tracking and activity", async () => {
    const t = convexTest(schema, modules);
    const network = await seedNetwork(t);
    const seeded = await seedCommunityUser(t, {
      email: "tracking@community.example",
      donor: true,
      requestor: true,
    });
    const requestId = await seedRequest(t, {
      userId: seeded.id,
      hospitalOrgId: network.hospitalOrg,
      requestId: "LL-REQ-7100",
      status: "partially_fulfilled",
      units: 4,
    });

    await t.run(async (ctx) => {
      const reservationId = await ctx.db.insert("inventoryReservations", {
        inventoryId: network.inventoryId,
        organizationId: network.redCrossOrg,
        requestId,
        units: 2,
        status: "consumed",
        actorUserId: network.staff,
        createdAt: NOW - 6 * 3_600_000,
        updatedAt: NOW - 2 * 3_600_000,
      });
      const transferId = await ctx.db.insert("transfers", {
        transferId: "TR-COMM-1",
        requestId,
        requestingOrgId: network.hospitalOrg,
        supplyingOrgId: network.redCrossOrg,
        bloodGroup: "O+",
        component: "red_cells",
        units: 2,
        status: "received",
        reservationIds: [reservationId],
        auto: false,
        createdAt: NOW - 6 * 3_600_000,
        updatedAt: NOW - 2 * 3_600_000,
        dispatchedAt: NOW - 5 * 3_600_000,
        receivedAt: NOW - 2 * 3_600_000,
      });
      await ctx.db.insert("transferReceipts", {
        transferId,
        requestId,
        receivingOrgId: network.hospitalOrg,
        supplyingOrgId: network.redCrossOrg,
        inventoryId: network.inventoryId,
        units: 2,
        bloodGroup: "O+",
        component: "red_cells",
        labelVerified: true,
        screeningAndReleaseConfirmed: true,
        temperatureOk: true,
        packagingIntact: true,
        crossMatchConfirmed: true,
        evidenceCode: "EVID-1",
        receivedByUserId: network.staff,
        receivedByRole: "red_cross",
        createdAt: NOW - 2 * 3_600_000,
      });
      await ctx.db.insert("requestStatusHistory", {
        requestId,
        status: "partially_fulfilled",
        actorRole: "red_cross",
        note: "Two units verified, two outstanding.",
        createdAt: NOW - 2 * 3_600_000,
      });
    });

    const asOwner = t.withIdentity({ subject: String(seeded.id) });
    const detail = await asOwner.query(api.requests.getDetail, { id: requestId });
    expect(detail?.request.status).toBe("partially_fulfilled");
    expect(detail?.request.receivedUnits).toBe(2);
    expect(detail?.request.remainingUnits).toBe(2);
    expect(detail?.request.reservedUnits).toBe(0);
    expect(detail?.receipts).toHaveLength(1);
    expect(detail?.receipts[0].units).toBe(2);
    expect(detail?.receipts[0].supplierName).toBe("Community Test Red Cross");

    const overview = await asOwner.query(api.community.overview, {});
    expect(overview.requests.partiallyFulfilled).toBe(1);
    expect(overview.requests.active).toBe(1);

    const activity = await asOwner.query(api.community.activity, {});
    expect(activity.items.some((item) => item.kind === "allocation")).toBe(true);
    expect(activity.items.some((item) => item.kind === "transfer" && item.action === "dispatched")).toBe(
      true,
    );
    expect(activity.items.some((item) => item.kind === "receipt")).toBe(true);

    const other = await seedCommunityUser(t, { email: "other@community.example" });
    const denied = await t
      .withIdentity({ subject: String(other.id) })
      .query(api.requests.getDetail, { id: requestId });
    expect(denied).toBeNull();
  });

  test("a fulfilled request counts as complete and an owner edit is limited to pending requests", async () => {
    const t = convexTest(schema, modules);
    const network = await seedNetwork(t);
    const seeded = await seedCommunityUser(t, {
      email: "fulfilled@community.example",
      requestor: true,
    });
    const fulfilledId = await seedRequest(t, {
      userId: seeded.id,
      hospitalOrgId: network.hospitalOrg,
      requestId: "LL-REQ-7200",
      status: "fulfilled",
      units: 2,
    });
    const pendingId = await seedRequest(t, {
      userId: seeded.id,
      hospitalOrgId: network.hospitalOrg,
      requestId: "LL-REQ-7201",
      status: "pending",
      units: 2,
      urgency: "urgent",
    });
    const verifiedId = await seedRequest(t, {
      userId: seeded.id,
      hospitalOrgId: network.hospitalOrg,
      requestId: "LL-REQ-7202",
      status: "under_verification",
      units: 2,
    });

    const asOwner = t.withIdentity({ subject: String(seeded.id) });
    const overview = await asOwner.query(api.community.overview, {});
    expect(overview.requests.fulfilled).toBe(1);
    expect(overview.requests.total).toBe(3);

    await asOwner.mutation(api.requests.updateOwnRequest, {
      id: pendingId,
      units: 3,
      urgency: "emergency",
    });
    const mine = await asOwner.query(api.requests.mine, {});
    expect(mine.find((row) => row._id === pendingId)?.units).toBe(3);
    expect(mine.find((row) => row._id === pendingId)?.urgency).toBe("emergency");

    await expect(
      asOwner.mutation(api.requests.updateOwnRequest, { id: verifiedId, units: 5 }),
    ).rejects.toThrow(/can no longer be edited/i);

    const other = await seedCommunityUser(t, { email: "editor.other@community.example" });
    await expect(
      t
        .withIdentity({ subject: String(other.id) })
        .mutation(api.requests.updateOwnRequest, { id: pendingId, units: 4 }),
    ).rejects.toThrow(/not found/i);

    void fulfilledId;
  });

  test("a request created from the community account is counted and appears in activity", async () => {
    const t = convexTest(schema, modules);
    const network = await seedNetwork(t);
    const seeded = await seedCommunityUser(t, {
      email: "create@community.example",
      requestor: true,
    });
    const asOwner = t.withIdentity({ subject: String(seeded.id) });

    // Community/requestor accounts can no longer create blood requests through
    // the mutation (creation is limited to verified hospitals and Red Cross).
    // Seed the request directly so the dashboard integration can still be
    // exercised: a request the community account created previously appears in
    // the overview and activity even though new creation is now blocked.
    const created = await t.run(async (ctx) => {
      const id = await ctx.db.insert("bloodRequests", {
        requestId: "LL-COM-7500",
        source: "requestor",
        createdByUserId: seeded.id,
        requestorName: "Community Member",
        requestorType: "family",
        requesterPhone: "9876543210",
        patientName: "Synthetic Patient",
        patientRef: "SYN-CREATE-1",
        hospitalName: "Community Test Hospital",
        hospitalOrgId: network.hospitalOrg,
        city: "Pune",
        bloodGroup: "O+",
        component: "red_cells",
        units: 2,
        requiredBy: NOW + 2 * DAY,
        urgency: "urgent",
        reason: "Synthetic request created from the unified community dashboard test.",
        consent: true,
        status: "pending",
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("requestStatusHistory", {
        requestId: id,
        status: "pending",
        actorRole: "requestor",
        actorUserId: seeded.id,
        note: "Synthetic seed history.",
        createdAt: NOW,
      });
      return { id, requestId: "LL-COM-7500" };
    });

    const overview = await asOwner.query(api.community.overview, {});
    expect(overview.requests.total).toBe(1);
    expect(overview.requests.pending).toBe(1);

    const activity = await asOwner.query(api.community.activity, {});
    expect(
      activity.items.some(
        (item) => item.kind === "request" && item.requestCode === created.requestId,
      ),
    ).toBe(true);

    void network;
  });
});

describe("combined notifications and ownership", () => {
  test("notifications merge into one inbox with read/unread tracking and owner-only marking", async () => {
    const t = convexTest(schema, modules);
    const first = await seedCommunityUser(t, { email: "notify@community.example" });
    const second = await seedCommunityUser(t, { email: "notify.other@community.example" });

    const ids = await t.run(async (ctx) => {
      const unreadId = await ctx.db.insert("notifications", {
        userId: first.id,
        title: "Donation invitation",
        body: "A compatible request needs your blood group.",
        kind: "match",
        read: false,
        createdAt: NOW - 3_000,
      });
      await ctx.db.insert("notifications", {
        userId: first.id,
        title: "Request partially fulfilled",
        body: "Two units were verified.",
        kind: "request",
        read: true,
        createdAt: NOW - 2_000,
      });
      await ctx.db.insert("notifications", {
        userId: second.id,
        title: "Other user notification",
        body: "Must not leak.",
        kind: "system",
        read: false,
        createdAt: NOW - 1_000,
      });
      return { unreadId };
    });

    const asFirst = t.withIdentity({ subject: String(first.id) });
    const list = await asFirst.query(api.notifications.listMine, {});
    expect(list).toHaveLength(2);
    expect(list.some((row) => row.title === "Other user notification")).toBe(false);
    expect(await asFirst.query(api.notifications.unreadCount, {})).toBe(1);

    await asFirst.mutation(api.notifications.markRead, { notificationId: ids.unreadId });
    expect(await asFirst.query(api.notifications.unreadCount, {})).toBe(0);

    const asSecond = t.withIdentity({ subject: String(second.id) });
    await expect(
      asSecond.mutation(api.notifications.markRead, { notificationId: ids.unreadId }),
    ).rejects.toThrow(/not found/i);
  });

  test("one account cannot see another community account's activity or counts", async () => {
    const t = convexTest(schema, modules);
    const network = await seedNetwork(t);
    const first = await seedCommunityUser(t, {
      email: "owner@community.example",
      donor: true,
      requestor: true,
    });
    const second = await seedCommunityUser(t, { email: "intruder@community.example" });

    await seedRequest(t, {
      userId: first.id,
      hospitalOrgId: network.hospitalOrg,
      requestId: "LL-REQ-7300",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("donations", {
        donorProfileId: first.donorId!,
        donorUserId: first.id,
        donationDate: iso(-3),
        component: "whole_blood",
        units: 1,
        recordedByUserId: network.staff,
        createdAt: NOW - 3 * DAY,
      });
    });

    const asSecond = t.withIdentity({ subject: String(second.id) });
    const overview = await asSecond.query(api.community.overview, {});
    expect(overview.requests.total).toBe(0);
    expect(overview.donations.count).toBe(0);

    const activity = await asSecond.query(api.community.activity, {});
    expect(activity.items).toEqual([]);
  });

  test("a legacy guest identity cannot read the unified dashboard data", async () => {
    const t = convexTest(schema, modules);
    const guestId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Legacy Guest",
        email: "guest.community@example.com",
        isAnonymous: true,
        city: "Pune",
        createdAt: NOW,
      }),
    );
    const asGuest = t.withIdentity({ subject: String(guestId) });
    await expect(asGuest.query(api.community.overview, {})).rejects.toThrow(
      /guest access has been removed/i,
    );
    await expect(asGuest.query(api.community.activity, {})).rejects.toThrow(
      /guest access has been removed/i,
    );
  });

  test("staff separation and ML scoping are preserved", async () => {
    const t = convexTest(schema, modules);
    const network = await seedNetwork(t);
    const community = await seedCommunityUser(t, {
      email: "separation@community.example",
      requestor: true,
    });
    const requestId = await seedRequest(t, {
      userId: community.id,
      hospitalOrgId: network.hospitalOrg,
      requestId: "LL-REQ-7400",
    });

    // A community account cannot read staff demand forecasts.
    const forecast = await t
      .withIdentity({ subject: String(community.id) })
      .query(api.ml.latestDemandForecast, {});
    expect(forecast).toBeNull();

    // Red Cross staff cannot take over a community request edit path.
    await expect(
      t
        .withIdentity({ subject: String(network.staff) })
        .mutation(api.requests.updateOwnRequest, { id: requestId, units: 2 }),
    ).rejects.toThrow(/not found/i);

    // Hospital staff cannot absorb a community profile.
    const hospitalUser = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Hospital Staff",
        email: "hospital.sep@community.example",
        role: "hospital",
        organizationId: network.hospitalOrg,
        city: "Pune",
        phone: "9876543211",
        profileCompleted: true,
        createdAt: NOW,
      }),
    );
    await expect(
      t.withIdentity({ subject: String(hospitalUser) }).mutation(api.profiles.registerRequestor, {
        fullName: "Hospital Staff",
        phone: "9876543210",
        requestorType: "representative",
        city: "Pune",
        consent: true,
      }),
    ).rejects.toThrow(/staff/i);
  });
});

describe("unified navigation wiring", () => {
  test("legacy donor and requestor routes redirect into the unified sections", () => {
    const donor = readFileSync("src/pages/dashboards/DonorDashboard.tsx", "utf8");
    const requestor = readFileSync("src/pages/dashboards/RequestorDashboard.tsx", "utf8");
    expect(donor).toMatch(/set\("section",\s*"donate"\)/);
    expect(requestor).toMatch(/set\("section",\s*"request"\)/);
    expect(donor).toContain("Navigate");
    expect(requestor).toContain("Navigate");
  });

  test("the sidebar exposes Overview, Activities and Settings with mobile navigation", () => {
    const dashboard = readFileSync("src/pages/dashboards/CommunityDashboard.tsx", "utf8");
    expect(dashboard).toContain("COMMUNITY_SIDEBAR_KEYS");
    expect(dashboard).toContain("Overview");
    expect(dashboard).toContain("My Activities");
    expect(dashboard).toContain("Settings");
    // The donate/request/notification/profile entries are deliberately hidden
    // from the sidebar while their routes and settings tooling remain intact.
    expect(dashboard).not.toContain('{ key: "donate"');
    expect(dashboard).not.toContain('{ key: "request"');
    expect(dashboard).not.toContain('{ key: "notifications"');
    expect(dashboard).not.toContain('{ key: "profile"');
    const settings = readFileSync(
      "src/pages/dashboards/community/SettingsSection.tsx",
      "utf8",
    );
    expect(settings).toContain("ProfileSection");
    expect(settings).toContain('label: "Profile"');
    const shell = readFileSync("src/components/lifelink/DashboardShell.tsx", "utf8");
    expect(shell).toContain("SheetTrigger");
    expect(shell).toContain("Open dashboard menu");
    expect(shell).toContain("aria-current");
    expect(shell).toContain("min-h-0 flex-1");
    expect(shell).toContain("overscroll-contain");
  });
});
