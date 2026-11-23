import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  audit,
  enforceRateLimit,
  getDonorProfile,
  normalizeEmail,
  notifyRole,
  notifyUser,
  requireDateString,
  requirePhone,
  requireRole,
  requireText,
  requireUser,
  rolesOf,
} from "./lib/helpers";
import { guardianApplicationStatusValidator } from "./validators";
import {
  GUARDIAN_DOCUMENT_LABELS,
  REQUIRED_DOCUMENTS_BY_TYPE,
  guardianComplianceIssues,
  isGuardianApproved,
  statusOf,
  type GuardianDocumentKind,
} from "../lib/guardian";
import { ageFromDob } from "../lib/blood";

const APPLICANT_ROLES = ["community", "donor", "requestor", "guardian"] as const;
const EDITABLE_STATUSES = ["DRAFT", "REJECTED", "RESUBMISSION_REQUIRED"] as const;

const driverValidator = v.object({
  fullName: v.string(),
  phone: v.string(),
  licenceNumber: v.string(),
  licenceCategory: v.string(),
  licenceIssueDate: v.optional(v.string()),
  licenceExpiryDate: v.string(),
  issuingAuthority: v.optional(v.string()),
  experienceYears: v.optional(v.number()),
  available: v.boolean(),
  licenceFrontDocumentId: v.optional(v.id("documentMetadata")),
  licenceBackDocumentId: v.optional(v.id("documentMetadata")),
  photoDocumentId: v.optional(v.id("documentMetadata")),
});

const serviceValidator = v.object({
  bls: v.boolean(),
  als: v.boolean(),
  oxygen: v.boolean(),
  stretcher: v.boolean(),
  wheelchairAccessible: v.boolean(),
  firstAid: v.boolean(),
  emergencyEquipment: v.string(),
  operatingArea: v.string(),
  operatingHours: v.string(),
  emergencyContact: v.string(),
  notes: v.optional(v.string()),
});

const payoutValidator = v.object({
  accountHolderName: v.string(),
  bankName: v.string(),
  accountNumberLast4: v.string(),
  ifsc: v.string(),
  verificationNote: v.optional(v.string()),
});

