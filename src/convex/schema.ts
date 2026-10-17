import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";
import {
  bloodGroupValidator,
  campStatusValidator,
  componentValidator,
  notificationKindValidator,
  orgStatusValidator,
  orgTypeValidator,
  requestStatusValidator,
  requestorTypeValidator,
  transactionTypeValidator,
  urgencyValidator,
  userRoleValidator,
} from "./validators";

// Application roles. The default auth role values are kept for compatibility
// but are never assigned by LifeLink's own registration mutations.
export const ROLES = {
  ADMIN: "admin",
  DONOR: "donor",
  REQUESTOR: "requestor",
  RED_CROSS: "red_cross",
  HOSPITAL: "hospital",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = userRoleValidator;
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // server-assigned application role
      organizationId: v.optional(v.id("organizations")),
      city: v.optional(v.string()),
      phone: v.optional(v.string()),
      profileCompleted: v.optional(v.boolean()),
      suspended: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
    })
      .index("email", ["email"])
      .index("by_role", ["role"])
      .index("by_organization", ["organizationId"]),

    donorProfiles: defineTable({
      userId: v.id("users"),
      donorId: v.string(),
      fullName: v.string(),
      bloodGroup: bloodGroupValidator,
      dateOfBirth: v.string(),
      gender: v.optional(v.string()),
      phone: v.string(),
      email: v.optional(v.string()),
      address: v.string(),
      city: v.string(),
      area: v.optional(v.string()),
      preferredCenter: v.optional(v.string()),
      lastDonationDate: v.optional(v.string()),
      available: v.boolean(),
      shareContact: v.boolean(),
      isDemo: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_donor_id", ["donorId"])
      .index("by_city_blood", ["city", "bloodGroup"])
      .index("by_availability", ["available"]),

    requestorProfiles: defineTable({
      userId: v.id("users"),
      requestorId: v.string(),
      fullName: v.string(),
      phone: v.string(),
      email: v.optional(v.string()),
      requestorType: requestorTypeValidator,
      city: v.string(),
      isDemo: v.optional(v.boolean()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_requestor_id", ["requestorId"]),

    organizations: defineTable({
      orgId: v.string(),
      type: orgTypeValidator,
      name: v.string(),
      contactPerson: v.string(),
      phone: v.string(),
      email: v.string(),
      address: v.string(),
      city: v.string(),
      area: v.optional(v.string()),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      status: orgStatusValidator,
      verifiedAt: v.optional(v.number()),
      verifiedBy: v.optional(v.string()),
      createdByUserId: v.optional(v.id("users")),
      isDemo: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_type", ["type"])
      .index("by_org_id", ["orgId"])
      .index("by_creator", ["createdByUserId"])
      .index("by_city", ["city"]),

    inventory: defineTable({
      organizationId: v.id("organizations"),
      bloodGroup: bloodGroupValidator,
      component: componentValidator,
      unitsAvailable: v.number(),
      unitsReserved: v.number(),
      collectionDate: v.string(),
      expiryDate: v.string(),
      storageLocation: v.string(),
      batchRef: v.string(),
      lowStockThreshold: v.number(),
      verified: v.boolean(),
      lastUpdated: v.number(),
      isDemo: v.optional(v.boolean()),
      createdAt: v.number(),
    })
      .index("by_organization", ["organizationId"])
      .index("by_group_component", ["bloodGroup", "component"])
      .index("by_expiry", ["expiryDate"]),

    inventoryTransactions: defineTable({
      inventoryId: v.id("inventory"),
      organizationId: v.id("organizations"),
      type: transactionTypeValidator,
      units: v.number(),
      bloodGroup: bloodGroupValidator,
      component: componentValidator,
      requestId: v.optional(v.id("bloodRequests")),
      actorUserId: v.optional(v.id("users")),
      actorRole: v.string(),
      note: v.optional(v.string()),
      isDemo: v.optional(v.boolean()),
      createdAt: v.number(),
    })
      .index("by_organization", ["organizationId"])
      .index("by_request", ["requestId"]),

    bloodRequests: defineTable({
      requestId: v.string(),
      source: v.union(v.literal("requestor"), v.literal("hospital")),
      createdByUserId: v.optional(v.id("users")),
      createdByOrgId: v.optional(v.id("organizations")),
      requestorName: v.string(),
      requestorType: requestorTypeValidator,
      requesterPhone: v.string(),
      requesterEmail: v.optional(v.string()),
      patientName: v.string(),
      patientRef: v.string(),
      patientAge: v.optional(v.number()),
      hospitalName: v.string(),
      hospitalOrgId: v.optional(v.id("organizations")),
      city: v.string(),
      area: v.optional(v.string()),
      bloodGroup: bloodGroupValidator,
      component: componentValidator,
      units: v.number(),
      requiredBy: v.number(),
      urgency: urgencyValidator,
      reason: v.string(),
      doctorName: v.optional(v.string()),
      doctorContact: v.optional(v.string()),
      documentId: v.optional(v.id("documentMetadata")),
      consent: v.boolean(),
      status: requestStatusValidator,
      assignedOrgId: v.optional(v.id("organizations")),
      verifiedById: v.optional(v.id("users")),
      verifiedAt: v.optional(v.number()),
      rejectionReason: v.optional(v.string()),
      isDemo: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_request_id", ["requestId"])
      .index("by_creator", ["createdByUserId"])
      .index("by_status", ["status"])
      .index("by_city", ["city"])
      .index("by_assigned_org", ["assignedOrgId"])
      .index("by_hospital_org", ["hospitalOrgId"]),

    requestStatusHistory: defineTable({
      requestId: v.id("bloodRequests"),
      status: requestStatusValidator,
      actorUserId: v.optional(v.id("users")),
      actorRole: v.string(),
      note: v.optional(v.string()),
      isDemo: v.optional(v.boolean()),
      createdAt: v.number(),
    }).index("by_request", ["requestId"]),

    donorOffers: defineTable({
      requestId: v.id("bloodRequests"),
      donorUserId: v.id("users"),
      donorProfileId: v.id("donorProfiles"),
      note: v.optional(v.string()),
      status: v.union(v.literal("offered"), v.literal("withdrawn"), v.literal("accepted")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_request", ["requestId"])
      .index("by_donor", ["donorUserId"]),

    donations: defineTable({
      donorProfileId: v.id("donorProfiles"),
      donorUserId: v.id("users"),
      organizationId: v.optional(v.id("organizations")),
      campId: v.optional(v.id("bloodCamps")),
      donationDate: v.string(),
      component: componentValidator,
      units: v.number(),
      recordedByUserId: v.id("users"),
      note: v.optional(v.string()),
      isDemo: v.optional(v.boolean()),
      createdAt: v.number(),
    })
      .index("by_donor_user", ["donorUserId"])
      .index("by_organization", ["organizationId"]),

    bloodCamps: defineTable({
      organizationId: v.id("organizations"),
      title: v.string(),
      description: v.string(),
      venue: v.string(),
      city: v.string(),
      date: v.string(),
      startTime: v.string(),
      endTime: v.string(),
      capacity: v.number(),
      organizer: v.string(),
      status: campStatusValidator,
      isDemo: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_organization", ["organizationId"])
      .index("by_date", ["date"])
      .index("by_status", ["status"]),

    campRegistrations: defineTable({
      campId: v.id("bloodCamps"),
      userId: v.id("users"),
      status: v.union(
        v.literal("registered"),
        v.literal("cancelled"),
        v.literal("donated"),
      ),
      isDemo: v.optional(v.boolean()),
      createdAt: v.number(),
    })
      .index("by_camp", ["campId"])
      .index("by_user", ["userId"]),

    documentMetadata: defineTable({
      storageId: v.id("_storage"),
      uploadedByUserId: v.id("users"),
      requestId: v.optional(v.id("bloodRequests")),
      fileName: v.string(),
      contentType: v.string(),
      size: v.number(),
      createdAt: v.number(),
    })
      .index("by_uploader", ["uploadedByUserId"])
      .index("by_request", ["requestId"]),

    notifications: defineTable({
      userId: v.id("users"),
      title: v.string(),
      body: v.string(),
      kind: notificationKindValidator,
      requestId: v.optional(v.id("bloodRequests")),
      link: v.optional(v.string()),
      read: v.boolean(),
      createdAt: v.number(),
    }).index("by_user", ["userId", "read"]),

    auditLogs: defineTable({
      actorUserId: v.optional(v.id("users")),
      actorRole: v.string(),
      action: v.string(),
      entityType: v.string(),
      entityId: v.string(),
      detail: v.string(),
      organizationId: v.optional(v.id("organizations")),
      isDemo: v.optional(v.boolean()),
      createdAt: v.number(),
    })
      .index("by_actor", ["actorUserId"])
      .index("by_organization", ["organizationId"]),

    contactMessages: defineTable({
      name: v.string(),
      email: v.string(),
      subject: v.string(),
      message: v.string(),
      createdAt: v.number(),
    }).index("by_email", ["email"]),

    counters: defineTable({
      key: v.string(),
      value: v.number(),
    }).index("by_key", ["key"]),

    rateLimits: defineTable({
      key: v.string(),
      count: v.number(),
      windowStartedAt: v.number(),
    }).index("by_key", ["key"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
