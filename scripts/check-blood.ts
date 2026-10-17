import assert from "node:assert/strict";
import {
  BLOOD_GROUPS,
  compatibility,
  donationGuidance,
  scoreMatch,
} from "../src/lib/blood";

// Red cells: O- is the universal red-cell donor.
for (const recipient of BLOOD_GROUPS) {
  assert.equal(compatibility("O-", recipient, "red_cells").compatible, true);
}

// Red cells: AB+ is the universal recipient, but AB+ red cells only go to AB+.
for (const donor of BLOOD_GROUPS) {
  assert.equal(compatibility(donor, "AB+", "red_cells").compatible, true);
}
for (const recipient of BLOOD_GROUPS.filter((g) => g !== "AB+")) {
  assert.equal(compatibility("AB+", recipient, "red_cells").compatible, false);
}

// A+ red cells accept A+, A-, O+, O- only.
const aPositiveDonors = BLOOD_GROUPS.filter((g) =>
  compatibility(g, "A+", "red_cells").compatible,
);
assert.deepEqual(aPositiveDonors.sort(), ["A+", "A-", "O+", "O-"].sort());

// Plasma: AB is the universal plasma donor because it has no anti-A/anti-B.
for (const recipient of BLOOD_GROUPS) {
  assert.equal(compatibility("AB+", recipient, "plasma").compatible, true);
}

// Plasma: O carries both antibodies and is only given to O recipients.
assert.equal(compatibility("O+", "O+", "plasma").compatible, true);
assert.equal(compatibility("O+", "O-", "plasma").compatible, true);
assert.equal(compatibility("O+", "A+", "plasma").compatible, false);
assert.equal(compatibility("O-", "AB+", "plasma").compatible, false);

// Plasma: A plasma can go to A and O recipients, never to B or AB.
for (const recipient of ["A+", "A-", "O+", "O-"]) {
  assert.equal(compatibility("A+", recipient, "plasma").compatible, true);
}
for (const recipient of ["B+", "B-", "AB+", "AB-"]) {
  assert.equal(compatibility("A+", recipient, "plasma").compatible, false);
}

// Ranking baseline must reward verified, nearby, urgent, available options.
const base = scoreMatch({
  compatible: true,
  sameCity: false,
  distanceKm: 120,
  urgency: "routine",
  verified: false,
  availableUnits: 0,
});
const strong = scoreMatch({
  compatible: true,
  sameCity: true,
  distanceKm: 0,
  urgency: "emergency",
  verified: true,
  availableUnits: 8,
  expiresInDays: 30,
});
assert.ok(strong.score > base.score, "strong options should score higher");
assert.equal(scoreMatch({ ...base, compatible: false }).score, 0);

// Interval guidance is advisory and must not claim clinical clearance.
assert.equal(donationGuidance(null).status, "unknown");
assert.equal(donationGuidance("2020-01-01").status, "ok");

console.log("LifeLink blood-rule checks passed.");
