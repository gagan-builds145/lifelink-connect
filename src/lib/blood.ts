/**
 * Shared blood-domain data and the rules-based matching baseline.
 *
 * This module is deliberately free of React/DOM imports so the Convex backend
 * and the browser both use exactly the same medically-reviewable rules.
 *
 * ADVISORY ONLY: ABO/Rh labels are not proof of compatibility. Component,
 * cross-matching, antibody screening and clinical judgement stay with
 * qualified medical professionals.
 */

export const BLOOD_GROUPS = [
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const COMPONENTS = [
  "whole_blood",
  "red_cells",
  "platelets",
  "plasma",
] as const;
export type Component = (typeof COMPONENTS)[number];

export const COMPONENT_LABELS: Record<Component, string> = {
  whole_blood: "Whole Blood",
  red_cells: "Packed Red Blood Cells",
  platelets: "Platelets",
  plasma: "Plasma",
};

export const COMPONENT_SHORT: Record<Component, string> = {
  whole_blood: "Whole blood",
  red_cells: "Red cells",
  platelets: "Platelets",
  plasma: "Plasma",
};

export const URGENCIES = ["routine", "urgent", "emergency"] as const;
export type Urgency = (typeof URGENCIES)[number];

export const REQUESTOR_TYPES = ["patient", "family", "representative"] as const;
export type RequestorType = (typeof REQUESTOR_TYPES)[number];

export const REQUEST_STATUSES = [
  "pending",
  "under_verification",
  "approved",
  "dispatched",
  "received",
  "fulfilled",
  "rejected",
  "cancelled",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Pending",
  under_verification: "Under verification",
  approved: "Approved",
  dispatched: "Dispatched",
  received: "Received",
  fulfilled: "Fulfilled",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const URGENCY_LABELS: Record<Urgency, string> = {
  routine: "Routine",
  urgent: "Urgent",
  emergency: "Emergency",
};

export const REQUESTOR_TYPE_LABELS: Record<RequestorType, string> = {
  patient: "Patient",
  family: "Family member",
  representative: "Authorized representative",
};

export const ORG_TYPES = ["red_cross", "hospital", "blood_bank"] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  Pune: { lat: 18.5204, lng: 73.8567 },
  Mumbai: { lat: 19.076, lng: 72.8777 },
  Nashik: { lat: 19.9975, lng: 73.7898 },
  Nagpur: { lat: 21.1458, lng: 79.0882 },
  "New Delhi": { lat: 28.6139, lng: 77.209 },
  Gurugram: { lat: 28.4595, lng: 77.0266 },
  Bengaluru: { lat: 12.9716, lng: 77.5946 },
  Hyderabad: { lat: 17.385, lng: 78.4867 },
  Chennai: { lat: 13.0827, lng: 80.2707 },
  Kolkata: { lat: 22.5726, lng: 88.3639 },
  Ahmedabad: { lat: 23.0225, lng: 72.5714 },
  Jaipur: { lat: 26.9124, lng: 75.7873 },
  Lucknow: { lat: 26.8467, lng: 80.9462 },
  Bhopal: { lat: 23.2599, lng: 77.4126 },
  Kochi: { lat: 9.9312, lng: 76.2673 },
  Chandigarh: { lat: 30.7333, lng: 76.7794 },
};

export const CITIES = Object.keys(CITY_COORDS).sort();

export function cityCoords(city?: string | null) {
  if (!city) return null;
  return CITY_COORDS[city] ?? null;
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ---------------------------------------------------------------- *
 * Compatibility rules (advisory, configurable data — not code odds)
 * ---------------------------------------------------------------- */

/** Can `donor` red cells / whole blood be given to `recipient`? */
const RED_CELL_TARGETS: Record<BloodGroup, BloodGroup[]> = {
  "O-": ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
  "O+": ["A+", "B+", "AB+", "O+"],
  "A-": ["A+", "A-", "AB+", "AB-"],
  "A+": ["A+", "AB+"],
  "B-": ["B+", "B-", "AB+", "AB-"],
  "B+": ["B+", "AB+"],
  "AB-": ["AB+", "AB-"],
  "AB+": ["AB+"],
};

/** Plasma compatibility runs the opposite way to red cells. */
const PLASMA_TARGETS: Record<BloodGroup, BloodGroup[]> = {
  "AB+": ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
  "AB-": ["A-", "B-", "AB-", "O-"],
  "A+": ["A+", "AB+"],
  "A-": ["A-", "AB-"],
  "B+": ["B+", "AB+"],
  "B-": ["B-", "AB-"],
  "O+": ["O+", "A+", "B+", "AB+"],
  "O-": ["O-", "A-", "B-", "AB-"],
};

export type CompatibilityResult = {
  compatible: boolean;
  basis: "abo_rh" | "component_specific" | "not_compatible";
  note: string;
};

export function compatibility(
  donor: string,
  recipient: string,
  component: Component | string,
): CompatibilityResult {
  const d = donor as BloodGroup;
  const r = recipient as BloodGroup;
  if (!d || !r) {
    return { compatible: false, basis: "not_compatible", note: "Unknown blood group." };
  }
  if (component === "plasma") {
    const ok = PLASMA_TARGETS[d]?.includes(r) ?? false;
    return {
      compatible: ok,
      basis: ok ? "component_specific" : "not_compatible",
      note: ok
        ? "Plasma compatibility is ABO-reversed; final issue requires laboratory confirmation."
        : "Plasma compatibility rules do not allow this direction.",
    };
  }
  if (component === "platelets") {
    if (d === r) {
      return {
        compatible: true,
        basis: "abo_rh",
        note: "Same ABO/Rh group. Platelet cross-matching is still required.",
      };
    }
    const alternative =
      (d === "O-" && r !== "O-") || (d.replace(/[+-]/, "") === r.replace(/[+-]/, ""));
    return {
      compatible: alternative,
      basis: alternative ? "component_specific" : "not_compatible",
      note: alternative
        ? "Platelets are not strictly ABO-identical; treat as a possibility only, pending clinician approval."
        : "Platelet allocation should follow local transfusion policy and clinician review.",
    };
  }
  const ok = RED_CELL_TARGETS[d]?.includes(r) ?? false;
  return {
    compatible: ok,
    basis: ok ? "abo_rh" : "not_compatible",
    note: ok
      ? "ABO/Rh compatible on paper. Cross-matching and infection screening are still mandatory."
      : "ABO/Rh rules do not permit this direction for red cells.",
  };
}

export function compatibleDonorGroups(
  recipient: string,
  component: Component,
): BloodGroup[] {
  return BLOOD_GROUPS.filter((g) => compatibility(g, recipient, component).compatible);
}

/* ---------------------------------------------------------------- *
 * Deterministic ranking baseline
 * ---------------------------------------------------------------- */

export type MatchSignals = {
  compatible: boolean;
  sameCity: boolean;
  distanceKm: number | null;
  urgency: Urgency;
  availableUnits?: number;
  eligible?: boolean;
  verified?: boolean;
  expiresInDays?: number | null;
};

export type MatchResult = {
  score: number;
  reasons: string[];
  warnings: string[];
};

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/**
 * Transparent score out of 100. Every input is stored data; nothing is
 * invented, so staff can explain why an option was ranked where it is.
 */
export function scoreMatch(signals: MatchSignals): MatchResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!signals.compatible) {
    return {
      score: 0,
      reasons: ["ABO/Rh rules do not support this option."],
      warnings: ["Do not allocate without specialist review."],
    };
  }

  let score = 42;
  reasons.push("ABO/Rh compatibility satisfied for this component");

  if (signals.verified) {
    score += 13;
    reasons.push("Source is verified by an authorized organization");
  } else {
    warnings.push("Source is not verified yet");
  }

  if (signals.availableUnits != null) {
    if (signals.availableUnits >= 3) {
      score += 14;
      reasons.push(`${signals.availableUnits} units reported available`);
    } else if (signals.availableUnits > 0) {
      score += 8;
      reasons.push(`Limited stock (${signals.availableUnits} units)`);
    } else {
      warnings.push("No unreserved stock at this source");
    }
  }

  if (signals.sameCity) {
    score += 14;
    reasons.push("Located in the same city as the request");
  } else if (signals.distanceKm != null) {
    const proximity = clamp(14 - signals.distanceKm / 20, 0, 14);
    score += proximity;
    reasons.push(`About ${signals.distanceKm.toFixed(1)} km from the request city`);
  }

  if (signals.eligible) {
    score += 10;
    reasons.push("Donor availability and interval guidance are reported as OK");
  } else if (signals.eligible === false) {
    warnings.push("Donor may not meet donation-interval guidance");
  }

  if (signals.urgency === "emergency") {
    score += 4;
    reasons.push("Emergency urgency raises priority for clinician review");
  } else if (signals.urgency === "urgent") {
    score += 2;
  }

  if (signals.expiresInDays != null && signals.expiresInDays >= 0) {
    if (signals.expiresInDays <= 7) {
      warnings.push(`Stock expires in ${signals.expiresInDays} day(s)`);
      score -= 3;
    } else {
      score += 2;
      reasons.push("Stock has remaining shelf life");
    }
  }

  return {
    score: Math.round(clamp(score, 0, 100)),
    reasons,
    warnings,
  };
}

