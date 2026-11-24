import { describe, expect, test } from "bun:test";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api, internal } from "../src/convex/_generated/api";

const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./aadhaar.ts": () => import("../src/convex/aadhaar"),
  "./ambulances.ts": () => import("../src/convex/ambulances"),
  "./documents.ts": () => import("../src/convex/documents"),
  "./donors.ts": () => import("../src/convex/donors"),
  "./guardian.ts": () => import("../src/convex/guardian"),
  "./profiles.ts": () => import("../src/convex/profiles"),
};

type TestApp = TestConvex<typeof schema>;
const FUTURE = "2030-12-31";
const BLS_DOCS = [
  "driving_licence_front",
  "registration_certificate",
  "insurance",
  "fitness_certificate",
  "puc_certificate",
] as const;

async function seed(t: TestApp) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const admin = await ctx.db.insert("users", {
      name: "Phase Admin",
      email: "admin@phase3.test",
      role: "admin",
      roles: ["admin"],
      profileCompleted: true,
      createdAt: now,
    });
    const donor = await ctx.db.insert("users", {
      name: "Asha Donor",
      email: "asha@phase3.test",
      role: "community",
      roles: ["community"],
      phone: "+919876543210",
      city: "Pune",
      profileCompleted: true,
      createdAt: now,
    });
    await ctx.db.insert("donorProfiles", {
      userId: donor,
      donorId: "LL-D-0001",
      fullName: "Asha Donor",
      bloodGroup: "O+",
      dateOfBirth: "1994-05-10",
      phone: "+919876543210",
      email: "asha@phase3.test",
      address: "12 MG Road, Pune",
      city: "Pune",
      available: true,
      shareContact: true,
      bloodGroupSource: "self_declared",
      createdAt: now,
      updatedAt: now,
    });
    const otherDonor = await ctx.db.insert("users", {
      name: "Other Donor",
      email: "other@phase3.test",
      role: "community",
      roles: ["community"],
      profileCompleted: true,
      createdAt: now,
    });
    await ctx.db.insert("donorProfiles", {
      userId: otherDonor,
      donorId: "LL-D-0002",
      fullName: "Other Donor",
      bloodGroup: "A+",
      dateOfBirth: "1990-01-01",
      phone: "+919876543211",
      address: "9 Other Street",
      city: "Pune",
      available: true,
      shareContact: true,
      createdAt: now,
      updatedAt: now,
    });
    return { admin, donor, otherDonor };
  });
}

async function startSession(asDonor: ReturnType<TestApp["withIdentity"]>) {
  const started = await asDonor.mutation(api.aadhaar.startVerification, {
    consent: true,
    consentVersion: "2026-11-donor-identity-v1",
  });
  return started;
}

describe("Phase 3 — Aadhaar identity verification (sandbox only)", () => {
  test("explicit consent and the current consent version are mandatory", async () => {
    const t = convexTest(schema, modules);
    const { donor } = await seed(t);
    const asDonor = t.withIdentity({ subject: donor });
    await expect(
      asDonor.mutation(api.aadhaar.startVerification, {
        consent: false,
        consentVersion: "2026-11-donor-identity-v1",
      }),
    ).rejects.toThrow(/consent/i);
    await expect(
      asDonor.mutation(api.aadhaar.startVerification, {
        consent: true,
        consentVersion: "old-version",
      }),
    ).rejects.toThrow(/consent notice/i);
    await expect(asDonor.mutation(api.aadhaar.startVerification, {
      consent: true,
      consentVersion: "2026-11-donor-identity-v1",
    })).resolves.toBeTruthy();
  });

  test("sandbox verification is labelled, never claims UIDAI, and consent can erase the copy", async () => {
    const t = convexTest(schema, modules);
    const { donor } = await seed(t);
    const asDonor = t.withIdentity({ subject: donor });
    const started = await startSession(asDonor);
    expect(started.sandbox).toBe(true);

    const pending = await asDonor.query(api.aadhaar.myVerification, {});
    expect(pending?.latest?.status).toBe("PENDING");
    expect(pending?.liveEnabled).toBe(false);

    await asDonor.mutation(api.aadhaar.completeSandboxVerification, {
      verificationId: started.verificationId,
    });
    const verified = await asDonor.query(api.aadhaar.myVerification, {});
    expect(verified?.latest?.status).toBe("VERIFIED");
    expect(verified?.latest?.sandbox).toBe(true);
    expect(verified?.latest?.verifiedName).toBe("Asha Donor");

    await asDonor.mutation(api.aadhaar.withdrawConsent, {
      verificationId: started.verificationId,
    });
    const withdrawn = await asDonor.query(api.aadhaar.myVerification, {});
    expect(withdrawn?.latest?.status).toBe("REVOKED");
    expect(withdrawn?.latest?.verifiedName).toBeNull();
  });

  test("administrators cannot mark a verification VERIFIED and donors cannot review", async () => {
    const t = convexTest(schema, modules);
    const { donor, admin } = await seed(t);
    const asDonor = t.withIdentity({ subject: donor });
    const asAdmin = t.withIdentity({ subject: admin });
    const started = await startSession(asDonor);

    await expect(
      asDonor.mutation(api.aadhaar.reviewVerification, {
        verificationId: started.verificationId,
        status: "FAILED",
        reason: "Donor should not review",
      } as never),
    ).rejects.toThrow(/authorized/i);

    await asAdmin.mutation(api.aadhaar.reviewVerification, {
      verificationId: started.verificationId,
      status: "REQUIRES_REVIEW",
      reason: "Provider metadata needs a manual check.",
    });
    const rows = await asAdmin.query(api.aadhaar.adminVerifications, {});
    expect(rows[0]?.status).toBe("REQUIRES_REVIEW");
    expect(rows[0]?.status).not.toBe("VERIFIED");
  });
});