async function profileFor(ctx: Parameters<typeof getDonorProfile>[0], userId: Doc<"users">["_id"]) {
  return await ctx.db
    .query("guardianProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

async function assertDocumentOwner(
  ctx: Parameters<typeof getDonorProfile>[0],
  userId: Doc<"users">["_id"],
  documentId: Doc<"documentMetadata">["_id"] | undefined,
) {
  if (!documentId) return;
  const doc = await ctx.db.get(documentId);
  if (!doc || doc.uploadedByUserId !== userId) {
    throw new Error("One of the selected documents does not belong to your account.");
  }
}

function futureDate(value: string, label: string) {
  const date = requireDateString(value, label);
  if (date < new Date().toISOString().slice(0, 10)) {
    throw new Error(`${label} has already expired.`);
  }
  return date;
}

/** Current donor's Guardian onboarding state, vehicles, documents and blockers. */
export const myGuardianApplication = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, [...APPLICANT_ROLES]);
    const profile = await profileFor(ctx, user._id);
    if (!profile) return null;
    const vehicles = await ctx.db
      .query("ambulances")
      .withIndex("by_guardian", (q) => q.eq("guardianUserId", user._id))
      .collect();
    const documents = await ctx.db
      .query("documentMetadata")
      .withIndex("by_guardian", (q) => q.eq("guardianUserId", user._id))
      .collect();

    const vehicleSummaries = vehicles.map((vehicle) => ({
      id: vehicle._id,
      registrationNumber: vehicle.registrationNumber,
      model: vehicle.model,
      make: vehicle.make ?? null,
      manufacturingYear: vehicle.manufacturingYear ?? null,
      colour: vehicle.colour ?? null,
      type: vehicle.type,
      capacity: vehicle.capacity,
      insuranceExpiryDate: vehicle.insuranceExpiryDate ?? null,
      fitnessExpiryDate: vehicle.fitnessExpiryDate ?? null,
      pucExpiryDate: vehicle.pucExpiryDate ?? null,
      permitExpiryDate: vehicle.permitExpiryDate ?? null,
      ambulanceAuthorizationExpiryDate: vehicle.ambulanceAuthorizationExpiryDate ?? null,
      requiredDocuments: REQUIRED_DOCUMENTS_BY_TYPE[vehicle.type] ?? [],
    }));

    const documentSummaries = documents.map((doc) => ({
      id: doc._id,
      kind: doc.documentKind ?? null,
      kindLabel: doc.documentKind
        ? GUARDIAN_DOCUMENT_LABELS[doc.documentKind as GuardianDocumentKind] ?? doc.documentKind
        : null,
      fileName: doc.fileName,
      ambulanceId: doc.ambulanceId ?? null,
      expiryDate: doc.expiryDate ?? null,
      status: doc.status ?? "pending",
      reviewNote: doc.reviewNote ?? null,
      createdAt: doc.createdAt,
    }));

    const issues = guardianComplianceIssues({
      profile,
      vehicles: vehicleSummaries.map((vehicle) => ({
        id: vehicle.id,
        type: vehicle.type,
        insuranceExpiryDate: vehicle.insuranceExpiryDate,
        fitnessExpiryDate: vehicle.fitnessExpiryDate,
        pucExpiryDate: vehicle.pucExpiryDate,
        permitExpiryDate: vehicle.permitExpiryDate,
        ambulanceAuthorizationExpiryDate: vehicle.ambulanceAuthorizationExpiryDate,
      })),
      documents: documentSummaries.map((doc) => ({
        documentKind: doc.kind,
        expiryDate: doc.expiryDate,
        status: doc.status,
        ambulanceId: doc.ambulanceId,
      })),
    });

    const events = await ctx.db
      .query("guardianReviewEvents")
      .withIndex("by_guardian", (q) => q.eq("guardianUserId", user._id))
      .collect();

    return {
      profile: {
        userId: profile.userId,
        companyName: profile.companyName,
        contactPerson: profile.contactPerson,
        phone: profile.phone,
        email: profile.email ?? null,
        city: profile.city,
        address: profile.address,
        online: profile.online,
        status: statusOf(profile),
        documentsStatus: profile.documentsStatus,
        dateOfBirth: profile.dateOfBirth ?? null,
        preferredLanguage: profile.preferredLanguage ?? null,
        residentialAddress: profile.residentialAddress ?? null,
        emergencyContactName: profile.emergencyContactName ?? null,
        emergencyContactPhone: profile.emergencyContactPhone ?? null,
        profilePhotoDocumentId: profile.profilePhotoDocumentId ?? null,
        identityType: profile.identityType ?? null,
        identityLast4: profile.identityLast4 ?? null,
        driver: profile.driver ?? null,
        service: profile.service ?? null,
        payout: profile.payout ?? null,
        linkedDonorId: profile.linkedDonorId ?? null,
        submittedAt: profile.submittedAt ?? null,
        reviewedAt: profile.reviewedAt ?? null,
        reviewNote: profile.reviewNote ?? null,
      },
      vehicles: vehicleSummaries,
      documents: documentSummaries,
      issues,
      approved: isGuardianApproved(profile),
      history: events
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((event) => ({
          id: event._id,
          previousStatus: event.previousStatus ?? null,
          newStatus: event.newStatus,
          reason: event.reason,
          createdAt: event.createdAt,
        })),
    };
  },
});

