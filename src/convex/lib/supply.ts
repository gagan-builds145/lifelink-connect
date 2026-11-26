/**
 * Donor invitation eligibility and supply-related helpers.
 *
 * Eligibility checks are deterministic and run entirely in Convex. They decide
 * whether a donor can be invited or must be skipped. ML scoring only orders
 * already-eligible donors and never fabricates eligibility.
 */

import { cityCoords, haversineKm, isEmergency } from "../../lib/blood";

export const DONOR_FALLBACK_NOTE =
  "Donor invitations are sent only after institutional supply is exhausted. " +
  "Eligibility is checked before each invitation; screening and cross-matching " +
  "are mandatory before any unit is released as stock.";

export type DonorInviteEligibilityBlocker =
  | "no_consent"
  | "medical_interval"
  | "not_available"
  | "location_mismatch"
  | "blood_group_mismatch";

export type DonorInviteEligibilityResult = {
  eligible: boolean;
  blockers: DonorInviteEligibilityBlocker[];
};

type DonorEligibilityInput = {
  donorId: string;
  city: string;
  bloodGroup: string;
  available: boolean;
  lastDonationDate: string | null;
  shareLocationConsent: boolean;
  consentExpiresAt: number | null;
};

type RequestEligibilityInput = {
  bloodGroup: string;
  component: string;
  city: string;
  urgency: string;
};

const MIN_DAYS_BETWEEN_DONATIONS = 56;
function daysSinceLastDonation(lastDonationDate: string | null, now: number): number {
  if (!lastDonationDate) return 999;
  const donated = new Date(lastDonationDate);
  if (isNaN(donated.getTime())) return 999;
  const diffMs = now - donated.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function donorInviteEligibility(
  donor: DonorEligibilityInput,
  request: RequestEligibilityInput,
  now: { now: number },
): DonorInviteEligibilityResult {
  const blockers: DonorInviteEligibilityBlocker[] = [];

  if (!donor.available) {
    blockers.push("not_available");
  }

  if (!donor.shareLocationConsent || donor.consentExpiresAt == null || donor.consentExpiresAt <= now.now) {
    blockers.push("no_consent");
  }

  if (!isEmergency(request.urgency)) {
    const daysSince = daysSinceLastDonation(donor.lastDonationDate, now.now);
    if (daysSince < MIN_DAYS_BETWEEN_DONATIONS) {
      blockers.push("medical_interval");
    }
  }

  // Location and blood group matching are done before eligibility is checked
  // (in prepareDonorEscalation / notifyCompatibleDonors). This function only
  // checks the remaining eligibility gates.

  const eligible = blockers.length === 0;
  return { eligible, blockers };
}

/**
 * Compute approximate distance between a donor city and an organization city.
 * Returns null when either city coordinate is unknown.
 */
export function cityDistanceKm(donorCity: string, orgCity: string): number | null {
  const donorPoint = cityCoords(donorCity);
  const orgPoint = cityCoords(orgCity);
  if (!donorPoint || !orgPoint) return null;
  return Math.round(haversineKm(donorPoint, orgPoint) * 10) / 10;
}
