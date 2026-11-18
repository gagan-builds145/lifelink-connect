import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";
import type { Id } from "../src/convex/_generated/dataModel";
import {
  GPS_COLOR,
  HOSPITAL_COLOR,
  OWN_BASE_COLOR,
  RED_CROSS_COLOR,
  filterOrganizationLocations,
  groupByCoordinate,
  isValidMapCoordinate,
  organizationFilterCounts,
  organizationMarkerColor,
  type OrganizationLocationLike,
} from "../src/lib/organizationMap";

const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./profiles.ts": () => import("../src/convex/profiles"),
};

type TestApp = TestConvex<typeof schema>;

type Seeded = {
  hospitalA: Id<"organizations">;
  hospitalB: Id<"organizations">;
  redCrossA: Id<"organizations">;
  redCrossB: Id<"organizations">;
  bloodBank: Id<"organizations">;
  pending: Id<"organizations">;
  missingCoords: Id<"organizations">;
  invalidCoords: Id<"organizations">;
  duplicateCoords: Id<"organizations">;
  multiBaseA: Id<"organizations">;
  multiBaseB: Id<"organizations">;
  hospitalUser: Id<"users">;
  redCrossUser: Id<"users">;
  communityUser: Id<"users">;
  noOrgUser: Id<"users">;
};

async function seed(t: TestApp): Promise<Seeded> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const org = (
      orgId: string,
      name: string,
      type: "hospital" | "red_cross" | "blood_bank",
      options: {
        status?: "pending" | "verified" | "suspended";
        lat?: number;
        lng?: number;
      } = {},
    ) =>
      ctx.db.insert("organizations", {
        orgId,
        type,
        name,
        contactPerson: "Coordinator",
        phone: "02026128000",
        email: `${orgId.toLowerCase()}@test.example`,
        address: `${name} address`,
        city: "Pune",
        latitude: options.lat,
        longitude: options.lng,
        status: options.status ?? "verified",
        createdAt: now,
        updatedAt: now,
      });

    const hospitalA = await org("HOSP-A", "Hospital A", "hospital", {
      lat: 18.52,
      lng: 73.85,
    });
    const hospitalB = await org("HOSP-B", "Hospital B", "hospital", {
      lat: 18.53,
      lng: 73.86,
    });
    const redCrossA = await org("RC-A", "Red Cross A", "red_cross", {
      lat: 18.54,
      lng: 73.87,
    });
    const redCrossB = await org("RC-B", "Red Cross B", "red_cross", {
      lat: 18.55,
      lng: 73.88,
    });
    const bloodBank = await org("BB-A", "Blood Bank A", "blood_bank", {
      lat: 18.56,
      lng: 73.89,
    });
    const pending = await org("HOSP-PENDING", "Pending Hospital", "hospital", {
      status: "pending",
      lat: 18.57,
      lng: 73.9,
    });
    const missingCoords = await org(
      "HOSP-NO-COORDS",
      "No Coordinates Hospital",
      "hospital",
    );
    const invalidCoords = await org(
      "HOSP-BAD-COORDS",
      "Invalid Coordinates Hospital",
      "hospital",
      { lat: 120, lng: 73.9 },
    );
    // A separate approved organization at the same coordinates as Hospital A.
    const duplicateCoords = await org(
      "RC-DUPLICATE",
      "Red Cross At Hospital A",
      "red_cross",
      { lat: 18.52, lng: 73.85 },
    );
    // Two registered bases sharing the viewer's organization identifier.
    const multiBaseA = await org("ORG-MULTI", "Multi Base One", "hospital", {
      lat: 18.6,
      lng: 73.92,
    });
    const multiBaseB = await org("ORG-MULTI", "Multi Base Two", "hospital", {
      lat: 18.61,
      lng: 73.93,
    });

    const user = (
      name: string,
      email: string,
      role: "hospital" | "red_cross" | "community",
      organizationId?: Id<"organizations">,
    ) =>
      ctx.db.insert("users", {
        name,
        email,
        role,
        organizationId,
        profileCompleted: true,
        createdAt: now,
      });

    const hospitalUser = await user(
      "Hospital User",
      "hospital@test.example",
      "hospital",
      hospitalA,
    );
    const redCrossUser = await user(
      "Red Cross User",
      "redcross@test.example",
      "red_cross",
      redCrossA,
    );
    const communityUser = await user(
      "Community User",
      "community@test.example",
      "community",
    );
    const noOrgUser = await user(
      "Unlinked Hospital User",
      "unlinked@test.example",
      "hospital",
    );

    return {
      hospitalA,
      hospitalB,
      redCrossA,
      redCrossB,
      bloodBank,
      pending,
      missingCoords,
      invalidCoords,
      duplicateCoords,
      multiBaseA,
      multiBaseB,
      hospitalUser,
      redCrossUser,
      communityUser,
      noOrgUser,
    };
  });
}

function byName<T extends { name: string; isOwnBase: boolean }>(
  locations: T[],
  name: string,
): T | undefined {
  return locations.find((location) => location.name === name);
}

