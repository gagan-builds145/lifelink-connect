import { v } from "convex/values";

export const bloodGroupValidator = v.union(
  v.literal("A+"),
  v.literal("A-"),
  v.literal("B+"),
  v.literal("B-"),
  v.literal("AB+"),
  v.literal("AB-"),
  v.literal("O+"),
  v.literal("O-"),
);

export const componentValidator = v.union(
  v.literal("whole_blood"),
  v.literal("red_cells"),
  v.literal("platelets"),
  v.literal("plasma"),
);

export const urgencyValidator = v.union(
  v.literal("routine"),
  v.literal("urgent"),
  v.literal("emergency"),
);

export const requestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("under_verification"),
  v.literal("approved"),
  v.literal("dispatched"),
  v.literal("received"),
  v.literal("partially_fulfilled"),
  v.literal("fulfilled"),
  v.literal("rejected"),
  v.literal("cancelled"),
);

export const requestorTypeValidator = v.union(
  v.literal("patient"),
  v.literal("family"),
  v.literal("representative"),
);

export const orgTypeValidator = v.union(
  v.literal("red_cross"),
  v.literal("hospital"),
  v.literal("blood_bank"),
);

export const orgStatusValidator = v.union(
  v.literal("pending"),
  v.literal("verified"),
  v.literal("suspended"),
);

export const transactionTypeValidator = v.union(
  v.literal("collection"),
  v.literal("issue"),
  v.literal("reserve"),
  v.literal("release"),
  v.literal("dispatch"),
  v.literal("receipt"),
  v.literal("adjustment"),
  v.literal("expiry"),
);

export const campStatusValidator = v.union(
  v.literal("upcoming"),
  v.literal("ongoing"),
  v.literal("completed"),
  v.literal("cancelled"),
);

export const notificationKindValidator = v.union(
  v.literal("request"),
  v.literal("match"),
  v.literal("inventory"),
  v.literal("camp"),
  v.literal("ambulance"),
  v.literal("system"),
);

export const ambulanceTypeValidator = v.union(
  v.literal("bls"),
  v.literal("als"),
  v.literal("icu"),
  v.literal("neonatal"),
);

export const ambulanceBookingStatusValidator = v.union(
  v.literal("requested"),
  v.literal("searching"),
  v.literal("accepted"),
  v.literal("guardian_assigned"),
  v.literal("on_the_way"),
  v.literal("arrived_pickup"),
  v.literal("patient_picked_up"),
  v.literal("in_transit"),
  v.literal("completed"),
  v.literal("rejected"),
  v.literal("cancelled"),
  v.literal("expired"),
  v.literal("failed"),
);

/* ------------------------------------------------------------------ *
 * Guardian onboarding
 * ------------------------------------------------------------------ */

export const bloodGroupSourceValidator = v.union(
  v.literal("self_declared"),
  v.literal("medical_verified"),
);

export const guardianApplicationStatusValidator = v.union(
  v.literal("DRAFT"),
  v.literal("SUBMITTED"),
  v.literal("UNDER_REVIEW"),
  v.literal("APPROVED"),
  v.literal("REJECTED"),
  v.literal("RESUBMISSION_REQUIRED"),
  v.literal("SUSPENDED"),
  v.literal("EXPIRED"),
);

export const guardianDocumentKindValidator = v.union(
  v.literal("profile_photo"),
  v.literal("identity_proof"),
  v.literal("driving_licence_front"),
  v.literal("driving_licence_back"),
  v.literal("driver_photo"),
  v.literal("vehicle_front"),
  v.literal("vehicle_rear"),
  v.literal("vehicle_side"),
  v.literal("registration_certificate"),
  v.literal("insurance"),
  v.literal("fitness_certificate"),
  v.literal("puc_certificate"),
  v.literal("commercial_permit"),
  v.literal("ambulance_authorization"),
  v.literal("bank_proof"),
  v.literal("other"),
);

export const guardianDocumentStatusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("expired"),
);

export const userRoleValidator = v.union(
  v.literal("admin"),
  v.literal("community"),
  v.literal("donor"),
  v.literal("requestor"),
  v.literal("red_cross"),
  v.literal("hospital"),
  v.literal("guardian"),
  v.literal("drone_ops"),
  v.literal("user"),
  v.literal("member"),
);

/** Roles actually granted to an account. The legacy single `role` field stays
 * as the active/primary role for backward compatibility. */
export const userRolesValidator = v.array(userRoleValidator);

/* ------------------------------------------------------------------ *
 * Autonomous supply-chain validators
 * ------------------------------------------------------------------ */

export const droneStatusValidator = v.union(
  v.literal("available"),
  v.literal("assigned"),
  v.literal("charging"),
  v.literal("maintenance"),
  v.literal("offline"),
);

