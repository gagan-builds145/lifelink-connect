import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { BLOOD_GROUPS, COMPONENTS, citiesInState, stateOfCity } from "../lib/blood";
import {
  audit,
  requireOrganization,
  requireRole,
  requireStaff,
  requireText,
  requireUnits,
  requireUser,
  roleOf,
} from "./lib/helpers";
import {
  bloodGroupValidator,
  componentValidator,
  transactionTypeValidator,
} from "./validators";
import { evaluateStockLevel } from "./lib/stockWatch";

const todayIso = () => new Date().toISOString().slice(0, 10);

const daysUntil = (dateStr: string) =>
  Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);

function decorate(
  item: Doc<"inventory">,
  orgName: string,
) {
  const free = item.unitsAvailable - item.unitsReserved;
  const expiryDays = daysUntil(item.expiryDate);
  return {
    ...item,
    free,
    organizationName: orgName,
    isLowStock: free <= item.lowStockThreshold,
    isExpiring: expiryDays >= 0 && expiryDays <= 10,
    isExpired: expiryDays < 0,
    expiryDays,
  };
}

export const listForOrg = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireStaff(ctx);
    const organizationId = user.organizationId;
    if (!organizationId) return [];
    const org = await ctx.db.get(organizationId);
    if (!org) return [];
    const rows = await ctx.db
      .query("inventory")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .collect();
    return rows
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
      .map((item) => decorate(item, org.name));
  },
});

export const alerts = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireStaff(ctx);
    const organizationId = user.organizationId;
    if (!organizationId) return { lowStock: [], expiring: [], verifiedCount: 0 };
    const org = await ctx.db.get(organizationId);
    const rows = await ctx.db
      .query("inventory")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .collect();
    const decorated = rows.map((r) => decorate(r, org?.name ?? ""));
    return {
      lowStock: decorated.filter((r) => r.isLowStock && !r.isExpired),
      expiring: decorated.filter((r) => r.isExpiring),
      verifiedCount: decorated.filter((r) => r.verified).length,
    };
  },
});

/**
 * Automatic low-stock escalations raised for this organization. Each row shows
 * how many nearby hospitals, Red Cross sources and donors the request reached.
 */
export const openStockAlerts = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireStaff(ctx);
    const organizationId = user.organizationId;
    if (!organizationId) return [];
    const rows = await ctx.db
      .query("stockAlerts")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .collect();
    return rows
      .sort((a, b) => Number(b.status === "open") - Number(a.status === "open") || b.updatedAt - a.updatedAt)
      .slice(0, 20)
      .map((a) => ({
        _id: a._id,
        bloodGroup: a.bloodGroup,
        component: a.component,
        freeUnits: a.freeUnits,
        threshold: a.threshold,
        requestedUnits: a.requestedUnits,
        level: a.level,
        reason: a.reason ?? "low_stock",
        status: a.status,
        city: a.city,
        hospitalsRequested: a.hospitalOrgIds.length,
        redCrossRequested: a.redCrossOrgIds.length,
        donorsNotified: a.donorsNotified,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }));
  },
});

/**
 * What is usable on the shelf right now: how many of the eight blood groups
 * and four components hold units, the next storage deadline, and the batches
 * whose deadline has already passed. Drives the "types available" panel on
 * the hospital and Red Cross dashboards.
 */
export const typeCoverage = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireStaff(ctx);
    const organizationId = user.organizationId;
    if (!organizationId) return null;
    const rows = await ctx.db
      .query("inventory")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .collect();
    const today = todayIso();
    const usable = rows.filter((r) => r.verified && r.expiryDate >= today);
    const freeOf = (r: Doc<"inventory">) => Math.max(0, r.unitsAvailable - r.unitsReserved);

    const byGroup = BLOOD_GROUPS.map((group) => {
      const batches = usable.filter((r) => r.bloodGroup === group);
      const free = batches.reduce((sum, r) => sum + freeOf(r), 0);
      const components = COMPONENTS.filter((component) =>
        batches.some((r) => r.component === component && freeOf(r) > 0),
      );
      return {
        bloodGroup: group,
        free,
        components,
        inStock: free > 0,
        batches: batches.length,
      };
    });

    const withStock = usable.filter((r) => freeOf(r) > 0).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    const expired = rows.filter((r) => r.expiryDate < today && freeOf(r) > 0);
    const dueSoon = withStock.filter((r) => daysUntil(r.expiryDate) <= 7);

    return {
      bloodGroupCount: BLOOD_GROUPS.length,
      groupsInStock: byGroup.filter((g) => g.inStock).length,
      componentCount: COMPONENTS.length,
      componentsInStock: new Set(usable.filter((r) => freeOf(r) > 0).map((r) => r.component)).size,
      totalFree: byGroup.reduce((sum, g) => sum + g.free, 0),
      byGroup,
      nextDeadline: withStock[0]?.expiryDate ?? null,
      dueSoonBatches: dueSoon.length,
      expiredBatches: expired.length,
      expiredUnits: expired.reduce((sum, r) => sum + freeOf(r), 0),
    };
  },
});

