import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { optionalUser, requireUser } from "./lib/helpers";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 40)
      .map((n) => ({
        _id: n._id,
        title: n.title,
        body: n.body,
        kind: n.kind,
        link: n.link ?? null,
        requestId: n.requestId ?? null,
        read: n.read,
        createdAt: n.createdAt,
      }));
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return 0;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id).eq("read", false))
      .collect();
    return rows.length;
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.userId !== user._id) {
      throw new Error("Notification not found.");
    }
    await ctx.db.patch(notification._id, { read: true });
    return { ok: true };
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id).eq("read", false))
      .collect();
    for (const row of rows) {
      await ctx.db.patch(row._id, { read: true });
    }
    return { updated: rows.length };
  },
});
