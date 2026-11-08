import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  audit,
  optionalUser,
  requireAdmin,
  requireStaff,
  roleOf,
} from "./lib/helpers";
import {
  detectAnomalies,
  fitDonorModel,
  forecastDemand,
  type DailyPoint,
  type DonorSample,
} from "../lib/supply";
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

async function resolveForecastScope(
  ctx: QueryCtx | MutationCtx,
  organizationId: Id<"organizations"> | undefined,
  user: Doc<"users">,
) {
  const role = roleOf(user);
  if (organizationId) {
    if (role !== "admin" && user.organizationId !== organizationId) {
      throw new Error("You can only forecast demand for your own facility.");
    }
    const org = await ctx.db.get(organizationId);
    if (!org) throw new Error("Organization not found.");
    return { scope: "hospital" as const, org };
  }
  if (role !== "admin" && role !== "red_cross") {
    throw new Error("Network-wide forecasts are restricted to admins and Red Cross coordinators.");
  }
  return { scope: "network" as const, org: null };
}

/**
 * Genuine ridge-regression forecast with a chronological holdout and MAE/RMSE
 * against a rolling-mean baseline. Short series return `insufficient_data`
 * instead of a fabricated number.
 */
export const demandForecast = query({
  args: {
    organizationId: v.optional(v.id("organizations")),
    component: v.optional(
      v.union(
        v.literal("whole_blood"),
        v.literal("red_cells"),
        v.literal("platelets"),
        v.literal("plasma"),
      ),
    ),
    bloodGroup: v.optional(
      v.union(
        v.literal("A+"),
        v.literal("A-"),
        v.literal("B+"),
        v.literal("B-"),
        v.literal("AB+"),
        v.literal("AB-"),
        v.literal("O+"),
        v.literal("O-"),
      ),
    ),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const { scope, org } = await resolveForecastScope(ctx, args.organizationId, user);
    const component = args.component ?? "red_cells";
    const groups = args.bloodGroup ? [args.bloodGroup] : [...BLOOD_GROUPS];
    const days = Math.max(30, Math.min(180, args.days ?? 90));

    const forecasts = [];
    let includesDemo = false;
    for (const group of groups) {
      const series = await demandSeries(ctx, {
        organizationId: args.organizationId,
        bloodGroup: group,
        component,
        days,
      });
      includesDemo = includesDemo || series.includesDemo;
      const insufficient =
        series.totalUnits === 0 || series.points.every((p) => p.units === 0);
      const result = insufficient
        ? {
            status: "insufficient_data" as const,
            model: "ridge_ts_v1" as const,
            sampleSize: series.points.length,
            metrics: null,
            horizons: { h24: null, h7: null, h30: null },
            confidence: null,
            confidenceLabel: null,
            explanation:
              "No recorded issues or dispatches exist for this group and component, so no forecast is shown. LifeLink does not invent demand.",
          }
        : forecastDemand(series.points);
      forecasts.push({ bloodGroup: group, component, ...result });
    }

    return {
      scope,
      organizationId: args.organizationId ?? null,
      organizationName: org?.name ?? "Network-wide",
      generatedAt: Date.now(),
      dataDays: days,
      includesDemo,
      dataScope: includesDemo
        ? "Includes labelled demo transactions. Metrics describe this dataset only, not real hospital demand."
        : "Derived from recorded dispatch/issue transactions only.",
      forecasts,
      disclaimer:
        "Forecasts are decision support, not stock guarantees. Clinical compatibility, release and allocation remain deterministic.",
    };
  },
});

/** Persists a forecast run so the admin dashboard can show model history. */
export const storeDemandForecasts = mutation({
  args: {
    organizationId: v.optional(v.id("organizations")),
    component: v.optional(
      v.union(
        v.literal("whole_blood"),
        v.literal("red_cells"),
        v.literal("platelets"),
        v.literal("plasma"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const { scope } = await resolveForecastScope(ctx, args.organizationId, user);
    const component = args.component ?? "red_cells";
    let stored = 0;
    for (const group of BLOOD_GROUPS) {
      const series = await demandSeries(ctx, {
        organizationId: args.organizationId,
        bloodGroup: group,
        component,
        days: 90,
      });
      if (series.totalUnits === 0) continue;
      const result = forecastDemand(series.points);
      await ctx.db.insert("demandForecasts", {
        organizationId: args.organizationId,
        scope,
        bloodGroup: group,
        component,
        runAt: Date.now(),
        model: result.model,
        status: result.status,
        sampleSize: result.sampleSize,
        metrics: result.metrics ?? undefined,
        confidence: result.confidence ?? undefined,
        confidenceLabel: result.confidenceLabel ?? undefined,
        explanation: result.explanation,
        horizons: result.horizons,
      });
      stored += 1;
    }
    await audit(ctx, {
      actor: user,
      action: "forecast.stored",
      entityType: "demandForecast",
      entityId: String(args.organizationId ?? "network"),
      detail: `${stored} forecast run(s) stored for ${component}.`,
      organizationId: args.organizationId,
    });
    return { stored };
  },
});

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
        "Demand anomalies use a trailing 28-day z-score (|z| > 2.5). Sync failures and mission safety events are recorded separately.",
    };
  },
});

