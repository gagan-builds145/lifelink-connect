import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireRedCross, requireStaff, roleOf } from "./lib/helpers";

const todayIso = () => new Date().toISOString().slice(0, 10);

export const publicOverview = query({
  args: {},
  handler: async (ctx) => {
    const [donors, orgs, inventory, requests, camps] = await Promise.all([
      ctx.db.query("donorProfiles").collect(),
      ctx.db.query("organizations").collect(),
      ctx.db.query("inventory").collect(),
      ctx.db.query("bloodRequests").collect(),
      ctx.db.query("bloodCamps").collect(),
    ]);
    const verifiedOrgs = new Set(
      orgs.filter((o) => o.status === "verified").map((o) => o._id),
    );
    const today = todayIso();
    const usable = inventory.filter(
      (i) =>
        verifiedOrgs.has(i.organizationId) &&
        i.verified &&
        i.expiryDate >= today &&
        i.unitsAvailable - i.unitsReserved > 0,
    );
    const cities = new Set(orgs.filter((o) => o.status === "verified").map((o) => o.city));
    const demo =
      orgs.some((o) => o.isDemo) ||
      inventory.some((i) => i.isDemo) ||
      requests.some((r) => r.isDemo);
    return {
      verifiedDonors: donors.length,
      verifiedOrganizations: verifiedOrgs.size,
      availableUnits: usable.reduce(
        (sum, i) => sum + i.unitsAvailable - i.unitsReserved,
        0,
      ),
      fulfilledRequests: requests.filter(
        (r) => r.status === "fulfilled" || r.status === "received",
      ).length,
      activeRequests: requests.filter((r) =>
        ["pending", "under_verification", "approved", "dispatched"].includes(r.status),
      ).length,
      upcomingCamps: camps.filter((c) => c.status === "upcoming").length,
      citiesCovered: cities.size,
      demoDataPresent: demo,
      generatedAt: Date.now(),
    };
  },
});

export const staffAnalytics = query({
  args: { windowDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const role = roleOf(user);
    const windowDays = Math.min(90, Math.max(7, Math.round(args.windowDays ?? 30)));
    const [allRequests, donors, orgs, inventory, donations, camps] = await Promise.all([
      ctx.db.query("bloodRequests").collect(),
      ctx.db.query("donorProfiles").collect(),
      ctx.db.query("organizations").collect(),
      ctx.db.query("inventory").collect(),
      ctx.db.query("donations").collect(),
      ctx.db.query("bloodCamps").collect(),
    ]);

    const scopedRequests =
      role === "hospital"
        ? allRequests.filter(
            (r) =>
              r.hospitalOrgId === user.organizationId ||
              r.assignedOrgId === user.organizationId,
          )
        : allRequests;
    const scopedInventory = inventory.filter(
      (i) => role !== "hospital" || i.organizationId === user.organizationId,
    );
    const scopedDonations = donations.filter(
      (d) => role !== "hospital" || d.organizationId === user.organizationId,
    );
    const scopedCamps = camps.filter(
      (c) => role !== "hospital" || c.organizationId === user.organizationId,
    );

    const today = todayIso();
    const verifiedOrgs = new Set(
      orgs.filter((o) => o.status === "verified").map((o) => o._id),
    );
    const usable = scopedInventory.filter(
      (i) =>
        verifiedOrgs.has(i.organizationId) &&
        i.verified &&
        i.expiryDate >= today &&
        i.unitsAvailable - i.unitsReserved > 0,
    );

    const statusCounts = [
      "pending",
      "under_verification",
      "approved",
      "dispatched",
      "received",
      "fulfilled",
      "rejected",
      "cancelled",
    ].map((status) => ({
      status,
      count: scopedRequests.filter((r) => r.status === status).length,
    }));

    const urgencyCounts = ["routine", "urgent", "emergency"].map((urgency) => ({
      urgency,
      count: scopedRequests.filter((r) => r.urgency === urgency).length,
    }));

    const groupStock = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(
      (bloodGroup) => ({
        bloodGroup,
        units: usable
          .filter((i) => i.bloodGroup === bloodGroup)
          .reduce((sum, i) => sum + i.unitsAvailable - i.unitsReserved, 0),
      }),
    );

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (windowDays - 1));
    const trend: { date: string; label: string; requests: number; donations: number }[] = [];
    for (let d = 0; d < windowDays; d += 1) {
      const day = new Date(start.getTime() + d * 86_400_000);
      const iso = day.toISOString().slice(0, 10);
      trend.push({
        date: iso,
        label: day.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        requests: scopedRequests.filter(
          (r) => new Date(r.createdAt).toISOString().slice(0, 10) === iso,
        ).length,
        donations: scopedDonations.filter((x) => x.donationDate === iso).length,
      });
    }

    const lowStock = usable
      .map((i) => ({
        ...i,
        free: i.unitsAvailable - i.unitsReserved,
      }))
      .filter((i) => i.unitsAvailable - i.unitsReserved <= i.lowStockThreshold);

    const expiring = scopedInventory.filter((i) => {
      if (!i.verified) return false;
      const days = Math.ceil((new Date(i.expiryDate).getTime() - Date.now()) / 86_400_000);
      return days >= 0 && days <= 10;
    });

    const donorScope =
      role === "hospital" && user.organizationId
        ? donors.filter((d) => {
            const org = orgs.find((o) => o._id === user.organizationId);
            return org ? d.city === org.city : true;
          })
        : donors;

    return {
      scope: role,
      organizationName:
        orgs.find((o) => o._id === user.organizationId)?.name ?? "Network-wide",
      kpis: {
        donors: donorScope.length,
        verifiedUnits: usable.reduce(
          (sum, i) => sum + i.unitsAvailable - i.unitsReserved,
          0,
        ),
        pendingVerification: scopedRequests.filter((r) => r.status === "pending").length,
        approved: scopedRequests.filter((r) => r.status === "approved").length,
        fulfilled: scopedRequests.filter((r) => r.status === "fulfilled").length,
        emergency: scopedRequests.filter(
          (r) => r.urgency === "emergency" && !["fulfilled", "rejected", "cancelled"].includes(r.status),
        ).length,
        upcomingCamps: scopedCamps.filter((c) => c.status === "upcoming").length,
      },
      alerts: {
        lowStock: lowStock.map((i) => ({
          _id: i._id,
          bloodGroup: i.bloodGroup,
          component: i.component,
          free: i.free,
          batchRef: i.batchRef,
        })),
        expiring: expiring.map((i) => ({
          _id: i._id,
          bloodGroup: i.bloodGroup,
          component: i.component,
          expiryDate: i.expiryDate,
          unitsAvailable: i.unitsAvailable,
        })),
      },
      statusCounts,
      urgencyCounts,
      groupStock,
      trend,
      demoDataPresent:
        scopedRequests.some((r) => r.isDemo) ||
        scopedInventory.some((i) => i.isDemo) ||
        scopedCamps.some((c) => c.isDemo),
      generatedAt: Date.now(),
    };
  },
});

export const auditTrail = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRedCross(ctx);
    const limit = Math.min(200, Math.max(10, Math.round(args.limit ?? 50)));
    const rows = await ctx.db.query("auditLogs").collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((a) => ({
        _id: a._id,
        action: a.action,
        actorRole: a.actorRole,
        entityType: a.entityType,
        entityId: a.entityId,
        detail: a.detail,
        createdAt: a.createdAt,
        isDemo: a.isDemo ?? false,
      }));
  },
});
