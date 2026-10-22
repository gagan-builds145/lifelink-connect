import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { compatibility } from "../../lib/blood";
import { notifyOrganization, notifyUser } from "./helpers";

/**
 * Automatic low-stock and deadline escalation.
 *
 * Whenever an organization's usable (unreserved, unexpired) stock for a
 * group/component drops to its low-stock threshold - i.e. before it actually
 * runs out - the network is asked for help without staff having to press
 * anything. Units that pass the storage deadline written on their batch stop
 * counting as usable stock, so a passed deadline raises the same request on its
 * own (the daily sweep in crons.ts re-checks every branch and hospital):
 *
 *  - the organization's own staff are alerted immediately;
 *  - if the organization is a hospital, the request is pushed to the other
 *    verified hospitals in the same city, to the Red Cross / blood bank
 *    sources in that city, and to compatible local donors;
 *  - if the organization is a Red Cross branch or blood bank, the request is
 *    pushed to compatible local donors only. A Red Cross shortfall is never
 *    routed to hospitals.
 */
export type StockLevel = "low" | "critical" | "out";
export type StockAlertReason = "low_stock" | "deadline";

const todayIso = () => new Date().toISOString().slice(0, 10);
const label = (component: string) => component.replace(/_/g, " ");

export function levelFor(free: number, threshold: number): StockLevel {
  if (free <= 0) return "out";
  if (free <= Math.max(1, Math.floor(threshold / 2))) return "critical";
  return "low";
}

type Group = Doc<"inventory">["bloodGroup"];
type Component = Doc<"inventory">["component"];

async function resolveAlert(
  ctx: MutationCtx,
  alert: Doc<"stockAlerts">,
  freeUnits: number,
) {
  const now = Date.now();
  await ctx.db.patch(alert._id, {
    status: "resolved",
    freeUnits,
    updatedAt: now,
    resolvedAt: now,
  });
}

