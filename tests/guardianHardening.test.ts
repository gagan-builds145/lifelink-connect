import { describe, expect, test } from "bun:test";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api, internal } from "../src/convex/_generated/api";
import {
  chosenThreshold,
  daysUntil,
  reminderThresholds,
} from "../src/convex/guardianDocuments";

const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./documents.ts": () => import("../src/convex/documents"),
  "./guardianDocuments.ts": () => import("../src/convex/guardianDocuments"),
};

type TestApp = TestConvex<typeof schema>;

const DAY = 86_400_000;
const futureDate = (days: number) =>
  new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

async function seedGuardian(t: TestApp) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const admin = await ctx.db.insert("users", {
      name: "Expiry Admin",
      email: "expiry-admin@test.example",
      role: "admin",
      roles: ["admin"],
      profileCompleted: true,
      createdAt: now,
    });
    const guardian = await ctx.db.insert("users", {
      name: "Expiry Guardian",
      email: "expiry-guardian@test.example",
      role: "guardian",
      roles: ["guardian"],
      profileCompleted: true,
      createdAt: now,
    });
    const profile = await ctx.db.insert("guardianProfiles", {
      userId: guardian,
      companyName: "Expiry Ambulance",
      contactPerson: "Owner",
      phone: "+919876543210",
      city: "Pune",
      address: "Depot",
      online: true,
      documentsStatus: "verified",
      status: "APPROVED",
      driver: {
        fullName: "Owner",
        phone: "+919876543210",
        licenceNumber: "MH12TEST",
        licenceCategory: "LMV",
        licenceExpiryDate: futureDate(365),
        available: true,
      },
      createdAt: now,
      updatedAt: now,
    });
    const vehicle = await ctx.db.insert("ambulances", {
      guardianUserId: guardian,
      registrationNumber: "MH12EXPIRY",
      model: "Traveller",
      type: "bls",
      capacity: 2,
      driverName: "Owner",
      driverPhone: "+919876543210",
      available: true,
      createdAt: now,
      updatedAt: now,
    });
    const storageId = await ctx.storage.store(
      new Blob(["%PDF-1.4 test"], { type: "application/pdf" }),
    );
    const document = await ctx.db.insert("documentMetadata", {
      storageId,
      uploadedByUserId: guardian,
      guardianUserId: guardian,
      ambulanceId: vehicle,
      fileName: "insurance.pdf",
      contentType: "application/pdf",
      size: 13,
      purpose: "guardian_onboarding",
      documentKind: "insurance",
      expiryDate: futureDate(10),
      status: "approved",
      scanStatus: "clean",
      createdAt: now,
    });
    return { admin, guardian, profile, vehicle, document, storageId };
  });
}