describe("Phase 3 — donor-declared blood group", () => {
  test("changes are audited and a medically verified group is locked", async () => {
    const t = convexTest(schema, modules);
    const { donor } = await seed(t);
    const asDonor = t.withIdentity({ subject: donor });
    const changed = await asDonor.mutation(api.donors.setBloodGroup, { bloodGroup: "B+" });
    expect(changed.changed).toBe(true);
    const history = await asDonor.query(api.donors.bloodGroupHistory, {});
    expect(history[0]?.previousGroup).toBe("O+");
    expect(history[0]?.newGroup).toBe("B+");
    expect(history[0]?.source).toBe("self_declared");

    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("donorProfiles")
        .withIndex("by_donor_id", (q) => q.eq("donorId", "LL-D-0001"))
        .unique();
      await ctx.db.patch(profile!._id, { bloodGroupSource: "medical_verified" });
    });
    await expect(
      asDonor.mutation(api.donors.setBloodGroup, { bloodGroup: "AB+" }),
    ).rejects.toThrow(/medically verified/i);
  });
});

describe("Phase 3 — donor to Guardian upgrade and multi-role", () => {
  test("a donor ID owned by another account is refused without disclosure", async () => {
    const t = convexTest(schema, modules);
    const { donor } = await seed(t);
    const asDonor = t.withIdentity({ subject: donor });
    await expect(
      asDonor.mutation(api.guardian.registerExistingDonor, { donorId: "LL-D-0002" }),
    ).rejects.toThrow(/could not be matched/i);
    await expect(
      asDonor.mutation(api.guardian.registerExistingDonor, { donorId: "LL-D-9999" }),
    ).rejects.toThrow(/could not be matched/i);
  });

  test("the same account gains Guardian while keeping the donor workspace", async () => {
    const t = convexTest(schema, modules);
    const { donor } = await seed(t);
    const asDonor = t.withIdentity({ subject: donor });
    const linked = await asDonor.mutation(api.guardian.registerExistingDonor, {
      donorId: "ll-d-0001",
    });
    expect(linked.roles).toContain("guardian");
    expect(linked.roles).toContain("community");

    const me = await asDonor.query(api.profiles.me, {});
    expect(me?.user.role).toBe("community");
    expect(me?.user.roles).toEqual(expect.arrayContaining(["community", "guardian"]));

    await asDonor.mutation(api.profiles.switchRole, { role: "guardian" });
    const switched = await asDonor.query(api.profiles.myRoles, {});
    expect(switched.active).toBe("guardian");
    expect(switched.roles).toContain("community");

    await expect(
      asDonor.mutation(api.profiles.switchRole, { role: "admin" }),
    ).rejects.toThrow(/not been granted/i);
  });
});

