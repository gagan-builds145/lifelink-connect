import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  audit,
  getDonorProfile,
  notifyUser,
  requireOrganization,
  requireRedCross,
  requireStaff,
  requireText,
  requireUser,
  roleOf,
} from "./lib/helpers";
import { campStatusValidator, componentValidator } from "./validators";
import { daysSince } from "../lib/blood";

const todayIso = () => new Date().toISOString().slice(0, 10);

export const listPublic = query({
  args: { city: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const camps = await ctx.db.query("bloodCamps").collect();
    const orgs = await ctx.db.query("organizations").collect();
    const orgMap = new Map(orgs.filter((o) => o.status === "verified").map((o) => [o._id, o]));
    const regs = await ctx.db.query("campRegistrations").collect();
    const counts = new Map<string, number>();
    for (const r of regs) {
      if (r.status === "cancelled") continue;
      counts.set(String(r.campId), (counts.get(String(r.campId)) ?? 0) + 1);
    }
    return camps
      .filter((c) => orgMap.has(c.organizationId))
      .filter((c) => c.status !== "cancelled")
      .filter((c) => (args.city ? c.city === args.city : true))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((c) => ({
        _id: c._id,
        title: c.title,
        description: c.description,
        venue: c.venue,
        city: c.city,
        date: c.date,
        startTime: c.startTime,
        endTime: c.endTime,
        capacity: c.capacity,
        registered: counts.get(String(c._id)) ?? 0,
        organizer: c.organizer,
        status: c.status,
        organizationName: orgMap.get(c.organizationId)?.name ?? "",
        isDemo: c.isDemo ?? false,
      }));
  },
});

export const listForOrg = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireStaff(ctx);
    if (!user.organizationId) return [];
    const camps = await ctx.db
      .query("bloodCamps")
      .withIndex("by_organization", (q) => q.eq("organizationId", user.organizationId!))
      .collect();
    const regs = await ctx.db.query("campRegistrations").collect();
    return camps
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((c) => ({
        _id: c._id,
        title: c.title,
        description: c.description,
        venue: c.venue,
        city: c.city,
        date: c.date,
        startTime: c.startTime,
        endTime: c.endTime,
        capacity: c.capacity,
        organizer: c.organizer,
        status: c.status,
        registered: regs.filter(
          (r) => r.campId === c._id && r.status !== "cancelled",
        ).length,
        isDemo: c.isDemo ?? false,
      }));
  },
});

export const createCamp = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    venue: v.string(),
    city: v.string(),
    date: v.string(),
    startTime: v.string(),
    endTime: v.string(),
    capacity: v.number(),
    organizer: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireRedCross(ctx);
    const org = await requireOrganization(ctx, user, ["red_cross", "blood_bank"]);
    const date = new Date(args.date);
    if (Number.isNaN(date.getTime())) throw new Error("Camp date is invalid.");
    if (date.toISOString().slice(0, 10) < todayIso()) {
      throw new Error("Camp date cannot be in the past.");
    }
    if (!Number.isFinite(args.capacity) || args.capacity < 5 || args.capacity > 1000) {
      throw new Error("Capacity must be between 5 and 1000.");
    }
    if (!/^\d{1,2}:\d{2}$/.test(args.startTime) || !/^\d{1,2}:\d{2}$/.test(args.endTime)) {
      throw new Error("Start and end times must use HH:MM.");
    }
    const now = Date.now();
    const campId = await ctx.db.insert("bloodCamps", {
      organizationId: org._id,
      title: requireText(args.title, "Camp title", 3, 140),
      description: requireText(args.description, "Description", 10, 600),
      venue: requireText(args.venue, "Venue", 3, 200),
      city: requireText(args.city, "City", 2, 80),
      date: date.toISOString().slice(0, 10),
      startTime: args.startTime,
      endTime: args.endTime,
      capacity: Math.round(args.capacity),
      organizer: requireText(args.organizer, "Organizer", 2, 140),
      status: "upcoming",
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, {
      actor: user,
      action: "camp.created",
      entityType: "bloodCamp",
      entityId: String(campId),
      detail: `${args.title} on ${args.date} in ${args.city}.`,
      organizationId: org._id,
    });
    return { campId };
  },
});

export const updateCampStatus = mutation({
  args: { campId: v.id("bloodCamps"), status: campStatusValidator },
  handler: async (ctx, args) => {
    const user = await requireRedCross(ctx);
    const org = await requireOrganization(ctx, user, ["red_cross", "blood_bank"]);
    const camp = await ctx.db.get(args.campId);
    if (!camp || camp.organizationId !== org._id) {
      throw new Error("Camp not found for your organization.");
    }
    await ctx.db.patch(camp._id, { status: args.status, updatedAt: Date.now() });
    await audit(ctx, {
      actor: user,
      action: "camp.status",
      entityType: "bloodCamp",
      entityId: String(camp._id),
      detail: `Camp status set to ${args.status}.`,
      organizationId: org._id,
    });
    return { ok: true };
  },
});

export const registrationsForCamp = query({
  args: { campId: v.id("bloodCamps") },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    if (!user.organizationId) return [];
    const camp = await ctx.db.get(args.campId);
    if (!camp || camp.organizationId !== user.organizationId) {
      throw new Error("Camp not found for your organization.");
    }
    const regs = await ctx.db
      .query("campRegistrations")
      .withIndex("by_camp", (q) => q.eq("campId", args.campId))
      .collect();
    const out = [];
    for (const r of regs) {
      const profile = await getDonorProfile(ctx, r.userId);
      const account = await ctx.db.get(r.userId);
      out.push({
        _id: r._id,
        status: r.status,
        createdAt: r.createdAt,
        name: profile?.fullName ?? account?.name ?? "Registered user",
        donorId: profile?.donorId ?? null,
        bloodGroup: profile?.bloodGroup ?? null,
        phone: profile?.shareContact ? profile?.phone ?? null : null,
      });
    }
    return out;
  },
});

