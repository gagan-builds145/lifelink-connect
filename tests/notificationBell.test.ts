import { describe, expect, test } from "bun:test";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";
import { NOTIFICATION_KIND_LABELS, notificationKindLabel } from "../src/lib/notifications";
import { COMMUNITY_HIDDEN_SECTION_KEYS, COMMUNITY_SIDEBAR_KEYS } from "../src/lib/communityNavigation";

const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./notifications.ts": () => import("../src/convex/notifications"),
};

type TestApp = TestConvex<typeof schema>;

async function seed(t: TestApp) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const alice = await ctx.db.insert("users", {
      name: "Alice",
      email: "alice-notify@test.example",
      role: "community",
      profileCompleted: true,
      createdAt: now,
    });
    const bob = await ctx.db.insert("users", {
      name: "Bob",
      email: "bob-notify@test.example",
      role: "community",
      profileCompleted: true,
      createdAt: now,
    });
    const kinds = Object.keys(NOTIFICATION_KIND_LABELS) as Array<
      keyof typeof NOTIFICATION_KIND_LABELS
    >;
    for (const [index, kind] of kinds.entries()) {
      await ctx.db.insert("notifications", {
        userId: alice,
        title: `${kind} update`,
        body: `Real ${kind} notification`,
        kind,
        read: false,
        createdAt: now - index * 1_000,
      });
    }
    await ctx.db.insert("notifications", {
      userId: bob,
      title: "Bob private update",
      body: "Only Bob may see this.",
      kind: "system",
      read: false,
      createdAt: now,
    });
    return { alice, bob };
  });
}

describe("notification bell data", () => {
  test("all supported categories have a readable label", () => {
    expect(Object.keys(NOTIFICATION_KIND_LABELS)).toEqual([
      "request",
      "match",
      "inventory",
      "camp",
      "ambulance",
      "system",
    ]);
    expect(notificationKindLabel("ambulance")).toBe("Ambulance update");
    expect(notificationKindLabel("unknown")).toBe("LifeLink update");
  });

  test("list, unread count, mark one, mark all, and privacy follow the signed-in user", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const asAlice = t.withIdentity({ subject: String(seeded.alice) });
    const asBob = t.withIdentity({ subject: String(seeded.bob) });

    const aliceList = await asAlice.query(api.notifications.listMine, {});
    expect(aliceList).toHaveLength(6);
    expect(aliceList.map((row) => row.kind).sort()).toEqual([
      "ambulance",
      "camp",
      "inventory",
      "match",
      "request",
      "system",
    ]);
    expect(await asAlice.query(api.notifications.unreadCount, {})).toBe(6);

    const bobList = await asBob.query(api.notifications.listMine, {});
    expect(bobList).toHaveLength(1);
    expect(bobList[0].title).toBe("Bob private update");

    await asAlice.mutation(api.notifications.markRead, {
      notificationId: aliceList[0]._id,
    });
    expect(await asAlice.query(api.notifications.unreadCount, {})).toBe(5);
    expect(await asBob.query(api.notifications.unreadCount, {})).toBe(1);

    await asAlice.mutation(api.notifications.markAllRead, {});
    expect(await asAlice.query(api.notifications.unreadCount, {})).toBe(0);
    expect(await asBob.query(api.notifications.unreadCount, {})).toBe(1);
  });

  test("one user cannot mark another user's notification read", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const bobNotification = await t.run(async (ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_user", (q) => q.eq("userId", seeded.bob))
        .first(),
    );
    expect(bobNotification).not.toBeNull();
    await expect(
      t
        .withIdentity({ subject: String(seeded.alice) })
        .mutation(api.notifications.markRead, {
          notificationId: bobNotification!._id,
        }),
    ).rejects.toThrow(/not found/i);
  });

  test("sidebar excludes Donate, Request, Notifications and standalone Profile", () => {
    expect(COMMUNITY_SIDEBAR_KEYS).toEqual(["overview", "activities", "settings"]);
    for (const hidden of ["donate", "request", "notifications", "profile"]) {
      expect(COMMUNITY_SIDEBAR_KEYS as readonly string[]).not.toContain(hidden);
      expect(COMMUNITY_HIDDEN_SECTION_KEYS as readonly string[]).toContain(hidden);
    }
  });
});