export async function evaluateStockLevel(
  ctx: MutationCtx,
  org: Doc<"organizations">,
  bloodGroup: Group,
  component: Component,
  reason: StockAlertReason = "low_stock",
) {
  const today = todayIso();
  const scoped = (
    await ctx.db
      .query("inventory")
      .withIndex("by_organization", (q) => q.eq("organizationId", org._id))
      .collect()
  ).filter((b) => b.bloodGroup === bloodGroup && b.component === component);

  const existing = (
    await ctx.db
      .query("stockAlerts")
      .withIndex("by_organization", (q) => q.eq("organizationId", org._id))
      .collect()
  ).find(
    (a) => a.bloodGroup === bloodGroup && a.component === component && a.status === "open",
  );

  // Nothing tracked for this group/component yet: never invent a shortfall.
  if (scoped.length === 0) {
    if (existing) await resolveAlert(ctx, existing, 0);
    return null;
  }

  const usable = scoped.filter((b) => b.verified && b.expiryDate >= today);
  const free = usable.reduce(
    (sum, b) => sum + Math.max(0, b.unitsAvailable - b.unitsReserved),
    0,
  );
  const expiredUnits = scoped
    .filter((b) => b.expiryDate < today)
    .reduce((sum, b) => sum + Math.max(0, b.unitsAvailable - b.unitsReserved), 0);
  const threshold = Math.max(1, ...scoped.map((b) => b.lowStockThreshold));

  if (free > threshold) {
    if (existing) await resolveAlert(ctx, existing, free);
    return null;
  }

  const now = Date.now();
  const level = levelFor(free, threshold);
  const effectiveReason: StockAlertReason =
    expiredUnits > 0 && free <= threshold ? "deadline" : reason;
  const requestedUnits = Math.min(20, Math.max(1, threshold * 2 - free));

  // An open alert is refreshed in place. Only a new alert, or an escalation to
  // a complete stock-out, re-notifies the network so nobody is spammed.
  const shouldNotify = !existing || (existing.level !== "out" && level === "out");
  if (!shouldNotify) {
    await ctx.db.patch(existing!._id, {
      freeUnits: free,
      level,
      reason: effectiveReason,
      updatedAt: now,
    });
    return existing!;
  }

  const isHospitalShortfall = org.type === "hospital";
  const orgs = await ctx.db.query("organizations").collect();
  const nearby = orgs.filter(
    (o) => o.status === "verified" && o._id !== org._id && o.city === org.city,
  );
  const hospitals = isHospitalShortfall
    ? nearby.filter((o) => o.type === "hospital")
    : [];
  const redCrossSources = isHospitalShortfall
    ? nearby.filter((o) => o.type === "red_cross" || o.type === "blood_bank")
    : [];

  const donorsNotifiedTargets: Doc<"donorProfiles">[] = [];
  const donors = await ctx.db
    .query("donorProfiles")
    .withIndex("by_availability", (q) => q.eq("available", true))
    .collect();
  for (const donor of donors) {
    if (donorsNotifiedTargets.length >= 25) break;
    if (donor.city !== org.city) continue;
    if (!compatibility(donor.bloodGroup, bloodGroup, component).compatible) continue;
    donorsNotifiedTargets.push(donor);
  }

  const supply = `${bloodGroup} ${label(component)}`;
  const route = isHospitalShortfall
    ? `${hospitals.length} nearby hospital(s), ${redCrossSources.length} Red Cross source(s) and ${donorsNotifiedTargets.length} compatible donor(s)`
    : `${donorsNotifiedTargets.length} compatible donor(s). Red Cross shortfalls are not routed to hospitals`;
  const deadlineNote =
    expiredUnits > 0
      ? ` ${expiredUnits} unit(s) passed their storage deadline and can no longer be issued.`
      : "";
  const headline =
    level === "out"
      ? "Stock-out"
      : effectiveReason === "deadline"
        ? "Storage deadline reached"
        : "Low stock";

  await notifyOrganization(ctx, org._id, {
    title: `${headline}: ${supply}`,
    body: `${free} usable unit(s) left at ${org.name} (threshold ${threshold}).${deadlineNote} An automatic request for ${requestedUnits} unit(s) was sent to ${route}.`,
    kind: "inventory",
    link: org.type === "hospital" ? "/hospital/dashboard" : "/red-cross/dashboard",
  });

  for (const target of hospitals) {
    await notifyOrganization(ctx, target._id, {
      title: `Blood assistance request: ${supply}`,
      body: `${org.name} in ${org.city} is down to ${free} usable unit(s) and needs about ${requestedUnits} unit(s).${deadlineNote} If you can spare compatible stock, coordinate through your dashboard.`,
      kind: "request",
      link: "/hospital/dashboard",
    });
  }

  for (const target of redCrossSources) {
    await notifyOrganization(ctx, target._id, {
      title: `Blood assistance request: ${supply}`,
      body: `${org.name} in ${org.city} is down to ${free} usable unit(s). Automatic network request raised for about ${requestedUnits} unit(s) of ${supply}.${deadlineNote}`,
      kind: "request",
      link: "/red-cross/dashboard",
    });
  }

  for (const donor of donorsNotifiedTargets) {
    await notifyUser(ctx, donor.userId, {
      title: `Donor request near ${org.city}: ${supply}`,
      body:
        level === "out"
          ? `A ${org.type === "hospital" ? "hospital" : "blood centre"} in ${org.city} has no usable ${supply} left. Eligible donors are being asked to donate now.`
          : `A ${org.type === "hospital" ? "hospital" : "blood centre"} in ${org.city} is low on ${supply}. Eligible donors nearby are being asked to donate.`,
      kind: "match",
      link: "/donor/dashboard",
    });
  }

  const record = {
    organizationId: org._id,
    organizationType: org.type,
    city: org.city,
    bloodGroup,
    component,
    freeUnits: free,
    threshold,
    requestedUnits,
    level,
    reason: effectiveReason,
    status: "open" as const,
    hospitalOrgIds: hospitals.map((o) => o._id),
    redCrossOrgIds: redCrossSources.map((o) => o._id),
    donorsNotified: donorsNotifiedTargets.length,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, record);
    return existing;
  }
  const id = await ctx.db.insert("stockAlerts", {
    ...record,
    createdAt: now,
  });
  return await ctx.db.get(id);
}