/** Save a draft section. Submitted/approved applications are locked. */
export const saveApplication = mutation({
  args: {
    companyName: v.optional(v.string()),
    contactPerson: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    city: v.optional(v.string()),
    address: v.optional(v.string()),
    dateOfBirth: v.optional(v.string()),
    preferredLanguage: v.optional(v.string()),
    residentialAddress: v.optional(v.string()),
    emergencyContactName: v.optional(v.string()),
    emergencyContactPhone: v.optional(v.string()),
    identityType: v.optional(v.string()),
    identityLast4: v.optional(v.string()),
    profilePhotoDocumentId: v.optional(v.id("documentMetadata")),
    driver: v.optional(driverValidator),
    service: v.optional(serviceValidator),
    payout: v.optional(payoutValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [...APPLICANT_ROLES]);
    const profile = await profileFor(ctx, user._id);
    if (!profile) {
      throw new Error("Start Guardian registration first, then complete your application.");
    }
    const status = statusOf(profile);
    if (!EDITABLE_STATUSES.includes(status as (typeof EDITABLE_STATUSES)[number])) {
      throw new Error(
        status === "APPROVED"
          ? "Your Guardian application is approved. Contact an administrator to change verified details."
          : "Your application is with an administrator. You cannot edit it until it is returned for resubmission.",
      );
    }
    await assertDocumentOwner(ctx, user._id, args.profilePhotoDocumentId);
    if (args.driver) {
      await assertDocumentOwner(ctx, user._id, args.driver.licenceFrontDocumentId);
      await assertDocumentOwner(ctx, user._id, args.driver.licenceBackDocumentId);
      await assertDocumentOwner(ctx, user._id, args.driver.photoDocumentId);
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.companyName !== undefined) {
      patch.companyName = requireText(args.companyName, "Ambulance service name", 2, 120);
    }
    if (args.contactPerson !== undefined) {
      patch.contactPerson = requireText(args.contactPerson, "Contact person", 2, 120);
    }
    if (args.phone !== undefined) patch.phone = requirePhone(args.phone);
    if (args.email !== undefined) patch.email = normalizeEmail(args.email);
    if (args.city !== undefined) patch.city = requireText(args.city, "City", 2, 80);
    if (args.address !== undefined) patch.address = requireText(args.address, "Address", 5, 300);
    if (args.dateOfBirth !== undefined) {
      const dob = requireDateString(args.dateOfBirth, "Date of birth");
      const age = ageFromDob(dob);
      if (age == null || age < 18) throw new Error("Guardian account holders must be 18 or older.");
      patch.dateOfBirth = dob;
    }
    if (args.preferredLanguage !== undefined) {
      patch.preferredLanguage = requireText(args.preferredLanguage, "Preferred language", 2, 60);
    }
    if (args.residentialAddress !== undefined) {
      patch.residentialAddress = requireText(args.residentialAddress, "Residential address", 5, 300);
    }
    if (args.emergencyContactName !== undefined) {
      patch.emergencyContactName = requireText(args.emergencyContactName, "Emergency contact name", 2, 120);
    }
    if (args.emergencyContactPhone !== undefined) {
      patch.emergencyContactPhone = requirePhone(args.emergencyContactPhone);
    }
    if (args.identityType !== undefined) {
      patch.identityType = requireText(args.identityType, "Identification type", 2, 60);
    }
    if (args.identityLast4 !== undefined) {
      if (!/^[A-Za-z0-9]{4}$/.test(args.identityLast4)) {
        throw new Error("Store only the last four characters of the identification number.");
      }
      patch.identityLast4 = args.identityLast4.toUpperCase();
    }
    if (args.profilePhotoDocumentId !== undefined) {
      patch.profilePhotoDocumentId = args.profilePhotoDocumentId;
    }
    if (args.driver !== undefined) {
      const licenceNumber = requireText(args.driver.licenceNumber, "Driving licence number", 4, 40);
      const category = requireText(args.driver.licenceCategory, "Licence category", 2, 40);
      if (!/[A-Za-z]/.test(category)) {
        throw new Error("Enter the licence categories (for example LMV, TRANS).");
      }
      const expiry = futureDate(args.driver.licenceExpiryDate, "Driving licence expiry");
      const issue = args.driver.licenceIssueDate
        ? requireDateString(args.driver.licenceIssueDate, "Licence issue date")
        : undefined;
      if (issue && issue > expiry) throw new Error("Licence issue date cannot be after expiry.");
      patch.driver = {
        fullName: requireText(args.driver.fullName, "Driver name", 2, 120),
        phone: requirePhone(args.driver.phone),
        licenceNumber: licenceNumber.toUpperCase(),
        licenceCategory: category.toUpperCase(),
        licenceIssueDate: issue,
        licenceExpiryDate: expiry,
        issuingAuthority: args.driver.issuingAuthority
          ? requireText(args.driver.issuingAuthority, "Issuing authority", 2, 120)
          : undefined,
        experienceYears:
          args.driver.experienceYears != null
            ? Math.max(0, Math.min(60, Math.round(args.driver.experienceYears)))
            : undefined,
        available: args.driver.available,
        licenceFrontDocumentId: args.driver.licenceFrontDocumentId,
        licenceBackDocumentId: args.driver.licenceBackDocumentId,
        photoDocumentId: args.driver.photoDocumentId,
      };
    }
    if (args.service !== undefined) {
      patch.service = {
        bls: args.service.bls,
        als: args.service.als,
        oxygen: args.service.oxygen,
        stretcher: args.service.stretcher,
        wheelchairAccessible: args.service.wheelchairAccessible,
        firstAid: args.service.firstAid,
        emergencyEquipment: requireText(
          args.service.emergencyEquipment,
          "Emergency equipment",
          2,
          300,
        ),
        operatingArea: requireText(args.service.operatingArea, "Operating area", 2, 120),
        operatingHours: requireText(args.service.operatingHours, "Operating hours", 2, 120),
        emergencyContact: requirePhone(args.service.emergencyContact),
        notes: args.service.notes?.trim().slice(0, 300),
      };
    }
    if (args.payout !== undefined) {
      const last4 = args.payout.accountNumberLast4.trim();
      if (!/^\d{4}$/.test(last4)) {
        throw new Error("Enter only the last four digits of the bank account.");
      }
      const ifsc = args.payout.ifsc.trim().toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new Error("Enter a valid IFSC code.");
      patch.payout = {
        accountHolderName: requireText(
          args.payout.accountHolderName,
          "Account holder name",
          2,
          120,
        ),
        bankName: requireText(args.payout.bankName, "Bank name", 2, 120),
        accountNumberLast4: last4,
        ifsc,
        verificationNote: args.payout.verificationNote?.trim().slice(0, 200),
      };
    }

    await ctx.db.patch(profile._id, patch);
    await audit(ctx, {
      actor: user,
      action: "guardian.application_saved",
      entityType: "guardianProfile",
      entityId: String(profile._id),
      detail: "Guardian onboarding draft saved.",
    });
    return { ok: true };
  },
});