/**
 * Daily storage-deadline sweep, scheduled from crons.ts. Batches whose
 * deadline has passed stop counting as usable stock, so re-checking each
 * group here raises the automatic network request even on days when nobody
 * touches the inventory. Returns a small summary for the scheduler log.
 */
export const expirySweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = todayIso();
    const orgs = (await ctx.db.query("organizations").collect()).filter(
      (o) => o.status === "verified",
    );
    let groupsSwept = 0;
    let openAlerts = 0;
    for (const org of orgs) {
      const batches = await ctx.db
        .query("inventory")
        .withIndex("by_organization", (q) => q.eq("organizationId", org._id))
        .collect();
      if (batches.length === 0) continue;
      const pairs = new Map<
        string,
        { group: Doc<"inventory">["bloodGroup"]; component: Doc<"inventory">["component"] }
      >();
      for (const batch of batches) {
        pairs.set(`${batch.bloodGroup}:${batch.component}`, {
          group: batch.bloodGroup,
          component: batch.component,
        });
      }
      for (const pair of pairs.values()) {
        const passedDeadline = batches.some(
          (b) =>
            b.bloodGroup === pair.group &&
            b.component === pair.component &&
            b.expiryDate < today,
        );
        if (!passedDeadline) continue;
        await evaluateStockLevel(ctx, org, pair.group, pair.component, "deadline");
        groupsSwept += 1;
        openAlerts += 1;
      }
    }
    return { organizationsChecked: orgs.length, groupsSwept, openAlerts };
  },
});

/**
 * Open network requests this organization was asked to help with: hospitals see
 * requests raised by other hospitals, Red Cross sources see requests raised by
 * hospitals. Red Cross shortfalls never appear here.
 */
export const inboundStockAlerts = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireStaff(ctx);
    const organizationId = user.organizationId;
    const role = roleOf(user);
    if (!organizationId) return [];
    if (role !== "hospital" && role !== "red_cross") return [];
    const rows = await ctx.db
      .query("stockAlerts")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
    const relevant = rows.filter(
      (a) =>
        a.organizationId !== organizationId &&
        (role === "hospital"
          ? a.hospitalOrgIds.includes(organizationId)
          : a.redCrossOrgIds.includes(organizationId)),
    );
    const orgs = await ctx.db.query("organizations").collect();
    const names = new Map(orgs.map((o) => [o._id, o.name]));
    return relevant
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)
      .map((a) => ({
        _id: a._id,
        organizationName: names.get(a.organizationId) ?? "Network organization",
        city: a.city,
        bloodGroup: a.bloodGroup,
        component: a.component,
        freeUnits: a.freeUnits,
        threshold: a.threshold,
        requestedUnits: a.requestedUnits,
        level: a.level,
        updatedAt: a.updatedAt,
      }));
  },
});

