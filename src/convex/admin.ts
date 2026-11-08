import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, requireAdmin } from "./lib/helpers";

const todayIso = () => new Date().toISOString().slice(0, 10);

function countBy<T extends string>(values: T[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * Administrator read model. Everything is derived from the live database; no
 * demo metric is mixed in without the UI labelling demo records separately.
 */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const today = todayIso();
    const [orgs, inventory, requests, transfers, missions, invitations, jobs, integrations, runs, anomalies, agreements, forecasts, audits] =
      await Promise.all([
        ctx.db.query("organizations").collect(),
        ctx.db.query("inventory").collect(),
        ctx.db.query("bloodRequests").collect(),
        ctx.db.query("transfers").collect(),
        ctx.db.query("droneMissions").collect(),
        ctx.db.query("donorInvitations").collect(),
        ctx.db.query("notificationJobs").collect(),
        ctx.db.query("facilityIntegrations").collect(),
        ctx.db.query("facilitySyncRuns").collect(),
        ctx.db.query("anomalyEvents").collect(),
        ctx.db.query("transferAgreements").collect(),
        ctx.db.query("demandForecasts").collect(),
        ctx.db.query("auditLogs").collect(),
      ]);

    const freeUnits = inventory.reduce(
      (sum, b) => sum + Math.max(0, b.unitsAvailable - b.unitsReserved),
      0,
    );
    const expiredUnits = inventory
      .filter((b) => b.expiryDate < today)
      .reduce((sum, b) => sum + Math.max(0, b.unitsAvailable - b.unitsReserved), 0);
    const expiringSoon = inventory.filter((b) => {
      const days = (new Date(`${b.expiryDate}T00:00:00Z`).getTime() - now) / 86_400_000;
      return days >= 0 && days <= 3;
    }).length;

    const verifiedOrgs = orgs.filter((o) => o.status === "verified");
    const demoPresent =
      orgs.some((o) => o.isDemo) ||
      inventory.some((b) => b.isDemo) ||
      missions.some((m) => m.simulated);

    return {
      generatedAt: now,
      demoPresent,
      organizations: {
        total: orgs.length,
        verified: verifiedOrgs.length,
        hospitals: verifiedOrgs.filter((o) => o.type === "hospital").length,
        bloodBanks: verifiedOrgs.filter((o) => o.type === "blood_bank").length,
        redCross: verifiedOrgs.filter((o) => o.type === "red_cross").length,
        autoAllocateEnabled: verifiedOrgs.filter((o) => o.autoAllocate === true).length,
      },
      inventory: {
        batches: inventory.length,
        freeUnits,
        expiredUnits,
        expiringSoonBatches: expiringSoon,
        releasedBatches: inventory.filter((b) => b.released !== false && b.verified).length,
        heldForRequests: inventory.reduce((sum, b) => sum + b.unitsReserved, 0),
      },
      requests: {
        total: requests.length,
        byStatus: countBy(requests.map((r) => r.status)),
        open: requests.filter((r) =>
          ["pending", "under_verification", "approved", "dispatched"].includes(r.status),
        ).length,
        demo: requests.filter((r) => r.isDemo).length,
      },
      transfers: {
        total: transfers.length,
        byStatus: countBy(transfers.map((t) => t.status)),
        auto: transfers.filter((t) => t.auto).length,
        unitsInTransit: transfers
          .filter((t) => ["dispatched", "in_transit"].includes(t.status))
          .reduce((sum, t) => sum + t.units, 0),
      },
      agreements: {
        total: agreements.length,
        active: agreements.filter((a) => a.status === "active").length,
        auto: agreements.filter((a) => a.status === "active" && a.autoAllocate).length,
      },
      drones: {
        missions: missions.length,
        byState: countBy(missions.map((m) => m.state)),
        active: missions.filter((m) =>
          [
            "PLANNED",
            "PREFLIGHT_CHECKING",
            "PREFLIGHT_PASSED",
            "DISPATCHED_TO_PICKUP",
            "AT_PICKUP",
            "PAYLOAD_LOADING",
            "PAYLOAD_LOADED",
            "IN_TRANSIT_TO_DESTINATION",
            "AT_DESTINATION",
            "DELIVERED",
            "RETURNING_TO_BASE",
          ].includes(m.state),
        ).length,
        holds: missions.filter((m) => m.state === "HOLD").length,
        emergencies: missions.filter((m) => m.state === "EMERGENCY_LANDING").length,
        completed: missions.filter((m) => m.state === "COMPLETED").length,
        simulated: true,
      },
      donors: {
        invitations: invitations.length,
        byStatus: countBy(invitations.map((i) => i.status)),
        consentModel:
          "Only donors with an active, unexpired consent row receive invitations. Location is never exposed without consent.",
      },
      notifications: {
        total: jobs.length,
        byStatus: countBy(jobs.map((j) => j.status)),
        queued: jobs.filter((j) => j.status === "queued").length,
        failed: jobs.filter((j) => j.status === "failed").length,
      },
      integrations: {
        total: integrations.length,
        mock: integrations.filter((i) => i.isMock).length,
        live: integrations.filter((i) => !i.isMock).length,
        byStatus: countBy(integrations.map((i) => i.status)),
        failing: integrations.filter((i) => i.status === "error").length,
        lastSyncAt: integrations.reduce((max, i) => Math.max(max, i.lastSyncAt ?? 0), 0) || null,
        syncRuns24h: runs.filter((r) => r.startedAt > now - 86_400_000).length,
        failedRuns24h: runs.filter(
          (r) => r.startedAt > now - 86_400_000 && r.status === "failed",
        ).length,
      },
      ml: {
        forecastRuns: forecasts.length,
        lastForecastAt: forecasts.reduce((max, f) => Math.max(max, f.runAt), 0) || null,
        insufficientDataRuns: forecasts.filter((f) => f.status === "insufficient_data").length,
      },
      anomalies: {
        unacknowledged: anomalies.filter((a) => !a.acknowledged).length,
        critical: anomalies.filter((a) => !a.acknowledged && a.severity === "critical").length,
        recent: anomalies
          .sort((a, b) => b.at - a.at)
          .slice(0, 8)
          .map((a) => ({
            _id: a._id,
            kind: a.kind,
            severity: a.severity,
            note: a.note,
            at: a.at,
            acknowledged: a.acknowledged,
          })),
      },
      audit: audits
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 12)
        .map((a) => ({
          _id: a._id,
          action: a.action,
          actorRole: a.actorRole,
          detail: a.detail,
          createdAt: a.createdAt,
          isDemo: a.isDemo ?? false,
        })),
      systemHealth: {
        integrationsFailing: integrations.filter((i) => i.status === "error").length,
        notificationFailures: jobs.filter((j) => j.status === "failed").length,
        criticalAnomalies: anomalies.filter((a) => !a.acknowledged && a.severity === "critical").length,
        holds: missions.filter((m) => m.state === "HOLD").length,
        emergencies: missions.filter((m) => m.state === "EMERGENCY_LANDING").length,
        expiredUnits,
      },
    };
  },
});

