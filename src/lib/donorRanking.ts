export type ScoredDonor = {
  donorProfileId: string;
  distanceKm: number;
  responseProbability?: number | null;
};

/**
 * Orders already-eligible, consented donors. A missing score is an explicit
 * fallback to distance; it is never replaced by a fabricated probability.
 */
export function rankScoredDonors<T extends ScoredDonor>(donors: T[]): T[] {
  return [...donors].sort((a, b) => {
    const pa = a.responseProbability ?? null;
    const pb = b.responseProbability ?? null;
    if (pa != null && pb != null && pb !== pa) return pb - pa;
    if (pa != null && pb == null) return -1;
    if (pa == null && pb != null) return 1;
    return a.distanceKm - b.distanceKm;
  });
}