export const register = mutation({
  args: { campId: v.id("bloodCamps") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const camp = await ctx.db.get(args.campId);
    if (!camp) throw new Error("Camp not found.");
    if (camp.status === "cancelled" || camp.status === "completed") {
      throw new Error("Registration is closed for this camp.");
    }
    const existing = await ctx.db
      .query("campRegistrations")
      .withIndex("by_camp", (q) => q.eq("campId", camp._id))
      .filter((q) => q.eq(q.field("userId"), user._id))
      .first();
    if (existing && existing.status !== "cancelled") {
      throw new Error("You are already registered for this camp.");
    }
    const regs = await ctx.db
      .query("campRegistrations")
      .withIndex("by_camp", (q) => q.eq("campId", camp._id))
      .collect();
    const active = regs.filter((r) => r.status !== "cancelled").length;
    if (active >= camp.capacity) throw new Error("This camp is full.");

    if (existing) {
      await ctx.db.patch(existing._id, { status: "registered" });
    } else {
      await ctx.db.insert("campRegistrations", {
        campId: camp._id,
        userId: user._id,
        status: "registered",
        createdAt: Date.now(),
      });
    }
    await ctx.db.insert("notifications", {
      userId: user._id,
      title: "Camp registration confirmed",
      body: `You are registered for ${camp.title} on ${camp.date}. Bring a photo ID; final eligibility is assessed on site.`,
      kind: "camp",
      link: "/donation-camps",
      read: false,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

export const cancelRegistration = mutation({
  args: { campId: v.id("bloodCamps") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const reg = await ctx.db
      .query("campRegistrations")
      .withIndex("by_camp", (q) => q.eq("campId", args.campId))
      .filter((q) => q.eq(q.field("userId"), user._id))
      .first();
    if (!reg || reg.status === "cancelled") throw new Error("No active registration found.");
    await ctx.db.patch(reg._id, { status: "cancelled" });
    return { ok: true };
  },
});

export const myRegistrations = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("campRegistrations")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const camps = await ctx.db.query("bloodCamps").collect();
    const map = new Map(camps.map((c) => [c._id, c]));
    return rows
      .filter((r) => map.has(r.campId))
      .map((r) => {
        const camp = map.get(r.campId)!;
        return {
          _id: r._id,
          campId: r.campId,
          status: r.status,
          title: camp.title,
          date: camp.date,
          startTime: camp.startTime,
          venue: camp.venue,
          city: camp.city,
        };
      });
  },
});

export const recordCampDonation = mutation({
  args: {
    campId: v.id("bloodCamps"),
    registrationId: v.id("campRegistrations"),
    component: componentValidator,
    units: v.number(),
    overrideInterval: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireRedCross(ctx);
    const org = await requireOrganization(ctx, user, ["red_cross", "blood_bank"]);
    const camp = await ctx.db.get(args.campId);
    if (!camp || camp.organizationId !== org._id) {
      throw new Error("Camp not found for your organization.");
    }
    const registration = await ctx.db.get(args.registrationId);
    if (!registration || registration.campId !== camp._id) {
      throw new Error("Registration not found for this camp.");
    }
    if (registration.status === "donated") {
      throw new Error("A donation is already recorded for this registration.");
    }
    const donor = await getDonorProfile(ctx, registration.userId);
    if (!donor) throw new Error("This attendee does not have a donor profile.");
    const sinceLast = daysSince(donor.lastDonationDate);
    if (sinceLast != null && sinceLast < 90 && !args.overrideInterval) {
      throw new Error(
        `Only ${sinceLast} day(s) since the last recorded donation. A clinician must explicitly override the 90-day advisory interval.`,
      );
    }
    if (!Number.isFinite(args.units) || args.units < 1 || args.units > 2) {
      throw new Error("Record 1–2 units for a donation.");
    }
    const today = todayIso();
    const donationId = await ctx.db.insert("donations", {
      donorProfileId: donor._id,
      donorUserId: donor.userId,
      organizationId: org._id,
      campId: camp._id,
      donationDate: today,
      component: args.component,
      units: Math.round(args.units),
      recordedByUserId: user._id,
      createdAt: Date.now(),
    });
    await ctx.db.patch(registration._id, { status: "donated" });
    await ctx.db.patch(donor._id, { lastDonationDate: today, updatedAt: Date.now() });
    await notifyUser(ctx, donor.userId, {
      title: "Donation recorded",
      body: `Thank you — ${org.name} recorded your donation at ${camp.title}.`,
      kind: "camp",
      link: "/donor/dashboard",
    });
    await audit(ctx, {
      actor: user,
      action: "camp.donation.recorded",
      entityType: "donation",
      entityId: String(donationId),
      detail: `${args.units} unit(s) recorded for ${donor.donorId} at ${camp.title}.`,
      organizationId: org._id,
    });
    return { donationId };
  },
});

export const campForReceipt = query({
  args: { campId: v.id("bloodCamps") },
  handler: async (ctx, args) => {
    const camp = await ctx.db.get(args.campId);
    if (!camp) return null;
    const org = await ctx.db.get(camp.organizationId);
    return {
      _id: camp._id,
      title: camp.title,
      date: camp.date,
      venue: camp.venue,
      city: camp.city,
      organizer: camp.organizer,
      organizationName: org?.name ?? "",
      role: roleOf(await requireUser(ctx)),
    };
  },
});