export const addStock = mutation({
  args: {
    bloodGroup: bloodGroupValidator,
    component: componentValidator,
    unitsAvailable: v.number(),
    collectionDate: v.string(),
    expiryDate: v.string(),
    storageLocation: v.string(),
    batchRef: v.optional(v.string()),
    lowStockThreshold: v.number(),
  },
  handler: async (ctx, args) => {
    // Hospitals record their own storage so a shortfall can be detected before
    // the ward runs out, not only at Red Cross branches.
    const user = await requireRole(ctx, ["red_cross", "hospital", "admin"]);
    const org = await requireOrganization(ctx, user, ["red_cross", "blood_bank", "hospital"]);
    const units = requireUnits(args.unitsAvailable);
    if (!Number.isFinite(args.lowStockThreshold) || args.lowStockThreshold < 0) {
      throw new Error("Low stock threshold must be zero or more.");
    }
    const collection = new Date(args.collectionDate);
    const expiry = new Date(args.expiryDate);
    if (Number.isNaN(collection.getTime()) || Number.isNaN(expiry.getTime())) {
      throw new Error("Collection and expiry dates must be valid.");
    }
    if (expiry <= collection) throw new Error("Expiry must be after collection.");
    if (expiry.getTime() < Date.now()) throw new Error("Cannot add already-expired stock.");

    const now = Date.now();
    const id = await ctx.db.insert("inventory", {
      organizationId: org._id,
      bloodGroup: args.bloodGroup,
      component: args.component,
      unitsAvailable: units,
      unitsReserved: 0,
      collectionDate: collection.toISOString().slice(0, 10),
      expiryDate: expiry.toISOString().slice(0, 10),
      storageLocation: requireText(args.storageLocation, "Storage location", 3, 120),
      batchRef: args.batchRef?.trim() || `B-${now.toString(36).toUpperCase()}`,
      lowStockThreshold: Math.round(args.lowStockThreshold),
      verified: true,
      lastUpdated: now,
      createdAt: now,
    });
    await ctx.db.insert("inventoryTransactions", {
      inventoryId: id,
      organizationId: org._id,
      type: "collection",
      units,
      bloodGroup: args.bloodGroup,
      component: args.component,
      actorUserId: user._id,
      actorRole: roleOf(user),
      note: "Stock added by authorized staff",
      createdAt: now,
    });
    await audit(ctx, {
      actor: user,
      action: "inventory.added",
      entityType: "inventory",
      entityId: String(id),
      detail: `${units} unit(s) of ${args.bloodGroup} ${args.component} added, expiry ${args.expiryDate}.`,
      organizationId: org._id,
    });
    await evaluateStockLevel(ctx, org, args.bloodGroup, args.component);
    return { id };
  },
});

export const updateStock = mutation({
  args: {
    inventoryId: v.id("inventory"),
    unitsAvailable: v.optional(v.number()),
    expiryDate: v.optional(v.string()),
    storageLocation: v.optional(v.string()),
    lowStockThreshold: v.optional(v.number()),
    verified: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["red_cross", "hospital", "admin"]);
    const org = await requireOrganization(ctx, user, ["red_cross", "blood_bank", "hospital"]);
    const item = await ctx.db.get(args.inventoryId);
    if (!item || item.organizationId !== org._id) {
      throw new Error("Inventory batch not found for your organization.");
    }
    const patch: Record<string, unknown> = { lastUpdated: Date.now() };
    let delta = 0;
    if (args.unitsAvailable !== undefined) {
      if (!Number.isFinite(args.unitsAvailable) || args.unitsAvailable < 0) {
        throw new Error("Units cannot be negative.");
      }
      if (args.unitsAvailable < item.unitsReserved) {
        throw new Error(
          `Cannot set stock below the ${item.unitsReserved} reserved unit(s).`,
        );
      }
      delta = args.unitsAvailable - item.unitsAvailable;
      patch.unitsAvailable = args.unitsAvailable;
    }
    if (args.expiryDate !== undefined) {
      const d = new Date(args.expiryDate);
      if (Number.isNaN(d.getTime())) throw new Error("Deadline must be a valid date.");
      if (d < new Date(item.collectionDate)) {
        throw new Error("Deadline cannot be before the collection date of this batch.");
      }
      patch.expiryDate = d.toISOString().slice(0, 10);
    }
    if (args.storageLocation !== undefined) {
      patch.storageLocation = requireText(args.storageLocation, "Storage location", 3, 120);
    }
    if (args.lowStockThreshold !== undefined) {
      if (args.lowStockThreshold < 0) throw new Error("Threshold cannot be negative.");
      patch.lowStockThreshold = Math.round(args.lowStockThreshold);
    }
    if (args.verified !== undefined) patch.verified = args.verified;
    await ctx.db.patch(item._id, patch);

    if (delta !== 0) {
      await ctx.db.insert("inventoryTransactions", {
        inventoryId: item._id,
        organizationId: org._id,
        type: "adjustment",
        units: delta,
        bloodGroup: item.bloodGroup,
        component: item.component,
        actorUserId: user._id,
        actorRole: roleOf(user),
        note: args.note ?? "Manual stock adjustment",
        createdAt: Date.now(),
      });
    }
    await audit(ctx, {
      actor: user,
      action: "inventory.updated",
      entityType: "inventory",
      entityId: String(item._id),
      detail: `Batch ${item.batchRef} updated${delta ? ` (${delta > 0 ? "+" : ""}${delta} units)` : ""}.`,
      organizationId: org._id,
    });
    await evaluateStockLevel(ctx, org, item.bloodGroup, item.component);
    return { ok: true };
  },
});