/** Submit the complete application for administrator review. */
export const submitApplication = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, [...APPLICANT_ROLES]);
    const profile = await profileFor(ctx, user._id);
    if (!profile) throw new Error("Complete the Guardian registration first.");
    const status = statusOf(profile);
    if (!EDITABLE_STATUSES.includes(status as (typeof EDITABLE_STATUSES)[number])) {
      throw new Error("This application has already been submitted.");
    }
    await enforceRateLimit(ctx, `guardian-submit:${user._id}`, 5);

    const missing: string[] = [];
    for (const [field, label] of [
      ["companyName", "Ambulance service name"],
      ["contactPerson", "Contact person"],
      ["phone", "Phone"],
      ["email", "Email"],
      ["dateOfBirth", "Date of birth"],
      ["residentialAddress", "Residential address"],
      ["emergencyContactName", "Emergency contact name"],
      ["emergencyContactPhone", "Emergency contact phone"],
      ["driver", "Driver details"],
      ["service", "Service and equipment details"],
      ["payout", "Payout details"],
    ] as const) {
      if (!profile[field]) missing.push(label);
    }
    if (missing.length > 0) {
      throw new Error(`Complete these sections before submitting: ${missing.join(", ")}.`);
    }
    if (profile.driver && profile.driver.licenceExpiryDate < new Date().toISOString().slice(0, 10)) {
      throw new Error("The driving licence has expired.");
    }

    const vehicles = await ctx.db
      .query("ambulances")
      .withIndex("by_guardian", (q) => q.eq("guardianUserId", user._id))
      .collect();
    if (vehicles.length === 0) {
      throw new Error("Register at least one ambulance vehicle before submitting.");
    }
    const documents = await ctx.db
      .query("documentMetadata")
      .withIndex("by_guardian", (q) => q.eq("guardianUserId", user._id))
      .collect();
    const today = new Date().toISOString().slice(0, 10);

    for (const vehicle of vehicles) {
      const required = REQUIRED_DOCUMENTS_BY_TYPE[vehicle.type] ?? REQUIRED_DOCUMENTS_BY_TYPE.bls;
      for (const kind of required) {
        const present = documents.some(
          (doc) =>
            doc.documentKind === kind &&
            doc.status !== "rejected" &&
            (doc.ambulanceId == null || doc.ambulanceId === vehicle._id),
        );
        if (!present) {
          throw new Error(
            `${GUARDIAN_DOCUMENT_LABELS[kind]} is required for ${vehicle.registrationNumber}.`,
          );
        }
      }
      if (vehicle.insuranceExpiryDate && vehicle.insuranceExpiryDate < today) {
        throw new Error(`Insurance for ${vehicle.registrationNumber} has expired.`);
      }
      if (vehicle.fitnessExpiryDate && vehicle.fitnessExpiryDate < today) {
        throw new Error(`Fitness certificate for ${vehicle.registrationNumber} has expired.`);
      }
      if (vehicle.pucExpiryDate && vehicle.pucExpiryDate < today) {
        throw new Error(`PUC certificate for ${vehicle.registrationNumber} has expired.`);
      }
    }

    const now = Date.now();
    await ctx.db.patch(profile._id, {
      status: "SUBMITTED",
      documentsStatus: "pending",
      online: false,
      submittedAt: now,
      reviewNote: undefined,
      updatedAt: now,
    });
    await ctx.db.insert("guardianReviewEvents", {
      guardianProfileId: profile._id,
      guardianUserId: user._id,
      adminUserId: user._id,
      previousStatus: status,
      newStatus: "SUBMITTED",
      reason: "Application submitted by the Guardian.",
      createdAt: now,
    });
    await audit(ctx, {
      actor: user,
      action: "guardian.application_submitted",
      entityType: "guardianProfile",
      entityId: String(profile._id),
      detail: `Guardian application submitted with ${vehicles.length} vehicle(s).`,
    });
    await notifyRole(ctx, "admin", {
      title: "Guardian application submitted",
      body: `${profile.companyName} submitted an ambulance partner application for review.`,
      kind: "ambulance",
      link: "/admin/dashboard",
    });
    return { ok: true };
  },
});