export const acknowledgeAnomaly = mutation({
  args: { anomalyId: v.id("anomalyEvents") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const anomaly = await ctx.db.get(args.anomalyId);
    if (!anomaly) throw new Error("Anomaly not found.");
    await ctx.db.patch(anomaly._id, { acknowledged: true });
    await audit(ctx, {
      actor: admin,
      action: "anomaly.acknowledged",
      entityType: "anomalyEvent",
      entityId: String(anomaly._id),
      detail: anomaly.note,
      organizationId: anomaly.organizationId,
    });
    return { ok: true };
  },
});

export const recentSyncRuns = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const runs = await ctx.db.query("facilitySyncRuns").collect();
    const integrations = await ctx.db.query("facilityIntegrations").collect();
    const orgs = await ctx.db.query("organizations").collect();
    const integrationById = new Map(integrations.map((i) => [i._id, i]));
    const orgById = new Map(orgs.map((o) => [o._id, o]));
    return runs
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 25)
      .map((run) => {
        const integration = integrationById.get(run.integrationId);
        return {
          _id: run._id,
          integrationLabel: integration?.label ?? "Integration",
          isMock: run.isMock,
          organizationName: orgById.get(run.organizationId)?.name ?? "Facility",
          startedAt: run.startedAt,
          finishedAt: run.finishedAt ?? null,
          status: run.status,
          source: run.source,
          recordsRead: run.recordsRead,
          recordsApplied: run.recordsApplied,
          error: run.error ?? null,
        };
      });
  },
});

export const notificationQueue = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const jobs = await ctx.db.query("notificationJobs").collect();
    return jobs
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 40)
      .map((job) => ({
        _id: job._id,
        channel: job.channel,
        status: job.status,
        subject: job.subject,
        attempts: job.attempts,
        lastError: job.lastError ?? null,
        createdAt: job.createdAt,
        sentAt: job.sentAt ?? null,
      }));
  },
});