describe("Phase 3 — Guardian onboarding, documents and approval", () => {
  async function linkedGuardian(t: TestApp, donorId: string) {
    const seeded = await seed(t);
    const asDonor = t.withIdentity({ subject: seeded.donor });
    await asDonor.mutation(api.guardian.registerExistingDonor, { donorId });
    return { ...seeded, asDonor };
  }

  test("submission is blocked until mandatory sections, a vehicle and documents exist", async () => {
    const t = convexTest(schema, modules);
    const { asDonor } = await linkedGuardian(t, "LL-D-0001");
    await expect(
      asDonor.mutation(api.guardian.submitApplication, {}),
    ).rejects.toThrow(/complete these sections/i);
  });

  test("a complete application is approved by an admin and can go online", async () => {
    const t = convexTest(schema, modules);
    const { asDonor, donor, admin } = await linkedGuardian(t, "LL-D-0001");
    const asAdmin = t.withIdentity({ subject: admin });

    await asDonor.mutation(api.guardian.saveApplication, {
      email: "asha@phase3.test",
      dateOfBirth: "1994-05-10",
      residentialAddress: "12 MG Road, Pune",
      emergencyContactName: "Ravi Donor",
      emergencyContactPhone: "+919876543299",
      driver: {
        fullName: "Asha Donor",
        phone: "+919876543210",
        licenceNumber: "MH12 20200012345",
        licenceCategory: "LMV",
        licenceExpiryDate: FUTURE,
        available: true,
      },
      service: {
        bls: true,
        als: false,
        oxygen: true,
        stretcher: true,
        wheelchairAccessible: false,
        firstAid: true,
        emergencyEquipment: "Oxygen, suction, first-aid kit",
        operatingArea: "Pune",
        operatingHours: "24x7",
        emergencyContact: "+919876543210",
      },
      payout: {
        accountHolderName: "Asha Donor",
        bankName: "Test Bank",
        accountNumberLast4: "1234",
        ifsc: "HDFC0001234",
      },
    });

    const vehicle = await asDonor.mutation(api.ambulances.upsertAmbulance, {
      registrationNumber: "MH12AB1234",
      model: "Force Traveller",
      type: "bls",
      capacity: 2,
      driverName: "Asha Donor",
      driverPhone: "+919876543210",
      insuranceExpiryDate: FUTURE,
      fitnessExpiryDate: FUTURE,
      pucExpiryDate: FUTURE,
    });

    const storageIds = await t.run(async (ctx) => {
      const ids: unknown[] = [];
      for (const kind of BLS_DOCS) {
        const storageId = await ctx.storage.store(
          new Blob(["%PDF-1.4 test document"], { type: "application/pdf" }),
        );
        const docId = await ctx.db.insert("documentMetadata", {
          storageId,
          uploadedByUserId: donor,
          fileName: `${kind}.pdf`,
          contentType: "application/pdf",
          size: 22,
          purpose: "guardian_onboarding",
          guardianUserId: donor,
          ambulanceId: vehicle.ambulanceId,
          documentKind: kind,
          expiryDate: FUTURE,
          status: "pending",
          createdAt: Date.now(),
        });
        ids.push(docId);
      }
      return ids;
    });
    expect(storageIds.length).toBe(BLS_DOCS.length);

    await asDonor.mutation(api.guardian.submitApplication, {});
    let app = await asDonor.query(api.guardian.myGuardianApplication, {});
    expect(app?.profile.status).toBe("SUBMITTED");

    await asAdmin.mutation(api.guardian.reviewApplication, {
      guardianUserId: donor,
      status: "APPROVED",
      reason: "Documents and licence verified.",
    });
    app = await asDonor.query(api.guardian.myGuardianApplication, {});
    expect(app?.profile.status).toBe("APPROVED");
    expect(app?.approved).toBe(true);

    await asDonor.mutation(api.ambulances.setGuardianOnline, { online: true });
    const overview = await asDonor.query(api.ambulances.guardianOverview, {});
    expect(overview?.profile?.online).toBe(true);
  });

  test("an approver cannot skip the review lifecycle", async () => {
    const t = convexTest(schema, modules);
    const { asDonor, donor, admin } = await linkedGuardian(t, "LL-D-0001");
    const asAdmin = t.withIdentity({ subject: admin });
    await expect(
      asAdmin.mutation(api.guardian.reviewApplication, {
        guardianUserId: donor,
        status: "APPROVED",
      }),
    ).rejects.toThrow(/cannot move/i);
    // The donor cannot approve their own application.
    await expect(
      asDonor.mutation(api.guardian.reviewApplication, {
        guardianUserId: donor,
        status: "APPROVED",
      } as never),
    ).rejects.toThrow(/authorized/i);
  });

  test("the backend rejects files whose signature does not match the declared type", async () => {
    const t = convexTest(schema, modules);
    const { asDonor } = await linkedGuardian(t, "LL-D-0001");
    await expect(
      asDonor.mutation(api.documents.attachDocument, {
        storageId: await t.run(async (ctx) =>
          ctx.storage.store(new Blob(["not a pdf at all"], { type: "application/pdf" })),
        ),
        fileName: "fake.pdf",
        contentType: "application/pdf",
        size: 16,
        purpose: "guardian_onboarding",
        documentKind: "insurance",
      }),
    ).rejects.toThrow(/does not match/i);
  });
});