/** Administrator decision. Every transition is recorded immutably. */
export const reviewApplication = mutation({
  args: {
    guardianUserId: v.id("users"),
    status: guardianApplicationStatusValidator,
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    const profile = await profileFor(ctx, args.guardianUserId);
    if (!profile) throw new Error("Guardian profile not found.");
    const previous = statusOf(profile);

    const transitions: Record<string, string[]> = {
      SUBMITTED: ["UNDER_REVIEW", "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"],
      UNDER_REVIEW: ["APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"],
      RESUBMISSION_REQUIRED: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
      APPROVED: ["SUSPENDED", "EXPIRED"],
      SUSPENDED: ["APPROVED", "REJECTED"],
      EXPIRED: ["APPROVED", "SUSPENDED"],
      DRAFT: ["REJECTED"],
      REJECTED: ["UNDER_REVIEW"],
    };
    if (!(transitions[previous] ?? []).includes(args.status)) {
      throw new Error(`Cannot move a Guardian application from ${previous} to ${args.status}.`);
    }
    const reason = args.reason?.trim().slice(0, 300);
    if (["REJECTED", "RESUBMISSION_REQUIRED", "SUSPENDED", "EXPIRED"].includes(args.status)) {
      if (!reason || reason.length < 5) {
        throw new Error("A reason is required for this decision.");
      }
    }

    const now = Date.now();
    const online = args.status === "APPROVED" ? profile.online : false;
    await ctx.db.patch(profile._id, {
      status: args.status,
      documentsStatus:
        args.status === "APPROVED"
          ? "verified"
          : args.status === "REJECTED"
            ? "rejected"
            : "pending",
      online,
      reviewedAt: now,
      reviewedByUserId: admin._id,
      reviewNote: reason,
      updatedAt: now,
    });

    if (args.status !== "APPROVED") {
      const vehicles = await ctx.db
        .query("ambulances")
        .withIndex("by_guardian", (q) => q.eq("guardianUserId", args.guardianUserId))
        .collect();
      for (const vehicle of vehicles) {
        if (vehicle.available) {
          await ctx.db.patch(vehicle._id, { available: false, updatedAt: now });
        }
      }
    }

    await ctx.db.insert("guardianReviewEvents", {
      guardianProfileId: profile._id,
      guardianUserId: args.guardianUserId,
      adminUserId: admin._id,
      previousStatus: previous,
      newStatus: args.status,
      reason: reason ?? `Application marked ${args.status}.`,
      createdAt: now,
    });
    await audit(ctx, {
      actor: admin,
      action: `guardian.application_${args.status.toLowerCase()}`,
      entityType: "guardianProfile",
      entityId: String(profile._id),
      detail: `Guardian ${profile.companyName}: ${previous} → ${args.status}. ${reason ?? ""}`.trim(),
    });
    await notifyUser(ctx, args.guardianUserId, {
      title: "Guardian application update",
      body: `Your application is now ${args.status.replace(/_/g, " ").toLowerCase()}.${
        reason ? ` ${reason}` : ""
      }`,
      kind: "ambulance",
      link: "/guardian/dashboard",
    });
    return { ok: true, previous, status: args.status };
  },
});