describe("organization map query", () => {
  test("hospital account: own verified base is green, other hospitals blue and Red Cross red", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const result = await t
      .withIdentity({ subject: String(seeded.hospitalUser) })
      .query(api.profiles.mapLocations, {});

    expect(byName(result.locations, "Hospital A")?.isOwnBase).toBe(true);
    expect(byName(result.locations, "Hospital B")?.isOwnBase).toBe(false);
    expect(byName(result.locations, "Red Cross A")?.isOwnBase).toBe(false);
    expect(organizationMarkerColor(byName(result.locations, "Hospital A")!)).toBe(
      OWN_BASE_COLOR,
    );
    expect(organizationMarkerColor(byName(result.locations, "Hospital B")!)).toBe(
      HOSPITAL_COLOR,
    );
    expect(organizationMarkerColor(byName(result.locations, "Red Cross A")!)).toBe(
      RED_CROSS_COLOR,
    );
  });

  test("Red Cross account: own verified base is green and other organizations keep their type colours", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const result = await t
      .withIdentity({ subject: String(seeded.redCrossUser) })
      .query(api.profiles.mapLocations, {});

    expect(byName(result.locations, "Red Cross A")?.isOwnBase).toBe(true);
    expect(byName(result.locations, "Red Cross B")?.isOwnBase).toBe(false);
    expect(byName(result.locations, "Hospital A")?.isOwnBase).toBe(false);
    expect(organizationMarkerColor(byName(result.locations, "Red Cross A")!)).toBe(
      OWN_BASE_COLOR,
    );
    expect(organizationMarkerColor(byName(result.locations, "Hospital A")!)).toBe(
      HOSPITAL_COLOR,
    );
  });

  test("community member and unauthenticated visitor get no green organization", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    const community = await t
      .withIdentity({ subject: String(seeded.communityUser) })
      .query(api.profiles.mapLocations, {});
    expect(community.viewerOrganizationId).toBeNull();
    expect(community.locations.some((location) => location.isOwnBase)).toBe(false);

    const visitor = await t.query(api.profiles.mapLocations, {});
    expect(visitor.viewerOrganizationId).toBeNull();
    expect(visitor.locations.some((location) => location.isOwnBase)).toBe(false);
  });

  test("staff without an organization association receives no green base", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const result = await t
      .withIdentity({ subject: String(seeded.noOrgUser) })
      .query(api.profiles.mapLocations, {});
    expect(result.viewerOrganizationId).toBeNull();
    expect(result.locations.some((location) => location.isOwnBase)).toBe(false);
  });

  test("multiple bases belonging to the viewer organization are all green", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const owner = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        name: "Multi Base Owner",
        email: "multi@test.example",
        role: "hospital" as const,
        organizationId: seeded.multiBaseA,
        createdAt: Date.now(),
      }),
    );
    const result = await t
      .withIdentity({ subject: String(owner) })
      .query(api.profiles.mapLocations, {});

    expect(byName(result.locations, "Multi Base One")?.isOwnBase).toBe(true);
    expect(byName(result.locations, "Multi Base Two")?.isOwnBase).toBe(true);
    expect(byName(result.locations, "Hospital A")?.isOwnBase).toBe(false);
  });

  test("another organization's base can never be marked as the viewer's own", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);
    const result = await t
      .withIdentity({ subject: String(seeded.hospitalUser) })
      .query(api.profiles.mapLocations, {});

    expect(result.viewerOrganizationId).toBe(String(seeded.hospitalA));
    const own = result.locations.filter((location) => location.isOwnBase);
    expect(own.map((location) => location.name)).toEqual(["Hospital A"]);
    expect(byName(result.locations, "Hospital B")?.isOwnBase).toBe(false);
    expect(byName(result.locations, "Red Cross A")?.isOwnBase).toBe(false);
  });

  test("unverified organisations and non-map organization types are excluded", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await t.query(api.profiles.mapLocations, {});

    expect(byName(result.locations, "Pending Hospital")).toBeUndefined();
    expect(byName(result.locations, "Blood Bank A")).toBeUndefined();
    expect(result.locations.every((location) => location.status === "verified")).toBe(
      true,
    );
    expect(
      result.locations.every(
        (location) =>
          location.type === "hospital" || location.type === "red_cross",
      ),
    ).toBe(true);
  });

  test("missing and invalid coordinates never become markers and are listed instead", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await t.query(api.profiles.mapLocations, {});

    expect(byName(result.locations, "No Coordinates Hospital")).toBeUndefined();
    expect(byName(result.locations, "Invalid Coordinates Hospital")).toBeUndefined();
    expect(
      result.missingLocations.find(
        (location) => location.name === "No Coordinates Hospital",
      )?.reason,
    ).toBe("Missing registered coordinates");
    expect(
      result.missingLocations.find(
        (location) => location.name === "Invalid Coordinates Hospital",
      )?.reason,
    ).toBe("Invalid registered coordinates");
  });

  test("every organization at duplicate coordinates is preserved for grouped popups", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const result = await t.query(api.profiles.mapLocations, {});
    const sameLocation = result.locations.filter(
      (location) =>
        Math.abs(location.latitude - 18.52) < 1e-9 &&
        Math.abs(location.longitude - 73.85) < 1e-9,
    );
    expect(sameLocation.map((location) => location.name).sort()).toEqual([
      "Hospital A",
      "Red Cross At Hospital A",
    ]);
  });
});

