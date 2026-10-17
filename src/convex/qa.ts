import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";

/**
 * TEMPORARY QA HELPERS. These are used only to exercise the backend with
 * `convex run --identity` during development and are removed from the final
 * deployment once the end-to-end check has passed.
 */
export const createUser = mutation({
  args: { email: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .unique();
    if (existing) return { id: existing._id };
    const id = await ctx.db.insert("users", {
      email: args.email,
      name: args.name,
      emailVerificationTime: Date.now(),
      isAnonymous: false,
      createdAt: Date.now(),
    });
    return { id };
  },
});

export const cleanup = mutation({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    const userIdSet = new Set(args.userIds.map(String));
    const orgs = (await ctx.db.query("organizations").collect()).filter(
      (o) => o.createdByUserId && userIdSet.has(String(o.createdByUserId)),
    );
    const orgIds = new Set(orgs.map((o) => String(o._id)));

    const requests = (await ctx.db.query("bloodRequests").collect()).filter(
      (r) =>
        (r.createdByUserId && userIdSet.has(String(r.createdByUserId))) ||
        (r.hospitalOrgId && orgIds.has(String(r.hospitalOrgId))) ||
        (r.assignedOrgId && orgIds.has(String(r.assignedOrgId))),
    );
    const requestIds = new Set(requests.map((r) => String(r._id)));

    const camps = (await ctx.db.query("bloodCamps").collect()).filter((c) =>
      orgIds.has(String(c.organizationId)),
    );

    for (const request of requests) {
      const history = await ctx.db
        .query("requestStatusHistory")
        .withIndex("by_request", (q) => q.eq("requestId", request._id))
        .collect();
      for (const row of history) await ctx.db.delete(row._id);
      const offers = await ctx.db
        .query("donorOffers")
        .withIndex("by_request", (q) => q.eq("requestId", request._id))
        .collect();
      for (const row of offers) await ctx.db.delete(row._id);
      const reservations = await ctx.db
        .query("inventoryReservations")
        .withIndex("by_request", (q) => q.eq("requestId", request._id))
        .collect();
      for (const row of reservations) await ctx.db.delete(row._id);
      const ledger = await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_request", (q) => q.eq("requestId", request._id))
        .collect();
      for (const row of ledger) await ctx.db.delete(row._id);
    }

    const notifications = await ctx.db.query("notifications").collect();
    for (const row of notifications) {
      if (
        userIdSet.has(String(row.userId)) ||
        (row.requestId && requestIds.has(String(row.requestId)))
      ) {
        await ctx.db.delete(row._id);
      }
    }

    const audits = await ctx.db.query("auditLogs").collect();
    for (const row of audits) {
      if (
        (row.actorUserId && userIdSet.has(String(row.actorUserId))) ||
        (row.organizationId && orgIds.has(String(row.organizationId)))
      ) {
        await ctx.db.delete(row._id);
      }
    }

    for (const camp of camps) {
      const regs = await ctx.db
        .query("campRegistrations")
        .withIndex("by_camp", (q) => q.eq("campId", camp._id))
        .collect();
      for (const reg of regs) await ctx.db.delete(reg._id);
      await ctx.db.delete(camp._id);
    }

    for (const org of orgs) {
      const inventory = await ctx.db
        .query("inventory")
        .withIndex("by_organization", (q) => q.eq("organizationId", org._id))
        .collect();
      for (const item of inventory) await ctx.db.delete(item._id);
      const ledger = await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_organization", (q) => q.eq("organizationId", org._id))
        .collect();
      for (const row of ledger) await ctx.db.delete(row._id);
    }

    for (const request of requests) await ctx.db.delete(request._id);

    for (const userId of args.userIds) {
      const donor = await ctx.db
        .query("donorProfiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (donor) {
        const donations = await ctx.db
          .query("donations")
          .withIndex("by_donor_user", (q) => q.eq("donorUserId", userId))
          .collect();
        for (const donation of donations) await ctx.db.delete(donation._id);
        await ctx.db.delete(donor._id);
      }
      const requestor = await ctx.db
        .query("requestorProfiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (requestor) await ctx.db.delete(requestor._id);
      const regs = await ctx.db
        .query("campRegistrations")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const reg of regs) await ctx.db.delete(reg._id);
    }

    for (const org of orgs) await ctx.db.delete(org._id);
    for (const user of args.userIds) await ctx.db.delete(user);

    return { cleaned: args.userIds.length, organizations: orgs.length, requests: requests.length };
  },
});

export type QaUserId = Id<"users">;
