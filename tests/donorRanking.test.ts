import { describe, expect, test } from "bun:test";
import { rankScoredDonors } from "../src/lib/donorRanking";

describe("donor ML ranking", () => {
  test("orders scored donors by probability, then distance", () => {
    const ranked = rankScoredDonors([
      { donorProfileId: "far-low", distanceKm: 42, responseProbability: 0.2 },
      { donorProfileId: "near-high", distanceKm: 3, responseProbability: 0.8 },
      { donorProfileId: "near-mid", distanceKm: 2, responseProbability: 0.4 },
      { donorProfileId: "far-mid", distanceKm: 30, responseProbability: 0.4 },
    ]);
    expect(ranked.map((donor) => donor.donorProfileId)).toEqual([
      "near-high",
      "near-mid",
      "far-mid",
      "far-low",
    ]);
  });

  test("uses distance only when no model probability exists", () => {
    const ranked = rankScoredDonors([
      { donorProfileId: "far", distanceKm: 20, responseProbability: null },
      { donorProfileId: "near", distanceKm: 2 },
      { donorProfileId: "scored", distanceKm: 50, responseProbability: 0.1 },
    ]);
    expect(ranked.map((donor) => donor.donorProfileId)).toEqual([
      "scored",
      "near",
      "far",
    ]);
  });
});
