/** Shared Guardian onboarding rules (backend and UI). */

export const GUARDIAN_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "RESUBMISSION_REQUIRED",
  "SUSPENDED",
  "EXPIRED",
] as const;

export type GuardianStatus = (typeof GUARDIAN_STATUSES)[number];

export const GUARDIAN_STATUS_LABELS: Record<GuardianStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted — awaiting review",
  UNDER_REVIEW: "Under administrator review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RESUBMISSION_REQUIRED: "Resubmission required",
  SUSPENDED: "Suspended",
  EXPIRED: "Expired documents",
};

export const GUARDIAN_DOCUMENT_KINDS = [
  "profile_photo",
  "identity_proof",
  "driving_licence_front",
  "driving_licence_back",
  "driver_photo",
  "vehicle_front",
  "vehicle_rear",
  "vehicle_side",
  "registration_certificate",
  "insurance",
  "fitness_certificate",
  "puc_certificate",
  "commercial_permit",
  "ambulance_authorization",
  "bank_proof",
  "other",
] as const;

export type GuardianDocumentKind = (typeof GUARDIAN_DOCUMENT_KINDS)[number];

export const GUARDIAN_DOCUMENT_LABELS: Record<GuardianDocumentKind, string> = {
  profile_photo: "Profile photograph",
  identity_proof: "Identification document",
  driving_licence_front: "Driving licence — front",
  driving_licence_back: "Driving licence — back",
  driver_photo: "Driver photograph",
  vehicle_front: "Vehicle — front photograph",
  vehicle_rear: "Vehicle — rear photograph",
  vehicle_side: "Vehicle — side photograph",
  registration_certificate: "Registration Certificate (RC)",
  insurance: "Vehicle insurance certificate",
  fitness_certificate: "Fitness certificate",
  puc_certificate: "Pollution Under Control (PUC) certificate",
  commercial_permit: "Commercial permit",
  ambulance_authorization: "Ambulance authorization / compliance certificate",
  bank_proof: "Bank account proof",
  other: "Additional document",
};

/**
 * Baseline document requirements. Configuration, not a claim of legal
 * completeness: operators must adjust for vehicle class and state rules.
 */
export const REQUIRED_DOCUMENTS_BY_TYPE: Record<string, GuardianDocumentKind[]> = {
  bls: [
    "driving_licence_front",
    "registration_certificate",
    "insurance",
    "fitness_certificate",
    "puc_certificate",
  ],
  als: [
    "driving_licence_front",
    "registration_certificate",
    "insurance",
    "fitness_certificate",
    "puc_certificate",
    "ambulance_authorization",
  ],
  icu: [
    "driving_licence_front",
    "registration_certificate",
    "insurance",
    "fitness_certificate",
    "puc_certificate",
    "ambulance_authorization",
  ],
  neonatal: [
    "driving_licence_front",
    "registration_certificate",
    "insurance",
    "fitness_certificate",
    "puc_certificate",
    "ambulance_authorization",
  ],
};

export type GuardianDocumentLike = {
  documentKind?: string | null;
  expiryDate?: string | null;
  status?: string | null;
  ambulanceId?: string | null;
};

export type VehicleLike = {
  id: string;
  type: string;
  insuranceExpiryDate?: string | null;
  fitnessExpiryDate?: string | null;
  pucExpiryDate?: string | null;
  permitExpiryDate?: string | null;
  ambulanceAuthorizationExpiryDate?: string | null;
};

export function statusOf(profile: {
  status?: string | null;
  documentsStatus?: string | null;
}): GuardianStatus {
  if (profile.status && GUARDIAN_STATUSES.includes(profile.status as GuardianStatus)) {
    return profile.status as GuardianStatus;
  }
  // Legacy profiles only carry documentsStatus.
  if (profile.documentsStatus === "verified") return "APPROVED";
  if (profile.documentsStatus === "rejected") return "REJECTED";
  return "DRAFT";
}

export function isGuardianApproved(profile: {
  status?: string | null;
  documentsStatus?: string | null;
}): boolean {
  return statusOf(profile) === "APPROVED";
}

function isPast(date: string | null | undefined, today: string): boolean {
  return Boolean(date && date < today);
}

/**
 * Problems that block going online / accepting bookings. Empty means the fleet
 * may operate, subject to administrator approval.
 */
export function guardianComplianceIssues(input: {
  profile: {
    status?: string | null;
    documentsStatus?: string | null;
    driver?: {
      licenceExpiryDate?: string | null;
      licenceCategory?: string | null;
      fullName?: string | null;
    } | null;
  };
  vehicles: VehicleLike[];
  documents: GuardianDocumentLike[];
  today?: string;
}): string[] {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const issues: string[] = [];
  const status = statusOf(input.profile);
  if (status !== "APPROVED") {
    issues.push(`Guardian application is ${GUARDIAN_STATUS_LABELS[status].toLowerCase()}.`);
  }
  if (input.vehicles.length === 0) issues.push("No ambulance vehicle has been registered.");
  const licenceExpiry = input.profile.driver?.licenceExpiryDate;
  if (!licenceExpiry) issues.push("Driving licence expiry date is missing.");
  else if (isPast(licenceExpiry, today)) issues.push("Driving licence has expired.");

  for (const vehicle of input.vehicles) {
    const required = REQUIRED_DOCUMENTS_BY_TYPE[vehicle.type] ?? REQUIRED_DOCUMENTS_BY_TYPE.bls;
    for (const kind of required) {
      const doc = input.documents.find(
        (candidate) =>
          candidate.documentKind === kind &&
          candidate.status !== "rejected" &&
          candidate.status !== "expired" &&
          !isPast(candidate.expiryDate, today) &&
          (candidate.ambulanceId == null || candidate.ambulanceId === vehicle.id),
      );
      if (!doc) {
        issues.push(`${GUARDIAN_DOCUMENT_LABELS[kind]} is missing, expired or invalid for vehicle ${vehicle.id.slice(-6)}.`);
      }
    }
    if (isPast(vehicle.insuranceExpiryDate, today)) issues.push("Vehicle insurance has expired.");
    if (isPast(vehicle.fitnessExpiryDate, today)) issues.push("Vehicle fitness certificate has expired.");
    if (isPast(vehicle.pucExpiryDate, today)) issues.push("Vehicle PUC certificate has expired.");
    if (isPast(vehicle.permitExpiryDate, today)) issues.push("Commercial permit has expired.");
    if (isPast(vehicle.ambulanceAuthorizationExpiryDate, today)) {
      issues.push("Ambulance authorization has expired.");
    }
  }
  return issues;
}

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  return Math.floor((target - Date.now()) / 86_400_000);
}
