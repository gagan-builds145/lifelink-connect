export const AMBULANCE_TYPES = ["bls", "als", "icu", "neonatal"] as const;
export type AmbulanceType = (typeof AMBULANCE_TYPES)[number];

export const AMBULANCE_TYPE_LABELS: Record<AmbulanceType, string> = {
  bls: "Basic life support",
  als: "Advanced life support",
  icu: "ICU ambulance",
  neonatal: "Neonatal ambulance",
};

export const AMBULANCE_BOOKING_STATUSES = [
  "requested",
  "searching",
  "accepted",
  "guardian_assigned",
  "on_the_way",
  "arrived_pickup",
  "patient_picked_up",
  "in_transit",
  "completed",
  "rejected",
  "cancelled",
  "expired",
  "failed",
] as const;
export type AmbulanceBookingStatus =
  (typeof AMBULANCE_BOOKING_STATUSES)[number];

export const AMBULANCE_STATUS_LABELS: Record<
  AmbulanceBookingStatus,
  string
> = {
  requested: "Requested",
  searching: "Searching for ambulance",
  accepted: "Accepted",
  guardian_assigned: "Guardian assigned",
  on_the_way: "On the way",
  arrived_pickup: "Arrived at pickup",
  patient_picked_up: "Patient picked up",
  in_transit: "In transit",
  completed: "Completed",
  rejected: "Rejected by provider",
  cancelled: "Cancelled",
  expired: "Expired — no provider accepted",
  failed: "Failed",
};

export const ACTIVE_AMBULANCE_STATUSES: AmbulanceBookingStatus[] = [
  "requested",
  "searching",
  "accepted",
  "guardian_assigned",
  "on_the_way",
  "arrived_pickup",
  "patient_picked_up",
  "in_transit",
];

export function isActiveAmbulanceStatus(status: string): boolean {
  return ACTIVE_AMBULANCE_STATUSES.includes(status as AmbulanceBookingStatus);
}

/** Status moves a Guardian may make after accepting a booking. */
export function nextGuardianStatuses(
  status: AmbulanceBookingStatus,
): AmbulanceBookingStatus[] {
  switch (status) {
    case "requested":
    case "searching":
      return ["accepted", "cancelled"];
    case "accepted":
    case "guardian_assigned":
      return ["on_the_way", "cancelled"];
    case "on_the_way":
      return ["arrived_pickup", "cancelled"];
    case "arrived_pickup":
      return ["patient_picked_up", "cancelled"];
    case "patient_picked_up":
      return ["in_transit", "cancelled"];
    case "in_transit":
      return ["completed", "failed"];
    default:
      return [];
  }
}

/** Open requests may be released by the system after this window. */
export const AMBULANCE_REQUEST_TTL_MS = 15 * 60 * 1000;

/** Nearest-first discovery radius used by the live ambulance network. */
export const AMBULANCE_DISCOVERY_RADIUS_KM = 100;

/**
 * A vehicle location older than this is not considered live for discovery or
 * tracking. The client uses the same threshold so a stale marker is never
 * presented as a current GPS fix.
 */
export const AMBULANCE_LOCATION_STALE_MS = 2 * 60 * 1000;

export function isAmbulanceLocationFresh(
  lastLocationAt: number | null | undefined,
  now = Date.now(),
): boolean {
  return (
    typeof lastLocationAt === "number" &&
    Number.isFinite(lastLocationAt) &&
    lastLocationAt <= now &&
    now - lastLocationAt <= AMBULANCE_LOCATION_STALE_MS
  );
}

/**
 * Emergency one-tap requests keep searching for a genuinely available
 * ambulance for this bounded window. Manual requests keep the shorter TTL
 * above because a person chose a specific vehicle.
 */
export const AMBULANCE_SEARCH_WINDOW_MS = 30 * 60 * 1000;
export const AMBULANCE_REMATCH_INTERVAL_MS = 60 * 1000;
export const AMBULANCE_MAX_REMATCH_ATTEMPTS = 20;

/** Deadline for an open booking, used by both re-matching and expiry sweeps. */
export function ambulanceOpenDeadline(booking: {
  status: string;
  requestedAt: number;
  searchExpiresAt?: number;
}): number {
  if (booking.searchExpiresAt != null) return booking.searchExpiresAt;
  return (
    booking.requestedAt +
    (booking.status === "searching"
      ? AMBULANCE_SEARCH_WINDOW_MS
      : AMBULANCE_REQUEST_TTL_MS)
  );
}

export const AMBULANCE_BASE_FARE = 250;
export const AMBULANCE_PER_KM_FARE = 28;

export function estimateAmbulanceFare(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return AMBULANCE_BASE_FARE;
  return Math.round(AMBULANCE_BASE_FARE + distanceKm * AMBULANCE_PER_KM_FARE);
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const radius = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A conservative city ambulance ETA: distance at 30 km/h plus dispatch margin. */
export function estimateEtaMinutes(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  return Math.max(2, Math.round((distanceKm / 30) * 60 + 2));
}
