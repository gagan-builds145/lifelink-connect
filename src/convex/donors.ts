import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  audit,
  getDonorProfile,
  notifyUser,
  requireOrganization,
  requireRole,
  requireUser,
  roleOf,
} from "./lib/helpers";
import { bloodGroupValidator, componentValidator } from "./validators";
import { daysSince, donationGuidance } from "../lib/blood";

export const directory = query({
  args: {
    bloodGroup: v.optional(bloodGroupValidator),
    city: v.optional(v.string()),
    availableOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["red_cross", "admin"]);
    const rows = await ctx.db.query("donorProfiles").collect();
    return rows
      .filter((d) => (args.bloodGroup ? d.bloodGroup === args.bloodGroup : true))
      .filter((d) => (args.city ? d.city === args.city : true))
      .filter((d) => (args.availableOnly ? d.available : true))
      .sort((a, b) => Number(b.available) - Number(a.available))
      .map((d) => {
        const canSeeContact = d.shareContact && roleOf(user) === "red_cross";
        return {
          _id: d._id,
          donorId: d.donorId,
          fullName: canSeeContact ? d.fullName : "Donor (contact protected)",
          bloodGroup: d.bloodGroup,
          city: d.city,
          area: d.area ?? null,
          available: d.available,
          lastDonationDate: d.lastDonationDate ?? null,
          preferredCenter: d.preferredCenter ?? null,
          phone: canSeeContact ? d.phone : null,
          email: canSeeContact ? d.email ?? null : null,
          shareContact: d.shareContact,
          guidance: donationGuidance(d.lastDonationDate),
          isDemo: d.isDemo ?? false,
        };
      });
  },
});

export const recordDonation = mutation({
  args: {
    donorProfileId: v.id("donorProfiles"),
    component: componentValidator,
    units: v.number(),
    donationDate: v.string(),
    note: v.optional(v.string()),
    overrideInterval: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["red_cross", "hospital", "admin"]);
    const org = await requireOrganization(ctx, user, ["red_cross", "hospital", "blood_bank"]);
    const donor = await ctx.db.get(args.donorProfileId);
    if (!donor) throw new Error("Donor profile not found.");
    if (!Number.isFinite(args.units) || args.units < 1 || args.units > 2) {
      throw new Error("A donation records 1–2 units.");
    }
    const date = new Date(args.donationDate);
    if (Number.isNaN(date.getTime())) throw new Error("Donation date is invalid.");
    if (date.getTime() > Date.now() + 86_400_000) {
      throw new Error("Donation date cannot be in the future.");
    }
    const sinceLast = daysSince(donor.lastDonationDate);
    if (sinceLast != null && sinceLast < 90 && !args.overrideInterval) {
      throw new Error(
        `Only ${sinceLast} day(s) since the last recorded donation. 90 days is the advisory interval; a clinician must explicitly override.`,
      );
    }

    const isoDate = date.toISOString().slice(0, 10);
    const donationId = await ctx.db.insert("donations", {
      donorProfileId: donor._id,
      donorUserId: donor.userId,
      organizationId: org._id,
      donationDate: isoDate,
      component: args.component,
      units: Math.round(args.units),
      recordedByUserId: user._id,
      note: args.note,
      createdAt: Date.now(),
    });
    await ctx.db.patch(donor._id, {
      lastDonationDate: isoDate,
      updatedAt: Date.now(),
    });
    await notifyUser(ctx, donor.userId, {
      title: "Donation recorded",
      body: `${org.name} recorded your donation on ${isoDate}. Thank you for saving lives.`,
      kind: "system",
      link: "/donor/dashboard",
    });
    await audit(ctx, {
      actor: user,
      action: "donation.recorded",
      entityType: "donation",
      entityId: String(donationId),
      detail: `${args.units} unit(s) recorded for ${donor.donorId} on ${isoDate}.`,
      organizationId: org._id,
    });
    return { donationId };
  },
});

export const myDonations = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) return { donations: [], totalUnits: 0, guidance: donationGuidance(null) };
    const rows = await ctx.db
      .query("donations")
      .withIndex("by_donor_user", (q) => q.eq("donorUserId", user._id))
      .collect();
    const orgs = await ctx.db.query("organizations").collect();
    const orgMap = new Map(orgs.map((o) => [o._id, o.name]));
    const donations = rows
      .sort((a, b) => b.donationDate.localeCompare(a.donationDate))
      .map((d) => ({
        _id: d._id,
        donationDate: d.donationDate,
        component: d.component,
        units: d.units,
        organizationName: d.organizationId ? orgMap.get(d.organizationId) ?? "LifeLink partner" : "LifeLink partner",
        note: d.note ?? null,
        isDemo: d.isDemo ?? false,
      }));
    return {
      donations,
      totalUnits: donations.reduce((sum, d) => sum + d.units, 0),
      guidance: donationGuidance(donor.lastDonationDate),
    };
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) return null;
    const donations = await ctx.db
      .query("donations")
      .withIndex("by_donor_user", (q) => q.eq("donorUserId", user._id))
      .collect();
    const offers = await ctx.db
      .query("donorOffers")
      .withIndex("by_donor", (q) => q.eq("donorUserId", user._id))
      .collect();
    return {
      donorId: donor.donorId,
      donationCount: donations.length,
      totalUnits: donations.reduce((s, d) => s + d.units, 0),
      activeOffers: offers.filter((o) => o.status === "offered").length,
      lastDonationDate: donor.lastDonationDate ?? null,
      guidance: donationGuidance(donor.lastDonationDate),
      available: donor.available,
    };
  },
});