export const recordMovement = mutation({
  args: {
    inventoryId: v.id("inventory"),
    type: v.union(v.literal("collection"), v.literal("issue"), v.literal("expiry")),
    units: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["red_cross", "hospital", "admin"]);
    const org = await requireOrganization(ctx, user, ["red_cross", "blood_bank", "hospital"]);
    const item = await ctx.db.get(args.inventoryId);
    if (!item || item.organizationId !== org._id) {
      throw new Error("Inventory batch not found for your organization.");
    }
    const units = requireUnits(args.units);
    const now = Date.now();
    if (args.type !== "collection") {
      const free = item.unitsAvailable - item.unitsReserved;
      if (units > free) {
        throw new Error(`Only ${free} unreserved unit(s) can be removed.`);
      }
      await ctx.db.patch(item._id, {
        unitsAvailable: item.unitsAvailable - units,
        lastUpdated: now,
      });
    } else {
      await ctx.db.patch(item._id, {
        unitsAvailable: item.unitsAvailable + units,
        lastUpdated: now,
      });
    }
    await ctx.db.insert("inventoryTransactions", {
      inventoryId: item._id,
      organizationId: org._id,
      type: args.type,
      units,
      bloodGroup: item.bloodGroup,
      component: item.component,
      actorUserId: user._id,
      actorRole: roleOf(user),
      note: requireText(args.note ?? `${args.type} recorded by staff`, "Note", 3, 300),
      createdAt: now,
    });
    await audit(ctx, {
      actor: user,
      action: `inventory.${args.type}`,
      entityType: "inventory",
      entityId: String(item._id),
      detail: `${units} unit(s) ${args.type} for batch ${item.batchRef}.`,
      organizationId: org._id,
    });
    await evaluateStockLevel(ctx, org, item.bloodGroup, item.component);
    return { ok: true };
  },
});

export const transactions = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireStaff(ctx);
    const organizationId = user.organizationId;
    if (!organizationId) return [];
    const org = await ctx.db.get(organizationId);
    const rows = await ctx.db
      .query("inventoryTransactions")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100)
      .map((t) => ({
        _id: t._id,
        type: t.type,
        units: t.units,
        bloodGroup: t.bloodGroup,
        component: t.component,
        note: t.note ?? null,
        actorRole: t.actorRole,
        createdAt: t.createdAt,
        organizationName: org?.name ?? "",
        requestId: t.requestId ?? null,
        isDemo: t.isDemo ?? false,
      }));
  },
});

/**
 * Public-safe availability. Only verified organizations, only verified
 * non-expired batches, no batch/storage/contact details for the public.
 */
