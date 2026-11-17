import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api, internal } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";

/**
 * Authentication regression suite.
 *
 * Covers the strict-login requirements: only registered accounts can start a
 * sign-in, guest access is gone, anonymous identities are refused by the
 * backend, and a unified community account can hold both profiles.
 */
const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./authGate.ts": () => import("../src/convex/authGate"),
  "./profiles.ts": () => import("../src/convex/profiles"),
  "./security.ts": () => import("../src/convex/security"),
};

type TestApp = TestConvex<typeof schema>;

const NOW = Date.now();

async function seedUser(
  t: TestApp,
  user: {
    name: string;
    email: string;
    role?: "community" | "donor" | "requestor" | "hospital" | "admin" | "red_cross";
    isAnonymous?: boolean;
    withDonor?: boolean;
    withRequestor?: boolean;
  },
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: user.name,
      email: user.email,
      role: user.isAnonymous ? undefined : (user.role ?? "community"),
      isAnonymous: user.isAnonymous,
      city: "Pune",
      phone: "9876543210",
      profileCompleted: true,
      createdAt: NOW,
    });

    if (user.withDonor) {
      await ctx.db.insert("donorProfiles", {
        userId,
        donorId: `LL-D-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        fullName: user.name,
        bloodGroup: "O+",
        dateOfBirth: "1992-04-11",
        phone: "9876543210",
        email: user.email,
        address: "12 Test Lane",
        city: "Pune",
        available: true,
        shareContact: true,
        lastDonationDate: "2026-01-05",
        createdAt: NOW,
        updatedAt: NOW,
      });
    }
    if (user.withRequestor) {
      await ctx.db.insert("requestorProfiles", {
        userId,
        requestorId: `LL-P-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        fullName: user.name,
        phone: "9876543210",
        email: user.email,
        requestorType: "family",
        city: "Pune",
        createdAt: NOW,
      });
    }
    return userId as Id<"users">;
  });
}

describe("strict login validation", () => {
  test("a registered email passes the login pre-check", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, { name: "Registered Donor", email: "donor@test.example", withDonor: true });

    const status = await t.mutation(api.authGate.checkLoginEmail, { email: "donor@test.example" });
    expect(status.status).toBe("registered");
  });

  test("an unregistered email is reported as unknown, without creating an account", async () => {
    const t = convexTest(schema, modules);

    const status = await t.mutation(api.authGate.checkLoginEmail, {
      email: "nobody@test.example",
    });
    expect(status.status).toBe("unknown");

    const users = await t.run(async (ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(0);
  });

  test("malformed and empty emails cannot be probed for state", async () => {
    const t = convexTest(schema, modules);

    expect((await t.mutation(api.authGate.checkLoginEmail, { email: "not-an-email" })).status).toBe(
      "unknown",
    );
    expect((await t.mutation(api.authGate.checkLoginEmail, { email: "" })).status).toBe("unknown");
    expect(
      (await t.mutation(api.authGate.checkLoginEmail, { email: "a@b" })).status,
    ).toBe("unknown");
  });

  test("repeated login lookups are rate limited and logged", async () => {
    const t = convexTest(schema, modules);
    await seedUser(t, { name: "Rate Test", email: "rate@test.example" });

    let limited = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const result = await t.mutation(api.authGate.checkLoginEmail, { email: "rate@test.example" });
      if (result.status === "rate_limited") limited += 1;
    }
    expect(limited).toBeGreaterThan(0);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query("securityEvents")
        .withIndex("by_kind", (q) => q.eq("kind", "rate_limited"))
        .collect(),
    );
    expect(events.length).toBeGreaterThan(0);
    // The security event must not carry the email address.
    expect(JSON.stringify(events)).not.toContain("rate@test.example");
  });
});

describe("OTP provider policy", () => {
  test("codes are six digits and expire after 15 minutes", async () => {
    const { emailOtp } = await import("../src/convex/auth/emailOtp");
    expect(emailOtp.maxAge).toBe(15 * 60);
    const code = await emailOtp.generateVerificationToken!();
    expect(code).toMatch(/^\d{6}$/);
    // A resend issues a different code value.
    const next = await emailOtp.generateVerificationToken!();
    expect(next).toMatch(/^\d{6}$/);
    expect(next).not.toBe(code);
  });

  test("OTP requests per address are capped and resends stop at the limit", async () => {
    const t = convexTest(schema, modules);
    const allowed = [];
    for (let i = 0; i < 7; i += 1) {
      allowed.push(
        (await t.mutation(internal.authGate.reserveOtp, { email: "resend@test.example" })).allowed,
      );
    }
    expect(allowed.slice(0, 5).every(Boolean)).toBe(true);
    expect(allowed.slice(5)).toEqual([false, false]);
  });
});

