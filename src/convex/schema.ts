import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";
import {
  anomalyKindValidator,
  bloodGroupValidator,
  campStatusValidator,
  componentValidator,
  donorInvitationStatusValidator,
  droneStatusValidator,
  flightControllerValidator,
  integrationKindValidator,
  integrationStatusValidator,
  linkStatusValidator,
  maintenanceStatusValidator,
  missionEventValidator,
  missionStateValidator,
  notificationChannelValidator,
  notificationJobStatusValidator,
  notificationKindValidator,
  orgStatusValidator,
  orgTypeValidator,
  preflightCheckValidator,
  requestStatusValidator,
  requestorTypeValidator,
  syncModeValidator,
  transactionTypeValidator,
  transferStatusValidator,
  urgencyValidator,
  userRoleValidator,
  waypointValidator,
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
      // Institutional transfer policy. Auto-allocation only happens between
      // facilities that explicitly opted in to a pre-authorised agreement.
      transferAuthorized: v.optional(v.boolean()),
      autoAllocate: v.optional(v.boolean()),
      searchRadiusKm: v.optional(v.number()),
      protectedReserveDefault: v.optional(v.number()),
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
      // Released-for-transfusion flags are optional so existing batches keep
      // working; missing is treated as "not yet confirmed" by the allocation
      // engine, which blocks the unit until staff release it.
      screened: v.optional(v.boolean()),
      released: v.optional(v.boolean()),
      /** Units held back for this facility's own emergency cases. */
      protectedReserve: v.optional(v.number()),
      storageTempC: v.optional(v.number()),
      integrationId: v.optional(v.id("facilityIntegrations")),
      externalUnitRef: v.optional(v.string()),
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

    // Per-request allocation of reserved units. Reservations are tracked against
    // the exact inventory batch so dispatch consumes the units that were held
    // for this request rather than unrelated free stock.
    inventoryReservations: defineTable({
      inventoryId: v.id("inventory"),
      organizationId: v.id("organizations"),
      requestId: v.id("bloodRequests"),
      units: v.number(),
      status: v.union(
        v.literal("active"),
        v.literal("consumed"),
        v.literal("released"),
      ),
      actorUserId: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_request", ["requestId"])
      .index("by_inventory", ["inventoryId"])
      .index("by_status", ["status"]),

    // Automatic low-stock escalation. When an organization's unreserved stock
    // for a group/component falls to its threshold, the record below captures
    // the alert and every recipient the network request was pushed to.
    stockAlerts: defineTable({
      organizationId: v.id("organizations"),
      organizationType: orgTypeValidator,
      city: v.string(),
      bloodGroup: bloodGroupValidator,
      component: componentValidator,
      freeUnits: v.number(),
      threshold: v.number(),
      requestedUnits: v.number(),
      level: v.union(v.literal("low"), v.literal("critical"), v.literal("out")),
      // "deadline" marks a shortfall caused by units passing their storage
      // deadline, which is raised by the daily sweep without any staff action.
      reason: v.optional(v.union(v.literal("low_stock"), v.literal("deadline"))),
      status: v.union(v.literal("open"), v.literal("resolved")),
      hospitalOrgIds: v.array(v.id("organizations")),
      redCrossOrgIds: v.array(v.id("organizations")),
      // Organizations that pressed "Offer help" on this request. Members see
      // the requesting organization's contact details from that point on.
      helpOrgIds: v.optional(v.array(v.id("organizations"))),
      donorsNotified: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
      resolvedAt: v.optional(v.number()),
    })
      .index("by_organization", ["organizationId"])
      .index("by_status", ["status"]),

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
      /** Stops duplicate in-app rows for retried/idempotent operations. */
      dedupeKey: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId", "read"])
      .index("by_dedupe", ["dedupeKey"]),

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

    /* ---------------------------------------------------------------- *
     * Facility integration layer
     * ---------------------------------------------------------------- */
    facilityIntegrations: defineTable({
      organizationId: v.id("organizations"),
      kind: integrationKindValidator,
      label: v.string(),
      baseUrl: v.optional(v.string()),
      authScheme: v.union(
        v.literal("api_key"),
        v.literal("bearer"),
        v.literal("basic"),
        v.literal("none"),
      ),
      /** Env var name only. Secrets are never stored in the database. */
      credentialEnvVar: v.optional(v.string()),
      syncMode: syncModeValidator,
      status: integrationStatusValidator,
      /** Explicitly labels adapters that return sample data. */
      isMock: v.boolean(),
      lastSyncAt: v.optional(v.number()),
      lastSyncStatus: v.optional(
        v.union(
          v.literal("never"),
          v.literal("success"),
          v.literal("partial"),
          v.literal("failed"),
          v.literal("unconfigured"),
        ),
      ),
      lastError: v.optional(v.string()),
      recordsLastSync: v.optional(v.number()),
      configNote: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_organization", ["organizationId"])
      .index("by_status", ["status"]),

    facilitySyncRuns: defineTable({
      integrationId: v.id("facilityIntegrations"),
      organizationId: v.id("organizations"),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
      status: v.union(
        v.literal("running"),
        v.literal("success"),
        v.literal("partial"),
        v.literal("failed"),
      ),
      source: v.union(v.literal("mock"), v.literal("live")),
      recordsRead: v.number(),
      recordsApplied: v.number(),
      error: v.optional(v.string()),
      isMock: v.boolean(),
      actorUserId: v.optional(v.id("users")),
    })
      .index("by_organization", ["organizationId"])
      .index("by_integration", ["integrationId"]),

    transferAgreements: defineTable({
      requestingOrgId: v.id("organizations"),
      supplyingOrgId: v.id("organizations"),
      status: v.union(v.literal("active"), v.literal("suspended")),
      autoAllocate: v.boolean(),
      maxUnitsPerRequest: v.number(),
      note: v.optional(v.string()),
      createdByUserId: v.optional(v.id("users")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_requesting", ["requestingOrgId"])
      .index("by_supplying", ["supplyingOrgId"]),

    transfers: defineTable({
      transferId: v.string(),
      requestId: v.optional(v.id("bloodRequests")),
      requestingOrgId: v.id("organizations"),
      supplyingOrgId: v.id("organizations"),
      bloodGroup: bloodGroupValidator,
      component: componentValidator,
      units: v.number(),
      status: transferStatusValidator,
      reservationIds: v.array(v.id("inventoryReservations")),
      agreementId: v.optional(v.id("transferAgreements")),
      droneMissionId: v.optional(v.id("droneMissions")),
      auto: v.boolean(),
      initiatedByUserId: v.optional(v.id("users")),
      note: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      dispatchedAt: v.optional(v.number()),
      receivedAt: v.optional(v.number()),
    })
      .index("by_requesting", ["requestingOrgId"])
      .index("by_supplying", ["supplyingOrgId"])
      .index("by_request", ["requestId"])
      .index("by_status", ["status"]),

    /* ---------------------------------------------------------------- *
     * Drone logistics
     * ---------------------------------------------------------------- */
    droneBases: defineTable({
      organizationId: v.id("organizations"),
      name: v.string(),
      city: v.string(),
      latitude: v.number(),
      longitude: v.number(),
      status: v.union(v.literal("active"), v.literal("inactive")),
      createdAt: v.number(),
    })
      .index("by_organization", ["organizationId"])
      .index("by_status", ["status"]),

    drones: defineTable({
      droneId: v.string(),
      baseId: v.id("droneBases"),
      organizationId: v.id("organizations"),
      model: v.string(),
      manufacturer: v.string(),
      maxPayloadKg: v.number(),
      batteryCapacityWh: v.number(),
      maxRangeKm: v.number(),
      cruiseSpeedKmh: v.number(),
      batteryPct: v.number(),
      status: droneStatusValidator,
      flightController: flightControllerValidator,
      linkStatus: linkStatusValidator,
      gpsAvailable: v.boolean(),
      maintenanceStatus: maintenanceStatusValidator,
      containerReady: v.boolean(),
      containerTempC: v.number(),
      currentLat: v.number(),
      currentLng: v.number(),
      lastSeenAt: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_base", ["baseId"])
      .index("by_organization", ["organizationId"])
      .index("by_status", ["status"])
      .index("by_drone_id", ["droneId"]),

    droneMissions: defineTable({
      missionId: v.string(),
      transferId: v.optional(v.id("transfers")),
      droneId: v.id("drones"),
      pickupOrgId: v.id("organizations"),
      dropoffOrgId: v.id("organizations"),
      bloodGroup: bloodGroupValidator,
      component: componentValidator,
      units: v.number(),
      payloadKg: v.number(),
      state: missionStateValidator,
      /** Always true in this deployment: no real aircraft is commanded. */
      simulated: v.boolean(),
      route: v.array(waypointValidator),
      outboundKm: v.number(),
      returnKm: v.number(),
      totalKm: v.number(),
      preflight: v.array(preflightCheckValidator),
      preflightPassed: v.boolean(),
      weather: v.object({
        windKmh: v.number(),
        precipitationPct: v.number(),
        visibilityKm: v.number(),
        temperatureC: v.number(),
        source: v.union(
          v.literal("simulated"),
          v.literal("manual"),
          v.literal("provider"),
        ),
        observedAt: v.number(),
      }),
      airspace: v.object({
        routeAuthorized: v.boolean(),
        authorizationRef: v.optional(v.string()),
        simulated: v.boolean(),
        zoneIds: v.array(v.string()),
      }),
      containerTempC: v.number(),
      batteryAtDispatch: v.optional(v.number()),
      estimatedDurationMin: v.number(),
      telemetry: v.optional(
        v.object({
          lat: v.number(),
          lng: v.number(),
          altitudeM: v.number(),
          speedKmh: v.number(),
          batteryPct: v.number(),
          tempC: v.number(),
          linkStatus: linkStatusValidator,
          seq: v.number(),
          updatedAt: v.number(),
          simulated: v.boolean(),
        }),
      ),
      stateHistory: v.array(missionEventValidator),
      failure: v.optional(
        v.object({
          kind: v.string(),
          at: v.number(),
          detail: v.string(),
        }),
      ),
      /** Handoff code the receiver must present; never shown to the sender. */
      deliveryCode: v.optional(v.string()),
      deliveryEvidence: v.optional(
        v.object({
          code: v.string(),
          method: v.union(
            v.literal("handoff_code"),
            v.literal("supervisor_override"),
          ),
          confirmedByUserId: v.id("users"),
          confirmedAt: v.number(),
          note: v.optional(v.string()),
        }),
      ),
      createdByUserId: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
      dispatchedAt: v.optional(v.number()),
      deliveredAt: v.optional(v.number()),
      completedAt: v.optional(v.number()),
      note: v.optional(v.string()),
    })
      .index("by_drone", ["droneId"])
      .index("by_state", ["state"])
      .index("by_transfer", ["transferId"])
      .index("by_pickup", ["pickupOrgId"])
      .index("by_dropoff", ["dropoffOrgId"]),

    missionEvents: defineTable({
      missionId: v.id("droneMissions"),
      fromState: v.optional(missionStateValidator),
      toState: missionStateValidator,
      at: v.number(),
      actorUserId: v.optional(v.id("users")),
      note: v.optional(v.string()),
      isSimulated: v.boolean(),
    }).index("by_mission", ["missionId"]),

    airspaceZones: defineTable({
      name: v.string(),
      kind: v.union(v.literal("restricted"), v.literal("corridor")),
      centerLat: v.number(),
      centerLng: v.number(),
      radiusKm: v.number(),
      source: v.union(v.literal("simulated"), v.literal("published")),
      active: v.boolean(),
      note: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_kind", ["kind"]),

    /* ---------------------------------------------------------------- *
     * Donor fallback and consent
     * ---------------------------------------------------------------- */
    donorConsents: defineTable({
      donorUserId: v.id("users"),
      donorProfileId: v.id("donorProfiles"),
      shareLocation: v.boolean(),
      grantedAt: v.number(),
      expiresAt: v.number(),
      revokedAt: v.optional(v.number()),
      updatedAt: v.number(),
    })
      .index("by_donor", ["donorUserId"])
      .index("by_profile", ["donorProfileId"]),

    donorInvitations: defineTable({
      requestId: v.optional(v.id("bloodRequests")),
      stockAlertId: v.optional(v.id("stockAlerts")),
      requestingOrgId: v.id("organizations"),
      donorUserId: v.id("users"),
      donorProfileId: v.id("donorProfiles"),
      bloodGroup: bloodGroupValidator,
      component: componentValidator,
      units: v.number(),
      distanceKm: v.optional(v.number()),
      responseProbability: v.optional(v.number()),
      status: donorInvitationStatusValidator,
      note: v.optional(v.string()),
      idempotencyKey: v.string(),
      createdAt: v.number(),
      respondedAt: v.optional(v.number()),
      appointmentAt: v.optional(v.number()),
      donationCenterOrgId: v.optional(v.id("organizations")),
    })
      .index("by_donor", ["donorUserId"])
      .index("by_request", ["requestId"])
      .index("by_status", ["status"])
      .index("by_idempotency", ["idempotencyKey"]),

    /* ---------------------------------------------------------------- *
     * Prediction, anomaly and notification delivery records
     * ---------------------------------------------------------------- */
    demandForecasts: defineTable({
      organizationId: v.optional(v.id("organizations")),
      scope: v.union(v.literal("hospital"), v.literal("network")),
      bloodGroup: bloodGroupValidator,
      component: componentValidator,
      runAt: v.number(),
      model: v.string(),
      status: v.union(v.literal("ok"), v.literal("insufficient_data")),
      sampleSize: v.number(),
      metrics: v.optional(
        v.object({
          mae: v.number(),
          rmse: v.number(),
          baselineMae: v.number(),
          baselineRmse: v.number(),
          trainSize: v.number(),
          holdoutSize: v.number(),
          meanActual: v.number(),
        }),
      ),
      confidence: v.optional(v.number()),
      confidenceLabel: v.optional(
        v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
      ),
      explanation: v.string(),
      horizons: v.object({
        h24: v.union(v.number(), v.null()),
        h7: v.union(v.number(), v.null()),
        h30: v.union(v.number(), v.null()),
      }),
    })
      .index("by_organization", ["organizationId"])
      .index("by_group", ["bloodGroup", "component"]),

    /** Model registry: versioned artifacts so predictions are reproducible. */
    mlModels: defineTable({
      kind: v.union(v.literal("donor_response"), v.literal("demand_forecast")),
      version: v.string(),
      trainedAt: v.number(),
      sampleSize: v.number(),
      payload: v.string(),
      metricsJson: v.string(),
      active: v.boolean(),
    }).index("by_kind", ["kind", "active"]),

    anomalyEvents: defineTable({
      organizationId: v.optional(v.id("organizations")),
      kind: anomalyKindValidator,
      severity: v.union(v.literal("warning"), v.literal("critical")),
      observed: v.number(),
      expected: v.number(),
      zScore: v.optional(v.number()),
      at: v.number(),
      note: v.string(),
      acknowledged: v.boolean(),
      createdAt: v.number(),
    })
      .index("by_organization", ["organizationId"])
      .index("by_acknowledged", ["acknowledged"]),

    notificationJobs: defineTable({
      userId: v.id("users"),
      notificationId: v.optional(v.id("notifications")),
      channel: notificationChannelValidator,
      recipient: v.string(),
      subject: v.string(),
      body: v.string(),
      idempotencyKey: v.string(),
      status: notificationJobStatusValidator,
      attempts: v.number(),
      lastError: v.optional(v.string()),
      createdAt: v.number(),
      sentAt: v.optional(v.number()),
    })
      .index("by_status", ["status"])
      .index("by_user", ["userId"])
      .index("by_idempotency", ["idempotencyKey"]),

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