export const trainDonorResponseModel = mutation({
  args: {},
  handler: async (ctx) => {
    const admin = await requireAdmin(ctx);
    const invitations = await ctx.db.query("donorInvitations").collect();
    const donors = await ctx.db.query("donorProfiles").collect();
    const donorById = new Map(donors.map((d) => [d._id, d]));
    const donations = await ctx.db.query("donations").collect();
    const samples: DonorSample[] = [];

    for (const invite of invitations) {
      if (invite.status === "sent" || invite.status === "expired") continue;
      const donor = donorById.get(invite.donorProfileId);
      if (!donor) continue;
      const history = invitations.filter((i) => i.donorProfileId === invite.donorProfileId);
      const answered = history.filter((i) => ["accepted", "declined"].includes(i.status));
      const accepted = answered.filter((i) => i.status === "accepted").length;
      const priorResponseRate = answered.length ? accepted / answered.length : 0.5;
      const previousDonations = donations.filter((d) => d.donorProfileId === invite.donorProfileId).length;
      const daysSinceDonation = donor.lastDonationDate
        ? Math.max(
            0,
            Math.floor((invite.createdAt - new Date(donor.lastDonationDate).getTime()) / DAY_MS),
          )
        : 365;
      samples.push({
        distanceKm: invite.distanceKm ?? 25,
        daysSinceDonation,
        previousDonations,
        priorResponseRate,
        responded: invite.status === "accepted",
      });
    }

    const model = fitDonorModel(samples);
    if (!model) {
      return {
        trained: false,
        sampleSize: samples.length,
        message:
          "At least 20 answered invitations with a mix of acceptances and declines are required. No model was stored and no accuracy is claimed.",
      };
    }
    const previous = await ctx.db
      .query("mlModels")
      .withIndex("by_kind", (q) => q.eq("kind", "donor_response").eq("active", true))
      .collect();
    for (const old of previous) {
      await ctx.db.patch(old._id, { active: false });
    }
    const modelId = await ctx.db.insert("mlModels", {
      kind: "donor_response",
      version: `donor-logistic-v1-${new Date().toISOString().slice(0, 10)}`,
      trainedAt: model.trainedAt,
      sampleSize: model.sampleSize,
      payload: JSON.stringify(model),
      metricsJson: JSON.stringify({ baseRate: model.baseRate, sampleSize: model.sampleSize }),
      active: true,
    });
    await audit(ctx, {
      actor: admin,
      action: "ml.donorModelTrained",
      entityType: "mlModel",
      entityId: String(modelId),
      detail: `Logistic donor-response model trained on ${model.sampleSize} answered invitations; base response rate ${Math.round(model.baseRate * 100)}%.`,
    });
    return {
      trained: true,
      sampleSize: model.sampleSize,
      baseRate: model.baseRate,
      modelId,
      message:
        "Model stored. It only ranks who to invite; medical eligibility remains deterministic.",
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
    const forecasts = await ctx.db.query("demandForecasts").collect();
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
        name: "ridge_ts_v1",
        type: "Ridge regression with seasonality, lags and rolling mean",
        validation: "Chronological 80/20 holdout; MAE/RMSE versus a 7-day rolling-mean baseline",
      },
    };
  },
});

/* ------------------------------------------------------------------ *
 * Scheduled jobs
 * ------------------------------------------------------------------ */

export const refreshScheduledForecasts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const orgs = (await ctx.db.query("organizations").collect()).filter(
      (o) => o.status === "verified",
    );
    let stored = 0;
    for (const org of orgs) {
      const pairs = new Set<string>();
      const batches = await ctx.db
        .query("inventory")
        .withIndex("by_organization", (q) => q.eq("organizationId", org._id))
        .collect();
      for (const batch of batches) pairs.add(`${batch.bloodGroup}:${batch.component}`);
      for (const pair of [...pairs].slice(0, 6)) {
        const [group, component] = pair.split(":") as [BloodGroup, Component];
        const series = await demandSeries(ctx, {
          organizationId: org._id,
          bloodGroup: group,
          component,
          days: 90,
        });
        if (series.totalUnits === 0) continue;
        const result = forecastDemand(series.points);
        await ctx.db.insert("demandForecasts", {
          organizationId: org._id,
          scope: "hospital",
          bloodGroup: group,
          component,
          runAt: Date.now(),
          model: result.model,
          status: result.status,
          sampleSize: result.sampleSize,
          metrics: result.metrics ?? undefined,
          confidence: result.confidence ?? undefined,
          confidenceLabel: result.confidenceLabel ?? undefined,
          explanation: result.explanation,
          horizons: result.horizons,
        });
        stored += 1;
      }
    }
    return { organizations: orgs.length, stored };
  },
});

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
