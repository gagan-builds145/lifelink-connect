import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { audit, optionalUser, requireStaff, roleOf } from "./lib/helpers";
import { detectAnomalies, type DailyPoint } from "../lib/supply";
import { BLOOD_GROUPS, type BloodGroup, type Component } from "../lib/blood";

const DAY_MS = 86_400_000;
const DEMAND_TYPES = new Set(["dispatch", "issue"]);

function dayKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function continuousSeries(byDay: Map<string, number>, days: number): DailyPoint[] {
  const points: DailyPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today.getTime() - i * DAY_MS).toISOString().slice(0, 10);
    points.push({ date, units: byDay.get(date) ?? 0 });
  }
  return points;
}

type SeriesResult = {
  points: DailyPoint[];
  includesDemo: boolean;
  totalUnits: number;
};

async function demandSeries(
  ctx: QueryCtx | MutationCtx,
  input: {
    organizationId?: Id<"organizations">;
    bloodGroup: BloodGroup;
    component: Component;
    days?: number;
  },
): Promise<SeriesResult> {
  const days = input.days ?? 90;
  const start = Date.now() - days * DAY_MS;
  const transactions = await ctx.db.query("inventoryTransactions").collect();
  const byDay = new Map<string, number>();
  let includesDemo = false;
  let totalUnits = 0;
  for (const tx of transactions) {
    if (!DEMAND_TYPES.has(tx.type)) continue;
    if (tx.createdAt < start) continue;
    if (input.organizationId && tx.organizationId !== input.organizationId) continue;
    if (tx.bloodGroup !== input.bloodGroup || tx.component !== input.component) continue;
    const key = dayKey(tx.createdAt);
    byDay.set(key, (byDay.get(key) ?? 0) + tx.units);
    totalUnits += tx.units;
    if (tx.isDemo) includesDemo = true;
  }
  return { points: continuousSeries(byDay, days), includesDemo, totalUnits };
}

export const anomalyReport = query({
  args: { organizationId: v.optional(v.id("organizations")) },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const role = roleOf(user);
    const orgId = args.organizationId ?? user.organizationId;
    if (role !== "admin" && role !== "red_cross" && orgId !== user.organizationId) {
      throw new Error("You can only inspect anomalies for your own facility.");
    }
    const findings = [];
    for (const group of BLOOD_GROUPS) {
      const series = await demandSeries(ctx, {
        organizationId: orgId ?? undefined,
        bloodGroup: group,
        component: "red_cells",
        days: 90,
      });
      for (const finding of detectAnomalies(series.points)) {
        findings.push({ ...finding, bloodGroup: group, component: "red_cells" as const });
      }
    }
    const persisted = (await ctx.db.query("anomalyEvents").collect())
      .filter(
        (event) =>
          role === "admin" || orgId == null || event.organizationId == null || event.organizationId === orgId,
      )
      .sort((a, b) => b.at - a.at)
      .slice(0, 30)
      .map((event) => ({
        _id: event._id,
        kind: event.kind,
        severity: event.severity,
        observed: event.observed,
        expected: event.expected,
        zScore: event.zScore ?? null,
        at: event.at,
        note: event.note,
        acknowledged: event.acknowledged,
        organizationId: event.organizationId ?? null,
      }));
    return {
      demandFindings: findings.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore)).slice(0, 20),
      persisted,
      method:
        "Demand anomalies use a trailing 28-day z-score (|z| > 2.5). The Isolation Forest scan adds the Python model's scored findings; both are review prompts, not proof of a cause. Sync failures and mission safety events are recorded separately.",
    };
  },
});

export const modelStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return null;
    const role = roleOf(user);
    if (!["admin", "hospital", "red_cross"].includes(role)) return null;
    const donorModels = await ctx.db
      .query("mlModels")
      .withIndex("by_kind", (q) => q.eq("kind", "donor_response"))
      .collect();
    const active = donorModels.find((m) => m.active) ?? null;
    const demandModels = await ctx.db
      .query("mlModels")
      .withIndex("by_kind", (q) => q.eq("kind", "demand_forecast"))
      .collect();
    const activeDemand = demandModels.find((m) => m.active) ?? null;
    const forecasts = (await ctx.db.query("demandForecasts").collect()).filter(
      (forecast) => forecast.model === "xgboost_demand",
    );
    const labelled = forecasts.slice(-20).map((f) => ({
      _id: f._id,
      bloodGroup: f.bloodGroup,
      component: f.component,
      scope: f.scope,
      status: f.status,
      sampleSize: f.sampleSize,
      metrics: f.metrics ?? null,
      confidence: f.confidence ?? null,
      confidenceLabel: f.confidenceLabel ?? null,
      runAt: f.runAt,
      model: f.model,
      modelVersion: f.modelVersion ?? null,
      syntheticData: f.syntheticData ?? false,
    }));
    return {
      donorModel: active
        ? {
            version: active.version,
            trainedAt: active.trainedAt,
            sampleSize: active.sampleSize,
            metrics: JSON.parse(active.metricsJson) as Record<string, unknown>,
            active: true,
          }
        : {
            version: null,
            trainedAt: null,
            sampleSize: 0,
            metrics: null,
            active: false,
            note: "No donor-response model is trained. Invitations are ranked by eligibility and distance.",
          },
      demandForecasts: labelled,
      demandModel: {
        name: "xgboost_demand (Python service)",
        type: "XGBoost regressor with lag, rolling-window and calendar features",
        validation:
          "Chronological 80/20 holdout in the Python service; MAE/RMSE versus a 7-day rolling-mean baseline. Forecasts are stored only after a successful service refresh.",
        active: activeDemand != null,
        version: activeDemand?.version ?? null,
        trainedAt: activeDemand?.trainedAt ?? null,
        sampleSize: activeDemand?.sampleSize ?? 0,
        metrics: activeDemand
          ? (JSON.parse(activeDemand.metricsJson) as Record<string, unknown>)
          : null,
        serviceConfigured: Boolean(process.env.ML_SERVICE_URL?.trim()),
      },
    };
  },
});

/* ------------------------------------------------------------------ *
 * Scheduled jobs
 * ------------------------------------------------------------------ */

export const anomalySweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("anomalyEvents").collect();
    let created = 0;
    for (const group of BLOOD_GROUPS) {
      const series = await demandSeries(ctx, {
        bloodGroup: group,
        component: "red_cells",
        days: 90,
      });
      for (const finding of detectAnomalies(series.points)) {
        const duplicate = existing.some(
          (event) =>
            event.kind === (finding.direction === "spike" ? "demand_spike" : "stock_drop") &&
            dayKey(event.at) === finding.date &&
            Math.abs(event.zScore ?? 0) === Math.abs(finding.zScore),
        );
        if (duplicate) continue;
        const at = new Date(`${finding.date}T12:00:00Z`).getTime();
        await ctx.db.insert("anomalyEvents", {
          kind: finding.direction === "spike" ? "demand_spike" : "stock_drop",
          severity: finding.severity,
          observed: finding.observed,
          expected: finding.expected,
          zScore: finding.zScore,
          at,
          note: `${group} red cells · ${finding.reason}`,
          acknowledged: false,
          createdAt: Date.now(),
        });
        created += 1;
      }
    }
    return { created };
  },
});

export type ForecastDoc = Doc<"demandForecasts">;
export type AnomalyDoc = Doc<"anomalyEvents">;