describe("guest access removed", () => {
  test("the Convex Auth configuration has no anonymous provider", () => {
    const config = readFileSync("src/convex/auth.ts", "utf8");
    expect(config).not.toMatch(/import\s*\{[^}]*Anonymous[^}]*\}/);
    expect(config).not.toMatch(/providers:\s*\[[^\]]*Anonymous/);
    expect(config).toMatch(/providers:\s*\[emailOtp\]/);
  });

  test("no frontend code can start a guest session", () => {
    const files = [
      "src/components/lifelink/EmailOtpForm.tsx",
      "src/components/lifelink/SignupGate.tsx",
      "src/pages/Auth.tsx",
      "src/pages/ForgotPassword.tsx",
    ];
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      expect(code).not.toMatch(/signIn\(\s*["']anonymous["']\s*\)/i);
      expect(code).not.toMatch(/demo guest/i);
      expect(code).not.toMatch(/Continue as guest/i);
      expect(code).not.toMatch(/guest\s+(session|access|login)/i);
    }
  });

  test("a legacy anonymous identity is refused by the backend", async () => {
    const t = convexTest(schema, modules);
    const anonymousId = await seedUser(t, {
      name: "Legacy Guest",
      email: "guest@test.example",
      isAnonymous: true,
    });

    const asGuest = t.withIdentity({ subject: String(anonymousId) });
    await expect(asGuest.query(api.profiles.me, {})).rejects.toThrow(/guest access has been removed/i);
    await expect(
      asGuest.mutation(api.profiles.registerDonor, {
        fullName: "Guest Donor",
        bloodGroup: "O+",
        dateOfBirth: "1990-01-01",
        phone: "9876543211",
        address: "1 Guest Lane",
        city: "Pune",
        available: true,
        shareContact: false,
        consent: true,
      }),
    ).rejects.toThrow(/guest access has been removed/i);

    // Staff-only and admin-only surfaces are closed to guest identities too.
    await expect(
      asGuest.query(api.security.securityEventCounts, {}),
    ).rejects.toThrow(/administrator|guest access has been removed/i);

    // No profile or role change was written.
    const donors = await t.run(async (ctx) => ctx.db.query("donorProfiles").collect());
    expect(donors).toHaveLength(0);
    const user = await t.run(async (ctx) => ctx.db.get(anonymousId));
    expect(user?.role).toBeUndefined();
  });
});

describe("unified community account", () => {
  test("one account can hold donor and requestor profiles together", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, {
      name: "Both Profiles",
      email: "both@test.example",
      withDonor: true,
      withRequestor: true,
    });

    const me = await t
      .withIdentity({ subject: String(userId) })
      .query(api.profiles.me, {});

    expect(me.user.role).toBe("community");
    expect(me.donor?.fullName).toBe("Both Profiles");
    expect(me.requestor?.fullName).toBe("Both Profiles");
    expect(me.donor?.lastDonationDate).toBe("2026-01-05");
  });

  test("an existing donor-only account still reads its history and can add requestor access", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, {
      name: "Existing Donor",
      email: "existing.donor@test.example",
      role: "donor",
      withDonor: true,
    });
    const asDonor = t.withIdentity({ subject: String(userId) });

    const before = await asDonor.query(api.profiles.me, {});
    expect(before.donor).not.toBeNull();
    expect(before.donor?.lastDonationDate).toBe("2026-01-05");
    expect(before.requestor).toBeNull();

    await asDonor.mutation(api.profiles.registerRequestor, {
      fullName: "Existing Donor",
      phone: "9876543210",
      requestorType: "family",
      city: "Pune",
      consent: true,
    });

    const after = await asDonor.query(api.profiles.me, {});
    expect(after.donor?.lastDonationDate).toBe("2026-01-05");
    expect(after.requestor).not.toBeNull();
    expect(after.user.role).toBe("community");
  });

  test("an existing requestor-only account still reads its profile and can add donor access", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, {
      name: "Existing Requestor",
      email: "existing.requestor@test.example",
      role: "requestor",
      withRequestor: true,
    });
    const asRequestor = t.withIdentity({ subject: String(userId) });

    const before = await asRequestor.query(api.profiles.me, {});
    expect(before.requestor).not.toBeNull();
    expect(before.donor).toBeNull();

    await asRequestor.mutation(api.profiles.registerDonor, {
      fullName: "Existing Requestor",
      bloodGroup: "A+",
      dateOfBirth: "1991-02-02",
      phone: "9876543210",
      address: "9 Existing Lane",
      city: "Pune",
      available: true,
      shareContact: true,
      consent: true,
    });

    const after = await asRequestor.query(api.profiles.me, {});
    expect(after.requestor?.requestorId).toBe(before.requestor?.requestorId);
    expect(after.donor).not.toBeNull();
    expect(after.user.role).toBe("community");
  });

  test("staff roles cannot absorb a community profile", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t, {
      name: "Hospital Staff",
      email: "staff@test.example",
      role: "hospital",
    });
    const asStaff = t.withIdentity({ subject: String(userId) });

    await expect(
      asStaff.mutation(api.profiles.registerDonor, {
        fullName: "Hospital Staff",
        bloodGroup: "O+",
        dateOfBirth: "1990-01-01",
        phone: "9876543210",
        address: "1 Hospital Road",
        city: "Pune",
        available: true,
        shareContact: false,
        consent: true,
      }),
    ).rejects.toThrow(/staff/i);
    await expect(
      asStaff.mutation(api.profiles.registerRequestor, {
        fullName: "Hospital Staff",
        phone: "9876543210",
        requestorType: "representative",
        city: "Pune",
        consent: true,
      }),
    ).rejects.toThrow(/staff/i);
  });

  test("admin-only security monitoring is still enforced", async () => {
    const t = convexTest(schema, modules);
    const communityId = await seedUser(t, {
      name: "Community",
      email: "community@test.example",
      withDonor: true,
    });
    const adminId = await seedUser(t, { name: "Admin", email: "admin@test.example", role: "admin" });

    await expect(
      t.withIdentity({ subject: String(communityId) }).query(api.security.securityEventCounts, {}),
    ).rejects.toThrow(/administrator/i);

    const counts = await t
      .withIdentity({ subject: String(adminId) })
      .query(api.security.securityEventCounts, {});
    expect(counts).toBeDefined();
  });
});