export const MATCHING_DISCLAIMER =
  "Matching is advisory and rules-based. Blood group labels alone never guarantee compatibility: component rules, cross-matching, screening and the final issue decision belong to qualified medical staff.";

export const AI_MODEL_STATUS = {
  configured: false,
  label: "Rules-based baseline · ML model not connected",
  detail:
    "LifeLink uses a transparent deterministic ranking engine. No trained model is loaded in this deployment, so no AI predictions are shown.",
} as const;

/* ---------------------------------------------------------------- *
 * Donation eligibility guidance (advisory)
 * ---------------------------------------------------------------- */

export function ageFromDob(dob: string): number | null {
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const m = now.getMonth() - date.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < date.getDate())) age -= 1;
  return age;
}

export function daysSince(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

export function donationGuidance(lastDonationDate?: string | null) {
  const days = daysSince(lastDonationDate);
  if (days == null) {
    return {
      status: "unknown" as const,
      label: "No donation recorded",
      detail: "Final eligibility is decided by medical staff at the donation center.",
    };
  }
  if (days >= 90) {
    return {
      status: "ok" as const,
      label: "Interval guidance met",
      detail: `${days} days since the last recorded donation. Screening is still required.`,
    };
  }
  return {
    status: "wait" as const,
    label: `Interval guidance: ~${90 - days} day(s) remaining`,
    detail:
      "A 90-day interval is a common advisory baseline. Local policy and clinician assessment always take precedence.",
  };
}

export function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDate(value?: string | number | null): string {
  if (value == null || value === "") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value?: string | number | null): string {
  if (value == null || value === "") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
