import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import {
  optionalUser,
  roleOf,
  safeError,
  type AppUser,
} from "./lib/helpers";

/**
 * Security monitoring surface for authorized administrators.
 *
 * These queries and the resolution mutation are intentionally narrow:
 * they expose only security-event metadata, never patient names, donor
 * contacts, tokens or one-time codes. Operational business audit detail
 * continues to live in auditLogs.
 */

export const recentSecurityEvents = query({
  args: {
    limit: v.optional(v.number()),
    service: v.optional(
      v.union(
        v.literal("web"),
        v.literal("auth"),
        v.literal("convex_api"),
        v.literal("ml_service"),
        v.literal("drone_ops"),
        v.literal("integration"),
      ),
    ),
    kind: v.optional(
      v.union(
        v.literal("auth_failure"),
        v.literal("brute_force_suspect"),
        v.literal("otp_rate_limited"),
        v.literal("unauthorized_access"),
        v.literal("cross_user_access_denied"),
        v.literal("malformed_request"),
        v.literal("oversized_request"),
        v.literal("inventory_transfer_denied"),
        v.literal("ml_auth_failure"),
        v.literal("drone_command_denied"),
        v.literal("drone_command_replay_suspect"),
        v.literal("waf_blocked"),
        v.literal("rate_limited"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await ensureSecurityAdmin(ctx);
    const limit = Math.max(1, Math.min(200, args.limit ?? 50));
    if (args.kind != null && args.service != null) {
      const rows = (await ctx.db
        .query("securityEvents")
        .withIndex("by_service", (q) => q.eq("service", args.service))
        .collect())
        .filter((r) => r.kind === args.kind)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
      return rows.map((r) => mapEvent(r));
    }
    if (args.service != null) {
      const rows = (await ctx.db
        .query("securityEvents")
        .withIndex("by_service", (q) => q.eq("service", args.service))
        .collect())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
      return rows.map((r) => mapEvent(r));
    }
    if (args.kind != null) {
      const rows = (await ctx.db
        .query("securityEvents")
        .withIndex("by_kind", (q) => q.eq("kind", args.kind))
        .collect())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
      return rows.map((r) => mapEvent(r));
    }
    const rows = await ctx.db
      .query("securityEvents")
      .order("desc")
      .take(limit);
    return rows.map((r) => mapEvent(r));
  },
});

export const securityEventCounts = query({
  args: {
    service: v.optional(
      v.union(
        v.literal("web"),
        v.literal("auth"),
        v.literal("convex_api"),
        v.literal("ml_service"),
        v.literal("drone_ops"),
        v.literal("integration"),
      ),
    ),
  },
  handler: async (ctx, _args) => {
    await ensureSecurityAdmin(ctx);
    const rows = await ctx.db.query("securityEvents").collect();
    const byKind: Record<string, number> = {};
    const byService: Record<string, number> = {};
    let total = 0;
    let resolved = 0;
    let unresolved = 0;
    for (const row of rows) {
      total += 1;
      if (row.resolvedAt) resolved += 1;
      else unresolved += 1;
      byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
      byService[row.service] = (byService[row.service] ?? 0) + 1;
    }
    return {
      total,
      resolved,
      unresolved,
      byKind,
      byService,
    };
  },
});

export const unresolvedSecurityEventCount = query({
  args: {},
  handler: async (ctx) => {
    await ensureSecurityAdmin(ctx);
    let count = 0;
    for (const row of await ctx.db.query("securityEvents").collect()) {
      if (!row.resolvedAt) count += 1;
    }
    return count;
  },
});

export const resolveSecurityEvent = mutation({
  args: {
    eventId: v.id("securityEvents"),
    action: v.union(v.literal("acknowledge"), v.literal("resolve")),
  },
  handler: async (ctx, args) => {
    const user = await ensureSecurityAdmin(ctx);
    const event = await ctx.db.get(args.eventId);
    if (!event) throw safeError("Security event not found.");
    const now = Date.now();
    const patch: Record<string, unknown> = {
      actedByAdminId: user._id,
    };
    if (args.action === "resolve") {
      patch.resolvedAt = now;
    }
    await ctx.db.patch(args.eventId, patch);
    return {
      ok: true,
      action: args.action,
      resolvedAt: args.action === "resolve" ? now : event.resolvedAt ?? null,
    };
  },
});

function mapEvent(r: Doc<"securityEvents">) {
  return {
    _id: r._id,
    kind: r.kind,
    severity: r.severity,
    service: r.service,
    reason: r.reason,
    summary: r.summary,
    clientRef: r.clientRef ?? null,
    entityType: r.entityType ?? null,
    entityId: r.entityId ?? null,
    organizationId: r.organizationId ?? null,
    actedByAdminId: r.actedByAdminId ?? null,
    resolvedAt: r.resolvedAt ?? null,
    createdAt: r.createdAt,
  };
}

async function ensureSecurityAdmin(ctx: QueryCtx | MutationCtx): Promise<AppUser> {
  const user = await optionalUser(ctx);
  if (!user || roleOf(user) !== "admin") {
    throw safeError("Only administrators can access security monitoring.");
  }
  return user;
}
