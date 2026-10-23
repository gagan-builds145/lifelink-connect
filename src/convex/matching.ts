import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireUser, roleOf } from "./lib/helpers";
import {
  AI_MODEL_STATUS,
  MATCHING_DISCLAIMER,
  cityCoords,
  compatibility,
  daysSince,
  haversineKm,
  locationRule,
  scoreMatch,
} from "../lib/blood";

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Advisory ranking only. The caller must be the request owner or authorized
 * staff; no donor contact details are exposed to hospitals, and donor contacts
 * are shared only when the donor opted in and the caller is Red Cross staff.
 */
export const forRequest = query({
  args: { requestId: v.id("bloodRequests") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found.");
    const role = roleOf(user);
    const canView =
      request.createdByUserId === user._id ||
      role === "admin" ||
      role === "red_cross" ||
      (role === "hospital" &&
        user.organizationId != null &&
        (request.hospitalOrgId === user.organizationId ||
          request.assignedOrgId === user.organizationId));
    if (!canView) throw new Error("You are not authorized to run matching for this request.");

    const requestCity = cityCoords(request.city);
    const orgs = await ctx.db.query("organizations").collect();
    const verifiedOrgs = new Map(
      orgs.filter((o) => o.status === "verified").map((o) => [o._id, o]),
    );
    const inventory = await ctx.db.query("inventory").collect();

    const inventoryMatches = inventory
      .map((item) => {
        const org = verifiedOrgs.get(item.organizationId);
        if (!org || !item.verified) return null;
        if (item.expiryDate < todayIso()) return null;
        const free = item.unitsAvailable - item.unitsReserved;
        if (free <= 0) return null;
        const compat = compatibility(item.bloodGroup, request.bloodGroup, request.component);
        if (!compat.compatible) return null;
        // Same state always; the same city unless this is an emergency.
        if (!locationRule(org.city, request.city, request.urgency).ok) return null;
        const coords = cityCoords(org.city);
        const distanceKm =
          requestCity && coords ? Math.round(haversineKm(requestCity, coords) * 10) / 10 : null;
        const expiresInDays = Math.ceil(
          (new Date(item.expiryDate).getTime() - Date.now()) / 86_400_000,
        );
        const ranked = scoreMatch({
          compatible: true,
          sameCity: org.city === request.city,
          distanceKm,
          urgency: request.urgency,
          availableUnits: free,
          verified: item.verified,
          expiresInDays,
        });
        return {
          kind: "inventory" as const,
          id: String(item._id),
          organizationId: org._id,
          title: org.name,
          subtitle: `${item.bloodGroup} ${item.component.replace("_", " ")} · batch ${item.batchRef}`,
          bloodGroup: item.bloodGroup,
          component: item.component,
          city: org.city,
          distanceKm,
          freeUnits: free,
          expiryDate: item.expiryDate,
          lastUpdated: item.lastUpdated,
          score: ranked.score,
          reasons: ranked.reasons,
          warnings: [...ranked.warnings, compat.note],
          isDemo: (item.isDemo ?? false) || (org.isDemo ?? false),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => b.score - a.score);

    const donors = await ctx.db.query("donorProfiles").collect();
    const donorMatches = donors
      .map((donor) => {
        if (!donor.available) return null;
        const compat = compatibility(donor.bloodGroup, request.bloodGroup, request.component);
        if (!compat.compatible) return null;
        // Same state always; the same city unless this is an emergency.
        if (!locationRule(donor.city, request.city, request.urgency).ok) return null;
        const coords = cityCoords(donor.city);
        const distanceKm =
          requestCity && coords ? Math.round(haversineKm(requestCity, coords) * 10) / 10 : null;
        const since = daysSince(donor.lastDonationDate);
        const eligible = since == null || since >= 90;
        const ranked = scoreMatch({
          compatible: true,
          sameCity: donor.city === request.city,
          distanceKm,
          urgency: request.urgency,
          eligible,
          verified: true,
        });
        const shareContact = donor.shareContact && role === "red_cross";
        return {
          kind: "donor" as const,
          id: String(donor._id),
          donorId: donor.donorId,
          title: shareContact ? donor.fullName : "Verified donor (protected)",
          bloodGroup: donor.bloodGroup,
          city: donor.city,
          distanceKm,
          lastDonationDate: donor.lastDonationDate ?? null,
          phone: shareContact ? donor.phone : null,
          eligible,
          score: ranked.score,
          reasons: ranked.reasons,
          warnings: [...ranked.warnings, compat.note],
          isDemo: donor.isDemo ?? false,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);

    const lastUpdated = Math.max(
      request.updatedAt,
      ...inventoryMatches.map((m) => m.lastUpdated),
      0,
    );

    return {
      request: {
        _id: request._id,
        requestId: request.requestId,
        bloodGroup: request.bloodGroup,
        component: request.component,
        units: request.units,
        city: request.city,
        urgency: request.urgency,
        status: request.status,
      },
      inventoryMatches,
      donorMatches,
      lastUpdated,
      modelStatus: AI_MODEL_STATUS,
      disclaimer: MATCHING_DISCLAIMER,
      viewerRole: role,
    };
  },
});

export const compatibilityMatrix = query({
  args: { component: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const components = ["whole_blood", "red_cells", "platelets", "plasma"];
    const groups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
    const component = components.includes(args.component ?? "") ? args.component! : "red_cells";
    return {
      component,
      rows: groups.map((recipient) => ({
        recipient,
        donors: groups.filter(
          (donor) => compatibility(donor, recipient, component).compatible,
        ),
      })),
      notes: MATCHING_DISCLAIMER,
    };
  },
});

type RequestDoc = Doc<"bloodRequests">;
export type MatchingRequest = RequestDoc;
