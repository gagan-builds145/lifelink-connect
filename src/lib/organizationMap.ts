export const HOSPITAL_COLOR = "#2563EB";
export const RED_CROSS_COLOR = "#DC2626";
export const OWN_BASE_COLOR = "#16A34A";
export const GPS_COLOR = "#3B82F6";

export type OrganizationMapFilter =
  | "all"
  | "hospital"
  | "red_cross"
  | "own";

export type OrganizationLocationLike = {
  id: string;
  type: "hospital" | "red_cross" | "blood_bank";
  isOwnBase: boolean;
};

/** Green always wins for the authenticated viewer's own verified base. */
export function organizationMarkerColor(
  location: Pick<OrganizationLocationLike, "type" | "isOwnBase">,
): string {
  if (location.isOwnBase) return OWN_BASE_COLOR;
  return location.type === "hospital" ? HOSPITAL_COLOR : RED_CROSS_COLOR;
}

export function filterOrganizationLocations<
  T extends OrganizationLocationLike,
>(locations: T[], filter: OrganizationMapFilter): T[] {
  if (filter === "all") return locations;
  if (filter === "own") return locations.filter((location) => location.isOwnBase);
  return locations.filter((location) => location.type === filter);
}

export function organizationFilterCounts(
  locations: OrganizationLocationLike[],
): Record<OrganizationMapFilter, number> {
  return {
    all: locations.length,
    hospital: locations.filter((location) => location.type === "hospital")
      .length,
    red_cross: locations.filter((location) => location.type === "red_cross")
      .length,
    own: locations.filter((location) => location.isOwnBase).length,
  };
}

export function coordinateKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

/**
 * Groups overlapping coordinates into one visual marker. Every record remains
 * in the group and is shown in the shared popup, so no organization is lost.
 */
export function groupByCoordinate<T extends { lat: number; lng: number }>(
  points: T[],
): T[][] {
  const groups = new Map<string, T[]>();
  for (const point of points) {
    const key = coordinateKey(point.lat, point.lng);
    const bucket = groups.get(key);
    if (bucket) bucket.push(point);
    else groups.set(key, [point]);
  }
  return [...groups.values()];
}

export function isValidMapCoordinate(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