/** Admin review list with vehicles and submitted documents. */
export const listApplications = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const profiles = await ctx.db.query("guardianProfiles").collect();
    const users = await ctx.db.query("users").collect();
    const vehicles = await ctx.db.query("ambulances").collect();
    const documents = await ctx.db.query("documentMetadata").collect();
    const userById = new Map(users.map((user) => [String(user._id), user]));

    return profiles
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((profile) => {
        const user = userById.get(String(profile.userId));
        const ownVehicles = vehicles.filter(
          (vehicle) => vehicle.guardianUserId === profile.userId,
        );
        const docs = documents
          .filter((doc) => doc.guardianUserId === profile.userId)
          .sort((a, b) => b.createdAt - a.createdAt);
        return {
          userId: profile.userId,
          companyName: profile.companyName,
          contactPerson: profile.contactPerson,
          phone: profile.phone,
          email: profile.email ?? user?.email ?? null,
          city: profile.city,
          address: profile.address,
          online: profile.online,
          status: statusOf(profile),
          documentsStatus: profile.documentsStatus,
          driver: profile.driver ?? null,
          service: profile.service ?? null,
          payout: profile.payout ?? null,
          submittedAt: profile.submittedAt ?? null,
          reviewedAt: profile.reviewedAt ?? null,
          reviewNote: profile.reviewNote ?? null,
          linkedDonorId: profile.linkedDonorId ?? null,
          accountName: user?.name ?? null,
          createdAt: profile.createdAt,
          vehicles: ownVehicles.map((vehicle) => ({
            id: vehicle._id,
            registrationNumber: vehicle.registrationNumber,
            model: vehicle.model,
            make: vehicle.make ?? null,
            manufacturingYear: vehicle.manufacturingYear ?? null,
            colour: vehicle.colour ?? null,
            type: vehicle.type,
            capacity: vehicle.capacity,
            insuranceExpiryDate: vehicle.insuranceExpiryDate ?? null,
            fitnessExpiryDate: vehicle.fitnessExpiryDate ?? null,
            pucExpiryDate: vehicle.pucExpiryDate ?? null,
            permitExpiryDate: vehicle.permitExpiryDate ?? null,
            ambulanceAuthorizationExpiryDate: vehicle.ambulanceAuthorizationExpiryDate ?? null,
          })),
          documents: docs.map((doc) => ({
            id: doc._id,
            kind: doc.documentKind ?? null,
            kindLabel: doc.documentKind
              ? GUARDIAN_DOCUMENT_LABELS[doc.documentKind as GuardianDocumentKind] ??
                doc.documentKind
              : doc.fileName,
            fileName: doc.fileName,
            expiryDate: doc.expiryDate ?? null,
            status: doc.status ?? "pending",
            reviewNote: doc.reviewNote ?? null,
            ambulanceId: doc.ambulanceId ?? null,
          })),
        };
      });
  },
});