describe("malware scanning and document quarantine", () => {
  test("a pending document cannot be reviewed or opened, including by Red Cross", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const guardian = await ctx.db.insert("users", {
        name: "Guardian",
        email: "guardian-scan@test.example",
        role: "guardian",
        roles: ["guardian"],
        createdAt: now,
      });
      const admin = await ctx.db.insert("users", {
        name: "Admin",
        email: "admin-scan@test.example",
        role: "admin",
        roles: ["admin"],
        createdAt: now,
      });
      const redCross = await ctx.db.insert("users", {
        name: "Red Cross",
        email: "redcross-scan@test.example",
        role: "red_cross",
        roles: ["red_cross"],
        createdAt: now,
      });
      return { guardian, admin, redCross };
    });
    const asGuardian = t.withIdentity({ subject: seeded.guardian });
    const asAdmin = t.withIdentity({ subject: seeded.admin });
    const asRedCross = t.withIdentity({ subject: seeded.redCross });

    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], {
          type: "application/pdf",
        }),
      ),
    );
    const attached = await asGuardian.mutation(api.documents.attachDocument, {
      storageId,
      fileName: "licence.pdf",
      contentType: "application/pdf",
      size: 8,
      purpose: "guardian_onboarding",
      documentKind: "driving_licence_front",
    });

    await expect(
      asAdmin.mutation(api.documents.reviewDocument, {
        documentId: attached.documentId,
        status: "approved",
      }),
    ).rejects.toThrow(/quarantined/i);
    await expect(
      asGuardian.query(api.documents.getUrl, { documentId: attached.documentId }),
    ).rejects.toThrow(/quarantined/i);

    await t.run(async (ctx) =>
      ctx.db.patch(attached.documentId, {
        scanStatus: "clean",
        scannedAt: Date.now(),
        scanEngine: "clamav",
      }),
    );
    await asAdmin.mutation(api.documents.reviewDocument, {
      documentId: attached.documentId,
      status: "approved",
    });
    await expect(
      asRedCross.query(api.documents.getUrl, { documentId: attached.documentId }),
    ).rejects.toThrow(/not authorized/i);
  });

  test("scanner errors leave a document quarantined", async () => {
    const t = convexTest(schema, modules);
    const guardian = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Guardian",
        email: "guardian-error@test.example",
        role: "guardian",
        roles: ["guardian"],
        createdAt: Date.now(),
      }),
    );
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(
        new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
          type: "application/pdf",
        }),
      ),
    );
    const attached = await t
      .withIdentity({ subject: guardian })
      .mutation(api.documents.attachDocument, {
        storageId,
        fileName: "scan.pdf",
        contentType: "application/pdf",
        size: 4,
        purpose: "guardian_onboarding",
        documentKind: "insurance",
      });
    await t.mutation(internal.documents.recordScanResult, {
      documentId: attached.documentId,
      status: "error",
      error: "scanner unavailable",
    });
    const context = await t.query(internal.documents.getScanContext, {
      documentId: attached.documentId,
    });
    expect(context?.scanStatus).toBe("error");
    await expect(
      t
        .withIdentity({ subject: guardian })
        .query(api.documents.getUrl, { documentId: attached.documentId }),
    ).rejects.toThrow(/quarantined/i);
  });
});

describe("Guardian document expiry", () => {
  test("reminder thresholds are configurable and deterministic", () => {
    expect(reminderThresholds("30, 14,7,1,14,bad,0")).toEqual([1, 7, 14, 30]);
    expect(reminderThresholds("")).toEqual([30, 14, 7, 1]);
    expect(chosenThreshold(20, [1, 7, 14, 30])).toBe(30);
    expect(chosenThreshold(6, [1, 7, 14, 30])).toBe(7);
    expect(chosenThreshold(0, [1, 7, 14, 30])).toBeNull();
    expect(daysUntil("2030-01-31", "2030-01-01")).toBe(30);
  });

  test("sends deduplicated reminders, then expires the document and eligibility", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedGuardian(t);

    const first = await t.mutation(internal.guardianDocuments.expirySweep, {});
    expect(first.reminders).toBe(1);
    let notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(notifications.length).toBe(2); // Guardian + administrator.

    const second = await t.mutation(internal.guardianDocuments.expirySweep, {});
    expect(second.reminders).toBe(0);
    notifications = await t.run(async (ctx) =>
      ctx.db.query("notifications").collect(),
    );
    expect(notifications.length).toBe(2);

    await t.run(async (ctx) => {
      await ctx.db.patch(seeded.document, { expiryDate: futureDate(-1) });
    });
    const expired = await t.mutation(internal.guardianDocuments.expirySweep, {});
    expect(expired.expired).toBe(1);
    expect(expired.guardiansSuspended).toBe(1);

    const state = await t.run(async (ctx) => ({
      document: await ctx.db.get(seeded.document),
      profile: await ctx.db.get(seeded.profile),
      vehicle: await ctx.db.get(seeded.vehicle),
      audits: await ctx.db.query("auditLogs").collect(),
    }));
    expect(state.document?.status).toBe("expired");
    expect(state.profile?.status).toBe("EXPIRED");
    expect(state.profile?.online).toBe(false);
    expect(state.vehicle?.available).toBe(false);
    expect(state.audits.some((row) => row.action === "guardian.document_expired")).toBe(true);
  });
});

describe("Live Aadhaar removal", () => {
  test("no Aadhaar API, callback module or identity table remains", async () => {
    expect("aadhaar" in api).toBe(false);
    expect(Object.keys(schema.tables)).not.toContain("donorIdentityVerifications");
    expect(Object.keys(schema.tables)).not.toContain("aadhaarVerifications");
  });
});