describe("organization map helpers", () => {
  const locations: OrganizationLocationLike[] = [
    { id: "1", type: "hospital", isOwnBase: false },
    { id: "2", type: "hospital", isOwnBase: true },
    { id: "3", type: "red_cross", isOwnBase: false },
    { id: "4", type: "red_cross", isOwnBase: false },
  ];

  test("marker colours: green own base, blue hospital, red Red Cross, distinct GPS", () => {
    expect(organizationMarkerColor(locations[0])).toBe(HOSPITAL_COLOR);
    expect(organizationMarkerColor(locations[1])).toBe(OWN_BASE_COLOR);
    expect(organizationMarkerColor(locations[2])).toBe(RED_CROSS_COLOR);
    expect(new Set([HOSPITAL_COLOR, RED_CROSS_COLOR, OWN_BASE_COLOR]).size).toBe(3);
    expect(GPS_COLOR).not.toBe(HOSPITAL_COLOR);
    expect(GPS_COLOR).not.toBe(RED_CROSS_COLOR);
    expect(GPS_COLOR).not.toBe(OWN_BASE_COLOR);
  });

  test("filters keep colours and identities intact and report accurate counts", () => {
    expect(filterOrganizationLocations(locations, "all")).toHaveLength(4);
    expect(
      filterOrganizationLocations(locations, "hospital").map((l) => l.id),
    ).toEqual(["1", "2"]);
    expect(
      filterOrganizationLocations(locations, "red_cross").map((l) => l.id),
    ).toEqual(["3", "4"]);
    expect(filterOrganizationLocations(locations, "own").map((l) => l.id)).toEqual([
      "2",
    ]);
    expect(organizationFilterCounts(locations)).toEqual({
      all: 4,
      hospital: 2,
      red_cross: 2,
      own: 1,
    });
    expect(organizationMarkerColor(locations[2])).toBe(RED_CROSS_COLOR);
  });

  test("duplicate coordinates are grouped without dropping any record", () => {
    const groups = groupByCoordinate([
      { id: "a", lat: 18.52, lng: 73.85 },
      { id: "b", lat: 18.52, lng: 73.85 },
      { id: "c", lat: 18.53, lng: 73.86 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].map((point) => point.id)).toEqual(["a", "b"]);
    expect(groups.flat().map((point) => point.id)).toEqual(["a", "b", "c"]);
  });

  test("coordinate validation rejects missing, out-of-range and non-finite values", () => {
    expect(isValidMapCoordinate(18.52, 73.85)).toBe(true);
    expect(isValidMapCoordinate(undefined, 73.85)).toBe(false);
    expect(isValidMapCoordinate(18.52, null)).toBe(false);
    expect(isValidMapCoordinate(91, 73.85)).toBe(false);
    expect(isValidMapCoordinate(-91, 73.85)).toBe(false);
    expect(isValidMapCoordinate(18.52, 181)).toBe(false);
    expect(isValidMapCoordinate(Number.NaN, 73.85)).toBe(false);
    expect(isValidMapCoordinate(Number.POSITIVE_INFINITY, 73.85)).toBe(false);
  });
});

describe("organization map UI safeguards", () => {
  const mapSource = readFileSync(
    new URL("../src/components/lifelink/NetworkMap.tsx", import.meta.url),
    "utf8",
  );
  const panelSource = readFileSync(
    new URL("../src/components/lifelink/OrganizationMapPanel.tsx", import.meta.url),
    "utf8",
  );

  test("GPS uses the browser API, watches updates and cleans the watcher", () => {
    expect(mapSource).toContain("navigator.geolocation.watchPosition");
    expect(mapSource).toContain("navigator.geolocation.clearWatch");
    expect(mapSource).toContain("accuracy");
    expect(mapSource).toContain("Your current location");
  });

  test("GPS stays client-side and is never written to Convex", () => {
    expect(mapSource).not.toContain("useMutation");
    expect(mapSource).not.toContain("api.");
    expect(mapSource).not.toContain("convex/react");
  });

  test("street and satellite layers both exist with attribution", () => {
    expect(mapSource).toContain("SATELLITE_TILES");
    expect(mapSource).toContain("SATELLITE_ATTRIBUTION");
    expect(mapSource).toContain("OpenStreetMap");
    expect(mapSource).toContain("esri.com");
    expect(mapSource).toContain("setSatellite");
  });

  test("filters include all, hospitals, Red Cross and the viewer's bases", () => {
    expect(panelSource).toContain('"all"');
    expect(panelSource).toContain('"hospital"');
    expect(panelSource).toContain('"red_cross"');
    expect(panelSource).toContain('"own"');
    expect(panelSource).toContain("No organization base is linked to this account.");
    expect(panelSource).toContain("without usable");
  });
});