/**
 * One account, two roles: link a Guardian application to the signed-in donor.
 * The donor ID is validated server-side against the authenticated user; an
 * invalid ID or an ID owned by somebody else produces the same generic error.
 */
export const registerExistingDonor = mutation({
  args: { donorId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await enforceRateLimit(ctx, `guardian-link:${user._id}`, 10);
    const existing = await profileFor(ctx, user._id);
    if (existing) throw new Error("A Guardian profile already exists for this account.");
    if (["admin", "red_cross", "hospital", "drone_ops"].includes(user.role ?? "user")) {
      throw new Error("Staff accounts cannot register as ambulance Guardians.");
    }
    const donorId = args.donorId.trim().toUpperCase();
    if (!/^LL-D-\d{4,}$/.test(donorId)) {
      throw new Error("Enter your LifeLink Donor ID (for example LL-D-0001).");
    }
    const donor = await ctx.db
      .query("donorProfiles")
      .withIndex("by_donor_id", (q) => q.eq("donorId", donorId))
      .unique();
    // Never reveal whether the ID exists but belongs to someone else.
    if (!donor || donor.userId !== user._id) {
      throw new Error("That Donor ID could not be matched to your signed-in account.");
    }

    const now = Date.now();
    const profileId = await ctx.db.insert("guardianProfiles", {
      userId: user._id,
      companyName: `${donor.fullName} Ambulance Service`,
      contactPerson: donor.fullName,
      phone: donor.phone,
      email: user.email,
      city: donor.city,
      address: donor.address,
      online: false,
      documentsStatus: "pending",
      status: "DRAFT",
      linkedDonorId: donor.donorId,
      createdAt: now,
      updatedAt: now,
    });
    const roles = rolesOf(user);
    if (!roles.includes("guardian")) roles.push("guardian");
    await ctx.db.patch(user._id, {
      roles,
      // Keep the donor workspace primary; the Guardian dashboard is reachable
      // from the same account without a second login.
      role: user.role === "user" || user.role === "member" || !user.role ? "guardian" : user.role,
      profileCompleted: true,
    });
    await audit(ctx, {
      actor: user,
      action: "guardian.linked_to_donor",
      entityType: "guardianProfile",
      entityId: String(profileId),
      detail: `Guardian onboarding linked to existing donor ${donor.donorId}. Same account, no duplicate user.`,
    });
    return { profileId, roles };
  },
});