export const publicStock = query({
  args: {
    bloodGroup: v.optional(bloodGroupValidator),
    component: v.optional(componentValidator),
    city: v.optional(v.string()),
    // City-first by default. "state" and "country" widen the same search and
    // are intended for emergency requests only.
    scope: v.optional(
      v.union(v.literal("city"), v.literal("state"), v.literal("country")),
    ),
  },
  handler: async (ctx, args) => {
    const orgs = await ctx.db.query("organizations").collect();
    const verified = new Map(
      orgs.filter((o) => o.status === "verified").map((o) => [o._id, o]),
    );
    const scope = args.scope ?? "city";
    const allowedCities = (() => {
      if (scope === "country" || !args.city) return null;
      if (scope === "state") {
        const cities = citiesInState(stateOfCity(args.city));
        return new Set(cities.length > 0 ? cities : [args.city]);
      }
      return new Set([args.city]);
    })();
    const items = await ctx.db.query("inventory").collect();
    const filtered = items.filter((item) => {
      const org = verified.get(item.organizationId);
      if (!org) return false;
      if (!item.verified) return false;
      if (item.unitsAvailable - item.unitsReserved <= 0) return false;
      if (item.expiryDate < todayIso()) return false;
      if (args.bloodGroup && item.bloodGroup !== args.bloodGroup) return false;
      if (args.component && item.component !== args.component) return false;
      if (allowedCities && !allowedCities.has(org.city)) return false;
      return true;
    });

    const grouped = new Map<
      string,
      {
        organizationId: Doc<"organizations">["_id"];
        organizationName: string;
        organizationType: string;
        orgId: string;
        city: string;
        area: string | null;
        bloodGroup: string;
        component: string;
        units: number;
        lastUpdated: number;
        earliestExpiry: string;
        isDemo: boolean;
      }
    >();
    for (const item of filtered) {
      const org = verified.get(item.organizationId)!;
      const key = `${item.organizationId}:${item.bloodGroup}:${item.component}`;
      const existing = grouped.get(key);
      const free = item.unitsAvailable - item.unitsReserved;
      if (existing) {
        existing.units += free;
        existing.lastUpdated = Math.max(existing.lastUpdated, item.lastUpdated);
        if (item.expiryDate < existing.earliestExpiry) {
          existing.earliestExpiry = item.expiryDate;
        }
      } else {
        grouped.set(key, {
          organizationId: org._id,
          organizationName: org.name,
          organizationType: org.type,
          orgId: org.orgId,
          city: org.city,
          area: org.area ?? null,
          bloodGroup: item.bloodGroup,
          component: item.component,
          units: free,
          lastUpdated: item.lastUpdated,
          earliestExpiry: item.expiryDate,
          isDemo: (org.isDemo ?? false) || (item.isDemo ?? false),
        });
      }
    }
    return [...grouped.values()].sort(
      (a, b) =>
        a.city.localeCompare(b.city) ||
        a.organizationName.localeCompare(b.organizationName) ||
        a.bloodGroup.localeCompare(b.bloodGroup),
    );
  },
});

export const publicStockSummary = query({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    const verified = new Set(
      orgs.filter((o) => o.status === "verified").map((o) => o._id),
    );
    const items = await ctx.db.query("inventory").collect();
    const today = todayIso();
    let units = 0;
    let demoUnits = 0;
    for (const item of items) {
      if (!verified.has(item.organizationId) || !item.verified) continue;
      if (item.expiryDate < today) continue;
      const free = item.unitsAvailable - item.unitsReserved;
      if (free <= 0) continue;
      units += free;
      if (item.isDemo) demoUnits += free;
    }
    return { units, demoUnits, organizations: verified.size };
  },
});

/** Shared availability lookup used by the matching panel. */
export const availableBatchesFor = query({
  args: {
    bloodGroup: bloodGroupValidator,
    component: componentValidator,
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const orgs = await ctx.db.query("organizations").collect();
    const verified = new Map(
      orgs.filter((o) => o.status === "verified").map((o) => [o._id, o]),
    );
    const items = await ctx.db.query("inventory").collect();
    return items
      .filter((i) => {
        if (!verified.has(i.organizationId)) return false;
        if (!i.verified || i.expiryDate < todayIso()) return false;
        if (i.bloodGroup !== args.bloodGroup || i.component !== args.component) return false;
        if (i.unitsAvailable - i.unitsReserved <= 0) return false;
        return args.city ? verified.get(i.organizationId)?.city === args.city : true;
      })
      .map((i) => {
        const org = verified.get(i.organizationId)!;
        return {
          _id: i._id,
          batchRef: i.batchRef,
          unitsAvailable: i.unitsAvailable,
          unitsReserved: i.unitsReserved,
          free: i.unitsAvailable - i.unitsReserved,
          expiryDate: i.expiryDate,
          lastUpdated: i.lastUpdated,
          organizationId: org._id,
          organizationName: org.name,
          organizationType: org.type,
          city: org.city,
          isDemo: (i.isDemo ?? false) || (org.isDemo ?? false),
        };
      })
      .sort((a, b) => b.free - a.free);
  },
});

export const orgBatchesForRequest = query({
  args: { requestId: v.id("bloodRequests") },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const organizationId = user.organizationId;
    if (!organizationId) return [];
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found.");
    const items = await ctx.db
      .query("inventory")
      .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
      .collect();
    return items
      .filter(
        (i) =>
          i.verified &&
          i.bloodGroup === request.bloodGroup &&
          i.component === request.component &&
          i.expiryDate >= todayIso() &&
          i.unitsAvailable - i.unitsReserved > 0,
      )
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  },
});
