import { describe, expect, test } from "bun:test";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";

const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./profiles.ts": () => import("../src/convex/profiles"),
};

type TestApp = TestConvex<typeof schema>;

async function seed(t: TestApp) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const community = await ctx.db.insert("users", {
      name: "Profile Owner",
      email: "profile-owner@test.example",
      role: "community",
      roles: ["community"],
      city: "Pune",
      phone: "+919876570001",
      profileCompleted: true,
      createdAt: now,
    });
    const donorId = await ctx.db.insert("donorProfiles", {
      userId: community,
      donorId: "LL-D-PROFILE1",
      fullName: "Profile Owner",
      bloodGroup: "O+",
      dateOfBirth: "1992-04-12",
      phone: "+919876570001",
      email: "profile-owner@test.example",
      address: "12 Original Road",
      city: "Pune",
      area: "Kothrud",
      preferredCenter: "City Blood Bank",
      available: true,
      shareContact: true,
      bloodGroupSource: "self_declared",
      bloodGroupUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const requestorId = await ctx.db.insert("requestorProfiles", {
      userId: community,
      requestorId: "LL-P-PROFILE1",
      fullName: "Profile Owner",
      phone: "+919876570001",
      email: "profile-owner@test.example",
      requestorType: "family",
      city: "Pune",
      createdAt: now,
    });
    const organization = await ctx.db.insert("organizations", {
      orgId: "HOSP-PROFILE-1",
      type: "hospital",
      name: "Profile Hospital",
      contactPerson: "Staff Contact",
      phone: "02026128001",
      email: "hospital-profile@test.example",
      address: "1 Hospital Road",
      city: "Pune",
      status: "verified",
      verifiedAt: now,
      verifiedBy: "Test",
      createdByUserId: community,
      createdAt: now,
      updatedAt: now,
    });
    const hospital = await ctx.db.insert("users", {
      name: "Hospital Staff",
      email: "hospital-profile@test.example",
      role: "hospital",
      organizationId: organization,
      profileCompleted: true,
      createdAt: now,
    });
    const other = await ctx.db.insert("users", {
      name: "Other Profile",
      email: "other-profile@test.example",
      role: "community",
      profileCompleted: true,
      createdAt: now,
    });
    return { community, donorId, requestorId, hospital, organization, other };
  });
}

describe("profile inside settings", () => {
  test("loads the authenticated account's own donor and requestor records", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const me = await t
      .withIdentity({ subject: String(seeded.community) })
      .query(api.profiles.me, {});
    expect(me?.user.email).toBe("profile-owner@test.example");
    expect(me?.donor?.donorId).toBe("LL-D-PROFILE1");
    expect(me?.donor?.bloodGroup).toBe("O+");
    expect(me?.requestor?.requestorId).toBe("LL-P-PROFILE1");
    expect(me?.organization).toBeNull();
  });

  test("role-specific staff profile keeps its organization relationship", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const me = await t
      .withIdentity({ subject: String(seeded.hospital) })
      .query(api.profiles.me, {});
    expect(me?.user.role).toBe("hospital");
    expect(me?.organization?._id).toBe(seeded.organization);
    expect(me?.donor).toBeNull();
    expect(me?.requestor).toBeNull();
  });

  test("permitted donor edits save once without changing blood group or duplicating the profile", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    await t
      .withIdentity({ subject: String(seeded.community) })
      .mutation(api.profiles.updateDonorProfile, {
        phone: "+919876570099",
        address: "99 Updated Road",
        city: "Mumbai",
        area: "Andheri",
        preferredCenter: "Updated Centre",
        shareContact: false,
      });

    const me = await t
      .withIdentity({ subject: String(seeded.community) })
      .query(api.profiles.me, {});
    expect(me?.donor?.phone).toBe("+919876570099");
    expect(me?.donor?.address).toBe("99 Updated Road");
    expect(me?.donor?.city).toBe("Mumbai");
    expect(me?.donor?.bloodGroup).toBe("O+");
    expect(me?.donor?.shareContact).toBe(false);
    expect(me?.user.city).toBe("Mumbai");

    const donors = await t.run(async (ctx) =>
      ctx.db
        .query("donorProfiles")
        .withIndex("by_user", (q) => q.eq("userId", seeded.community))
        .collect(),
    );
    expect(donors).toHaveLength(1);
  });

  test("requestor edits save and validation rejects an invalid phone", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const asOwner = t.withIdentity({ subject: String(seeded.community) });
    await asOwner.mutation(api.profiles.updateRequestorProfile, {
      phone: "+919876570088",
      city: "Pune",
      requestorType: "patient",
    });
    const me = await asOwner.query(api.profiles.me, {});
    expect(me?.requestor?.phone).toBe("+919876570088");
    expect(me?.requestor?.requestorType).toBe("patient");

    await expect(
      asOwner.mutation(api.profiles.updateRequestorProfile, { phone: "12" }),
    ).rejects.toThrow(/phone/i);
  });

  test("editing one account never changes another account's profile", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    await t
      .withIdentity({ subject: String(seeded.community) })
      .mutation(api.profiles.updateDonorProfile, { city: "Mumbai" });
    const other = await t
      .withIdentity({ subject: String(seeded.other) })
      .query(api.profiles.me, {});
    expect(other?.donor).toBeNull();
    expect(other?.user.city).toBeNull();
  });
});