export const flightControllerValidator = v.union(v.literal("px4"), v.literal("ardupilot"));

export const linkStatusValidator = v.union(
  v.literal("online"),
  v.literal("degraded"),
  v.literal("offline"),
);

export const maintenanceStatusValidator = v.union(
  v.literal("ok"),
  v.literal("due"),
  v.literal("grounded"),
);

export const waypointKindValidator = v.union(
  v.literal("pickup"),
  v.literal("corridor"),
  v.literal("waypoint"),
  v.literal("diversion"),
  v.literal("landing"),
);

export const waypointValidator = v.object({
  lat: v.number(),
  lng: v.number(),
  label: v.string(),
  kind: waypointKindValidator,
});

export const preflightCheckValidator = v.object({
  key: v.string(),
  label: v.string(),
  status: v.union(v.literal("pass"), v.literal("warn"), v.literal("fail")),
  detail: v.string(),
  critical: v.boolean(),
});

export const missionStateValidator = v.union(
  v.literal("PLANNED"),
  v.literal("PREFLIGHT_CHECKING"),
  v.literal("PREFLIGHT_PASSED"),
  v.literal("DISPATCHED_TO_PICKUP"),
  v.literal("AT_PICKUP"),
  v.literal("PAYLOAD_LOADING"),
  v.literal("PAYLOAD_LOADED"),
  v.literal("IN_TRANSIT_TO_DESTINATION"),
  v.literal("AT_DESTINATION"),
  v.literal("DELIVERED"),
  v.literal("RETURNING_TO_BASE"),
  v.literal("COMPLETED"),
  v.literal("HOLD"),
  v.literal("ABORTED"),
  v.literal("EMERGENCY_LANDING"),
);

export const missionEventValidator = v.object({
  state: missionStateValidator,
  at: v.number(),
  note: v.optional(v.string()),
  actorUserId: v.optional(v.id("users")),
});

export const transferStatusValidator = v.union(
  v.literal("reserved"),
  v.literal("approved"),
  v.literal("dispatched"),
  v.literal("in_transit"),
  v.literal("received"),
  v.literal("cancelled"),
  v.literal("failed"),
);

export const integrationKindValidator = v.union(
  v.literal("hms_api"),
  v.literal("blood_bank_api"),
  v.literal("rest_webhook"),
  v.literal("database_replica"),
);

export const integrationStatusValidator = v.union(
  v.literal("connected"),
  v.literal("degraded"),
  v.literal("error"),
  v.literal("not_configured"),
);

export const syncModeValidator = v.union(
  v.literal("event"),
  v.literal("periodic"),
  v.literal("manual"),
);

export const notificationChannelValidator = v.union(
  v.literal("email"),
  v.literal("sms"),
  v.literal("push"),
);

export const notificationJobStatusValidator = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("skipped_no_provider"),
);

export const donorInvitationStatusValidator = v.union(
  v.literal("sent"),
  v.literal("accepted"),
  v.literal("declined"),
  v.literal("expired"),
  v.literal("cancelled"),
);

export const anomalyKindValidator = v.union(
  v.literal("demand_spike"),
  v.literal("stock_drop"),
  v.literal("sync_failure"),
  v.literal("inventory_mismatch"),
);

export const aiDatasetStageValidator = v.union(
  v.literal("raw"),
  v.literal("cleaned"),
  v.literal("processed"),
  v.literal("training"),
  v.literal("validation"),
  v.literal("testing"),
);

export const aiModelKindValidator = v.union(
  v.literal("xgboost_demand"),
  v.literal("random_forest_donor"),
  v.literal("isolation_forest"),
  v.literal("ann_donor"),
  v.literal("lstm_demand"),
  v.literal("autoencoder_inventory"),
  v.literal("cnn_research"),
);

export const aiModelStatusValidator = v.union(
  v.literal("candidate"),
  v.literal("approved"),
  v.literal("active"),
  v.literal("rolled_back"),
  v.literal("rejected"),
);

export const aiTrainingRunStatusValidator = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const medicalDocumentKindValidator = v.union(
  v.literal("discharge_summary"),
  v.literal("blood_test_report"),
  v.literal("laboratory_report"),
  v.literal("blood_group_report"),
  v.literal("diagnosis_report"),
  v.literal("treatment_report"),
  v.literal("prescription"),
  v.literal("operation_surgery_report"),
  v.literal("medical_certificate"),
  v.literal("other_medical"),
);

export const medicalRecordActionValidator = v.union(
  v.literal("upload"),
  v.literal("view"),
  v.literal("download"),
  v.literal("search"),
  v.literal("consent_grant"),
  v.literal("consent_revoke"),
);

export const aiDatasetStatusValidator = v.union(
  v.literal("active"),
  v.literal("archived"),
  v.literal("deleted"),
);