describe("Phase 3 — ambulance booking lifecycle", () => {
  async function approvedGuardian(t: TestApp) {
    const seeded = await seed(t);
    const { donor } = seeded;
    const asDonor = t.withIdentity({ subject: donor });
    await asDonor.mutation(api.guardian.registerExistingDonor, { donorId: "LL-D-0001" });
    const vehicle = await asDonor.mutation(api.ambulances.upsertAmbulance, {
      registrationNumber: "MH12XY9999",
      model: "Traveller",
      type: "bls",
      capacity: 2,
      driverName: "Asha Donor",
      driverPhone: "+919876543210",
    });
    await t.run(async (ctx) => {
      const profile = await ctx.db
        .query("guardianProfiles")
        .withIndex("by_user", (q) => q.eq("userId", donor))
        .unique();
      await ctx.db.patch(profile!._id, {
        status: "APPROVED",
        documentsStatus: "verified",
        online: true,
        driver: {
          fullName: "Asha Donor",
          phone: "+919876543210",
          licenceNumber: "MH1220200012345",
          licenceCategory: "LMV",
          licenceExpiryDate: FUTURE,
          available: true,
        },
      });
      const ambulance = await ctx.db.get(vehicle.ambulanceId);
      await ctx.db.patch(ambulance!._id, {
        latitude: 18.52,
        longitude: 73.85,
        lastLocationAt: Date.now(),
      });
    });
    return { ...seeded, asDonor, vehicle };
  }

  test("reject closes the request as REJECTED and releases the vehicle", async () => {
    const t = convexTest(schema, modules);
    const { asDonor, vehicle, otherDonor } = await approvedGuardian(t);
    const asRequester = t.withIdentity({ subject: otherDonor });
    const booking = await asRequester.mutation(api.ambulances.createBooking, {
      ambulanceId: vehicle.ambulanceId,
      pickupLabel: "Pickup point",
      pickupLat: 18.52,
      pickupLng: 73.85,
      destinationLabel: "Hospital",
      destinationLat: 18.53,
      destinationLng: 73.86,
      clientRequestId: "phase3-booking-0001",
    });
    await asDonor.mutation(api.ambulances.rejectBooking, {
      bookingId: booking.bookingId,
      reason: "Vehicle committed elsewhere.",
    });
    const mine = await asRequester.query(api.ambulances.myBookings, {});
    expect(mine[0]?.status).toBe("rejected");
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("ambulanceBookingEvents")
        .withIndex("by_booking", (q) => q.eq("bookingId", booking.bookingId))
        .collect(),
    );
    expect(rows.some((row) => row.status === "rejected")).toBe(true);
  });

  test("stale requests expire and closed bookings cannot be cancelled again", async () => {
    const t = convexTest(schema, modules);
    const { vehicle, otherDonor } = await approvedGuardian(t);
    const asRequester = t.withIdentity({ subject: otherDonor });
    const booking = await asRequester.mutation(api.ambulances.createBooking, {
      ambulanceId: vehicle.ambulanceId,
      pickupLabel: "Pickup point",
      pickupLat: 18.52,
      pickupLng: 73.85,
      destinationLabel: "Hospital",
      clientRequestId: "phase3-booking-0002",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(booking.bookingId, {
        requestedAt: Date.now() - 60 * 60 * 1000,
      });
    });
    await t.mutation(internal.ambulances.expireStaleBookings, {});
    const mine = await asRequester.query(api.ambulances.myBookings, {});
    expect(mine[0]?.status).toBe("expired");
    await expect(
      asRequester.mutation(api.ambulances.cancelBooking, {
        bookingId: booking.bookingId,
      }),
    ).rejects.toThrow(/already closed/i);
  });

  test("illegal status transitions are refused", async () => {
    const t = convexTest(schema, modules);
    const { asDonor, vehicle, otherDonor } = await approvedGuardian(t);
    const asRequester = t.withIdentity({ subject: otherDonor });
    const booking = await asRequester.mutation(api.ambulances.createBooking, {
      ambulanceId: vehicle.ambulanceId,
      pickupLabel: "Pickup point",
      pickupLat: 18.52,
      pickupLng: 73.85,
      destinationLabel: "Hospital",
      clientRequestId: "phase3-booking-0003",
    });
    await asDonor.mutation(api.ambulances.acceptBooking, { bookingId: booking.bookingId });
    await expect(
      asDonor.mutation(api.ambulances.updateBookingStatus, {
        bookingId: booking.bookingId,
        status: "completed",
      }),
    ).rejects.toThrow(/Cannot move booking/i);
  });
});
