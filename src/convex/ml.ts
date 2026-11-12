import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  audit,
  optionalUser,
  requireAdmin,
  requireStaff,
  requireUser,
  roleOf,
  safeError,
  recordSecurityEvent,
  type AppUser,
} from "./lib/helpers";
import type { MutationCtx } from "./_generated/server";
import { BLOOD_GROUPS, type BloodGroup, type Component } from "../lib/blood";
import { mlFetch, mlServiceConfigured } from "./lib/mlClient";

const DAY_MS = 86_400_000;
const DEMAND_TYPES = new Set(["dispatch", "issue"]);

type DemandHistory = {
  days: number;
  start: number;
  includesDemo: boolean;
  totalUnits: number;
  records: Array<{
    date: string;
    bloodGroup: BloodGroup;
    component: Component;
    units: number;
    isSynthetic: boolean;
  }>;
};
const COMPONENT_VALIDATOR = v.union(
  v.literal("whole_blood"),
  v.literal("red_cells"),
  v.literal("platelets"),
  v.literal("plasma"),
);
const BLOOD_GROUP_VALIDATOR = v.union(
  v.literal("A+"),
  v.literal("A-"),
  v.literal("B+"),
  v.literal("B-"),
  v.literal("AB+"),
  v.literal("AB-"),
  v.literal("O+"),
  v.literal("O-"),
);

function dayKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ */
/* Authorized data access
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Prediction helpers
/* ------------------------------------------------------------------ */

export const authorizeMlAction = internalQuery({
  args: {
    organizationId: v.optional(v.id("organizations")),
    mode: v.union(v.literal("predict"), v.literal("train")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const role = roleOf(user);

    if (args.mode === "train" && role !== "admin") {
      await recordSecurityEvent(ctx, {
        kind: "unauthorized_access",
        severity: "high",
        service: "ml_service",
        reason: `Model retraining attempt by non-admin role ${role}.`,
        summary: `Unauthorized ML model retraining attempt by ${role}.`,
        entityType: "ml_action",
        entityId: args.mode,
      });
      throw safeError("Only administrators can retrain the production demand model.");
    }

    if (args.mode === "predict") {
      await requireStaff(ctx);
    }

    let organizationName = "Network-wide";
    if (args.organizationId) {
      if (role !== "admin" && user.organizationId !== args.organizationId) {
        throw new Error("You can only run models for your own facility.");
      }
      const org = await ctx.db.get(args.organizationId);
      if (!org) throw new Error("Organization not found.");
      organizationName = org.name;
    } else if (role !== "admin" && role !== "red_cross") {
      await recordSecurityEvent(ctx, {
        kind: "unauthorized_access",
        severity: "high",
        service: "ml_service",
        reason: `Network-wide model run attempt by role ${role}.`,
        summary: `Unauthorized network-wide ML run attempt by ${role}.`,
        entityType: "ml_action",
        entityId: args.mode,
      });
      throw safeError("Network-wide model runs are restricted to admins and Red Cross.");
    }

    return {
      scope: args.organizationId ? ("hospital" as const) : ("network" as const),
      organizationName,
      actorUserId: user._id,
      role,
    };
  },
});

/* ================================================================== */
/* ML auth-firewall helper (disabled for now)
/* ================================================================== */
export async function recordMlAuthFailure(
  ctx: MutationCtx,
  summary: string,
  reason: string,
  entityType = "ml_service",
  entityId = "ml_service",
) {
  await recordSecurityEvent(ctx, {
    kind: "ml_auth_failure",
    severity: "high",
    service: "ml_service",
    reason,
    summary,
    entityType,
    entityId,
  });
}

/* ------------------------------------------------------------------ */
/* Prediction persistence and reads
/* ------------------------------------------------------------------ */


/* ================================================================== */
/* ML auth-firewall helper (disabled for now)
/* ================================================================== */
export async function recordMlAuthFailure(
  ctx: MutationCtx,
  summary: string,
  reason: string,
  entityType = "ml_service",
  entityId = "ml_service",
) {
  await recordSecurityEvent(ctx, {
    kind: "ml_auth_failure",
    severity: "high",
    service: "ml_service",
    reason,
    summary,
    entityType,
    entityId,
  });
}


function continuousPoints(
  records: Array<{
    date: string;
    bloodGroup: BloodGroup;
    component: Component;
    units: number;
  }>,
  bloodGroup: BloodGroup,
  component: Component,
  days: number,
) {
  const byDate = new Map<string, number>();
  for (const record of records) {
    if (record.bloodGroup !== bloodGroup || record.component !== component) continue;
    byDate.set(record.date, (byDate.get(record.date) ?? 0) + record.units);
  }
  const today = new Date();
  const points: Array<{ date: string; units: number }> = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = isoDay(new Date(today.getTime() - offset * DAY_MS));
    points.push({ date, units: byDate.get(date) ?? 0 });
  }
  return points;
}

/* ------------------------------------------------------------------ */
/* Prediction persistence and reads
/* ------------------------------------------------------------------ */

const forecastRowValidator = v.object({
  bloodGroup: BLOOD_GROUP_VALIDATOR,
  status: v.union(v.literal("ok"), v.literal("insufficient_data")),
  sampleSize: v.number(),
  metrics: v.optional(
    v.object({
      mae: v.number(),
      rmse: v.number(),
      baselineMae: v.number(),
      baselineRmse: v.number(),
      trainSize: v.number(),
      holdoutSize: v.number(),
      meanActual: v.number(),
    }),
  ),
  confidence: v.optional(v.number()),
  confidenceLabel: v.optional(
    v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  ),
  explanation: v.string(),
  horizons: v.object({
    h24: v.union(v.number(), v.null()),
    h7: v.union(v.number(), v.null()),
    h30: v.union(v.number(), v.null()),
  }),
});

export const persistDemandForecasts = internalMutation({
  args: {
    organizationId: v.optional(v.id("organizations")),
    scope: v.union(v.literal("hospital"), v.literal("network")),
    component: COMPONENT_VALIDATOR,
    runAt: v.number(),
    modelVersion: v.string(),
    syntheticData: v.boolean(),
    datasetLabel: v.string(),
    dataDays: v.number(),
    forecasts: v.array(forecastRowValidator),
    actorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const user = args.actorUserId ? await ctx.db.get(args.actorUserId) : null;
    for (const forecast of args.forecasts) {
      await ctx.db.insert("demandForecasts", {
        organizationId: args.organizationId,
        scope: args.scope,
        bloodGroup: forecast.bloodGroup,
        component: args.component,
        runAt: args.runAt,
        model: "xgboost_demand",
        modelVersion: args.modelVersion,
        syntheticData: args.syntheticData,
        datasetLabel: args.datasetLabel,
        dataDays: args.dataDays,
        status: forecast.status,
        sampleSize: forecast.sampleSize,
        metrics: forecast.metrics,
        confidence: forecast.confidence,
        confidenceLabel: forecast.confidenceLabel,
        explanation: forecast.explanation,
        horizons: forecast.horizons,
      });
    }
    if (user) {
      await audit(ctx, {
        actor: user,
        action: "ml.demandForecastRefreshed",
        entityType: "demandForecast",
        entityId: String(args.organizationId ?? "network"),
        detail: `XGBoost ${args.modelVersion} stored ${args.forecasts.length} forecast row(s) for ${args.component}.`,
        organizationId: args.organizationId,
      });
    }
    return { stored: args.forecasts.length };
  },
});

export const latestDemandForecast = query({
  args: {
    organizationId: v.optional(v.id("organizations")),
    component: v.optional(COMPONENT_VALIDATOR),
  },
  handler: async (ctx, args) => {
    const user = await optionalUser(ctx);
    if (!user) return null;
    const role = roleOf(user);
    if (!["admin", "hospital", "red_cross"].includes(role)) return null;
    const component = args.component ?? "red_cells";
    let organizationName = "Network-wide";
    if (args.organizationId) {
      if (role !== "admin" && user.organizationId !== args.organizationId) {
        throw new Error("You can only inspect forecasts for your own facility.");
      }
      const org = await ctx.db.get(args.organizationId);
      organizationName = org?.name ?? "Unknown facility";
    } else if (role !== "admin" && role !== "red_cross") {
      throw new Error("Network-wide forecasts are restricted to admins and Red Cross.");
    }

    const rows = await ctx.db.query("demandForecasts").collect();
    const scoped = rows.filter(
      (row) =>
        row.component === component &&
        (args.organizationId
          ? row.organizationId === args.organizationId
          : row.organizationId == null),
    );
    if (scoped.length === 0) {
      return {
        scope: args.organizationId ? ("hospital" as const) : ("network" as const),
        organizationId: args.organizationId ?? null,
        organizationName,
        generatedAt: null,
        dataDays: 0,
        includesDemo: false,
        dataScope:
          "No XGBoost forecast is stored for this scope. Start the Python ML service and use Refresh XGBoost forecast.",
        forecasts: [],
        modelVersion: null,
        syntheticData: null,
        disclaimer:
          "Forecasts are decision support, not stock guarantees. Clinical compatibility and allocation remain deterministic.",
      };
    }
    const latestRunAt = Math.max(...scoped.map((row) => row.runAt));
    const latest = scoped.filter((row) => row.runAt === latestRunAt);
    const first = latest[0];
    return {
      scope: args.organizationId ? ("hospital" as const) : ("network" as const),
      organizationId: args.organizationId ?? null,
      organizationName,
      generatedAt: latestRunAt,
      dataDays: first.dataDays ?? 0,
      includesDemo: latest.some((row) => row.syntheticData === true),
      dataScope: first.datasetLabel
        ? `${first.datasetLabel}. Metrics describe that dataset only.`
        : "Derived from recorded dispatch/issue transactions.",
      forecasts: latest
        .sort((a, b) => BLOOD_GROUPS.indexOf(a.bloodGroup) - BLOOD_GROUPS.indexOf(b.bloodGroup))
        .map((row) => ({
          bloodGroup: row.bloodGroup,
          component: row.component,
          status: row.status,
          model: row.model,
          modelVersion: row.modelVersion ?? null,
          sampleSize: row.sampleSize,
          metrics: row.metrics ?? null,
          confidence: row.confidence ?? null,
          confidenceLabel: row.confidenceLabel ?? null,
          explanation: row.explanation,
          horizons: row.horizons,
        })),
      modelVersion: first.modelVersion ?? null,
      syntheticData: latest.some((row) => row.syntheticData === true),
      disclaimer:
        "XGBoost forecasts are decision support, not stock guarantees. Clinical compatibility and allocation remain deterministic.",
    };
  },
});

/* ------------------------------------------------------------------ */
/* Public actions
/* ------------------------------------------------------------------ */

export const refreshDemandForecasts = action({
  args: {
    organizationId: v.optional(v.id("organizations")),
    component: v.optional(COMPONENT_VALIDATOR),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    stored: number;
    modelVersion: string;
    syntheticData: boolean;
    component: Component;
    groupsWithForecast: number;
  }> => {
    const auth = await ctx.runQuery(internal.ml.authorizeMlAction, {
      organizationId: args.organizationId,
      mode: "predict",
    });
    const component = (args.component ?? "red_cells") as Component;
    const days = 120;
    const history = (await ctx.runQuery(internal.ml.collectDemandHistory, {
      organizationId: args.organizationId,
      days,
    })) as DemandHistory;
    const activeGroups = BLOOD_GROUPS.map((bloodGroup) => {
      const points = continuousPoints(history.records, bloodGroup, component, days);
      const total = points.reduce((sum, point) => sum + point.units, 0);
      return { bloodGroup, points, total };
    }).filter((row) => row.total > 0 && row.points.length >= 29);
    if (activeGroups.length === 0) {
      throw new Error(
        "No recorded issue/dispatch demand exists for this scope. The ML service will not fabricate a forecast.",
      );
    }

    let response: Response;
    try {
      response = await mlFetch("/v1/predict/demand/batch", {
        method: "POST",
        body: JSON.stringify({
          series: activeGroups.map((row) => ({
            blood_group: row.bloodGroup,
            component,
            points: row.points,
          })),
          horizon_days: 30,
        }),
      }, { timeoutMs: 20_000, attempts: 2 });
    } catch (error) {
      throw new Error(
        `Demand forecast request failed. ${error instanceof Error ? error.message : ""}`.trim(),
      );
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`ML service returned HTTP ${response.status}: ${detail.slice(0, 400)}`);
    }
    const payload = (await response.json()) as {
      model_ready: boolean;
      model_version?: string | null;
      results: Array<{
        blood_group: string;
        component: string;
        status: string;
        sample_size?: number;
        metrics?: Record<string, unknown> | null;
        confidence?: number | null;
        confidence_label?: string | null;
        explanation?: string;
        horizons?: { h24?: number | null; h7?: number | null; h30?: number | null };
        synthetic_training_data?: boolean | null;
        daily?: Array<{ date: string; units: number }>;
      }>;
    };
    if (!payload.model_ready) {
      throw new Error(
        "The ML service is reachable but has no trained demand model. Run ml_service/scripts/train_all.py first.",
      );
    }
    const byGroup = new Map(payload.results.map((row) => [row.blood_group, row]));
    const runAt = Date.now();
    const forecasts = BLOOD_GROUPS.map((bloodGroup) => {
      const row = byGroup.get(bloodGroup);
      if (!row || row.status !== "ok") {
        return {
          bloodGroup,
          status: "insufficient_data" as const,
          sampleSize: row?.sample_size ?? 0,
          explanation:
            row?.explanation ??
            "No recorded demand history exists for this blood group, so no forecast was generated.",
          horizons: { h24: null, h7: null, h30: null },
        };
      }
      const rawMetrics = row.metrics ?? {};
      const trainSize = finiteOrNull(rawMetrics.train_size) ?? 0;
      const holdoutSize = finiteOrNull(rawMetrics.holdout_size) ?? 0;
      const confidenceLabel = ["high", "medium", "low"].includes(row.confidence_label ?? "")
        ? (row.confidence_label as "high" | "medium" | "low")
        : undefined;
      return {
        bloodGroup,
        status: "ok" as const,
        sampleSize: trainSize + holdoutSize,
        metrics: {
          mae: finiteOrNull(rawMetrics.mae) ?? 0,
          rmse: finiteOrNull(rawMetrics.rmse) ?? 0,
          baselineMae: finiteOrNull(rawMetrics.baseline_mae) ?? 0,
          baselineRmse: finiteOrNull(rawMetrics.baseline_rmse) ?? 0,
          trainSize,
          holdoutSize,
          meanActual: finiteOrNull(rawMetrics.mean_actual) ?? 0,
        },
        confidence: finiteOrNull(row.confidence) ?? undefined,
        confidenceLabel,
        explanation:
          row.explanation ??
          "XGBoost recursive forecast with a chronological holdout evaluation.",
        horizons: {
          h24: finiteOrNull(row.horizons?.h24),
          h7: finiteOrNull(row.horizons?.h7),
          h30: finiteOrNull(row.horizons?.h30),
        },
      };
    });
    const syntheticData: boolean =
      payload.results.some((row) => row.synthetic_training_data === true) ||
      history.includesDemo;
    const modelVersion: string = payload.model_version ?? "xgboost-demand-unknown";
    const datasetLabel = syntheticData
      ? "Synthetic/demo transactions; not real hospital demand"
      : "Recorded LifeLink dispatch/issue transactions";
    await ctx.runMutation(internal.ml.persistDemandForecasts, {
      organizationId: args.organizationId,
      scope: auth.scope,
      component,
      runAt,
      modelVersion,
      syntheticData,
      datasetLabel,
      dataDays: days,
      forecasts,
      actorUserId: auth.actorUserId,
    });
    return {
      stored: forecasts.length,
      modelVersion,
      syntheticData,
      component,
      groupsWithForecast: forecasts.filter((row) => row.status === "ok").length,
    };
  },
});

export const trainDemandModel = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    trained: boolean;
    version: string;
    sampleSize: number;
    synthetic: boolean;
    metrics: Record<string, unknown>;
  }> => {
    const auth = await ctx.runQuery(internal.ml.authorizeMlAction, {
      mode: "train",
    });
    const history = (await ctx.runQuery(internal.ml.collectDemandHistory, {
      days: 365,
    })) as DemandHistory;
    if (history.records.length === 0) {
      throw new Error("No issue/dispatch transactions are available to train on.");
    }
    let response: Response;
    try {
      response = await mlFetch("/v1/train/demand", {
        method: "POST",
        body: JSON.stringify({
          records: history.records.map((record) => ({
            date: record.date,
            blood_group: record.bloodGroup,
            component: record.component,
            units: record.units,
            is_synthetic: record.isSynthetic,
          })),
          dataset_label: history.includesDemo
            ? "LifeLink Convex inventoryTransactions including labelled demo rows"
            : "LifeLink Convex inventoryTransactions (real recorded operations)",
          source: "convex",
        }),
      }, { timeoutMs: 120_000, attempts: 1 });
    } catch (error) {
      throw new Error(
        `Demand training request failed: ${
          error instanceof Error ? error.message : "network error"
        }`,
      );
    }
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        `Demand training failed (HTTP ${response.status}): ${JSON.stringify(payload).slice(0, 500)}`,
      );
    }
    const version = String(payload.version ?? "xgboost-demand-unknown");
    const metrics = (payload.metrics as Record<string, unknown>) ?? {};
    const sampleSize = Number(payload.training_rows ?? payload.sample_rows ?? 0);
    const trainedAt = Date.parse(String(payload.trained_at ?? "")) || Date.now();
    await ctx.runMutation(internal.ml.storeDemandModelMetadata, {
      version,
      trainedAt,
      sampleSize,
      metricsJson: JSON.stringify(metrics),
      payload: JSON.stringify({
        source: "convex_retraining",
        datasetLabel: payload.dataset_label,
        synthetic: payload.synthetic,
        chronologicalSplit: payload.chronological_split,
        warnings: payload.warnings,
      }),
      actorUserId: auth.actorUserId,
    });
    return {
      trained: true,
      version,
      sampleSize,
      synthetic: payload.synthetic === true,
      metrics,
    };
  },
});

export const persistAnomalyFindings = internalMutation({
  args: {
    organizationId: v.optional(v.id("organizations")),
    modelVersion: v.string(),
    syntheticData: v.boolean(),
    component: COMPONENT_VALIDATOR,
    findings: v.array(
      v.object({
        bloodGroup: BLOOD_GROUP_VALIDATOR,
        date: v.string(),
        observed: v.number(),
        expected: v.number(),
        zScore: v.number(),
        direction: v.union(v.literal("spike"), v.literal("drop")),
        severity: v.union(v.literal("warning"), v.literal("critical")),
        reason: v.string(),
      }),
    ),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("anomalyEvents").collect();
    let created = 0;
    for (const finding of args.findings) {
      const at = new Date(`${finding.date}T12:00:00Z`).getTime();
      const duplicate = existing.some(
        (event) =>
          event.bloodGroup === finding.bloodGroup &&
          event.component === args.component &&
          event.at === at &&
          event.modelVersion === args.modelVersion,
      );
      if (duplicate) continue;
      await ctx.db.insert("anomalyEvents", {
        organizationId: args.organizationId,
        kind: finding.direction === "spike" ? "demand_spike" : "stock_drop",
        severity: finding.severity,
        observed: finding.observed,
        expected: finding.expected,
        zScore: finding.zScore,
        at,
        note: `${finding.bloodGroup} ${args.component.replace("_", " ")} · ${finding.reason}`,
        acknowledged: false,
        bloodGroup: finding.bloodGroup,
        component: args.component,
        modelVersion: args.modelVersion,
        syntheticData: args.syntheticData,
        createdAt: Date.now(),
      });
      created += 1;
    }
    const actor = await ctx.db.get(args.actorUserId);
    if (actor) {
      await audit(ctx, {
        actor,
        action: "ml.anomalyScan",
        entityType: "anomalyEvent",
        entityId: String(args.organizationId ?? "network"),
        detail: `Isolation Forest ${args.modelVersion} created ${created} alert(s) for ${args.component}.`,
        organizationId: args.organizationId,
      });
    }
    return { created, scanned: args.findings.length };
  },
});

export const runAnomalyScan = action({
  args: { organizationId: v.optional(v.id("organizations")) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    groupsScanned: number;
    created: number;
    modelVersion: string;
    syntheticData: boolean;
  }> => {
    const auth = await ctx.runQuery(internal.ml.authorizeMlAction, {
      organizationId: args.organizationId,
      mode: "predict",
    });
    const component: Component = "red_cells";
    const history = (await ctx.runQuery(internal.ml.collectDemandHistory, {
      organizationId: args.organizationId,
      days: 120,
    })) as DemandHistory;
    const groups = BLOOD_GROUPS.map((bloodGroup) => {
      const points = continuousPoints(history.records, bloodGroup, component, 120);
      return {
        bloodGroup,
        points,
        total: points.reduce((sum, point) => sum + point.units, 0),
      };
    }).filter((row) => row.total > 0 && row.points.length >= 15);
    if (groups.length === 0) {
      throw new Error("No demand history is available for an anomaly scan.");
    }
    const findings: Array<{
      bloodGroup: BloodGroup;
      date: string;
      observed: number;
      expected: number;
      zScore: number;
      direction: "spike" | "drop";
      severity: "warning" | "critical";
      reason: string;
    }> = [];
    let modelVersion = "isolation-forest-unknown";
    let syntheticData = history.includesDemo;
    for (const group of groups) {
      const response = await mlFetch("/v1/detect/anomalies", {
        method: "POST",
        body: JSON.stringify({
          observations: group.points.map((point) => ({
            date: point.date,
            units: point.units,
          })),
        }),
      }, { timeoutMs: 15_000, attempts: 2 });
      if (!response.ok) {
        throw new Error(`Anomaly service returned HTTP ${response.status} for ${group.bloodGroup}.`);
      }
      const payload = (await response.json()) as {
        status: string;
        model_version?: string | null;
        metrics?: Record<string, unknown> | null;
        synthetic_training_data?: boolean | null;
        findings?: Array<{
          date: string;
          observed: number;
          expected: number;
          z_score: number;
          direction: "spike" | "drop";
          severity: "warning" | "critical";
          reason: string;
        }>;
      };
      if (payload.status === "model_unavailable") {
        throw new Error(
          "The anomaly model artifact is unavailable. Train ml_service/scripts/train_all.py first.",
        );
      }
      modelVersion = payload.model_version ?? modelVersion;
      syntheticData = syntheticData || payload.synthetic_training_data === true;
      for (const finding of payload.findings ?? []) {
        findings.push({
          bloodGroup: group.bloodGroup,
          date: finding.date,
          observed: finding.observed,
          expected: finding.expected,
          zScore: finding.z_score,
          direction: finding.direction,
          severity: finding.severity,
          reason: finding.reason,
        });
      }
    }
    const result = await ctx.runMutation(internal.ml.persistAnomalyFindings, {
      organizationId: args.organizationId,
      modelVersion,
      syntheticData,
      component,
      findings,
      actorUserId: auth.actorUserId,
    });
    return {
      groupsScanned: groups.length,
      created: result.created,
      modelVersion,
      syntheticData,
    };
  },
});

export const storeDemandModelMetadata = internalMutation({
  args: {
    version: v.string(),
    trainedAt: v.number(),
    sampleSize: v.number(),
    metricsJson: v.string(),
    payload: v.string(),
    actorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mlModels")
      .withIndex("by_kind", (q) => q.eq("kind", "demand_forecast").eq("active", true))
      .collect();
    for (const row of existing) {
      await ctx.db.patch(row._id, { active: false });
    }
    await ctx.db.insert("mlModels", {
      kind: "demand_forecast",
      version: args.version,
      trainedAt: args.trainedAt,
      sampleSize: args.sampleSize,
      payload: args.payload,
      metricsJson: args.metricsJson,
      active: true,
    });
    if (args.actorUserId) {
      const actor = await ctx.db.get(args.actorUserId);
      if (actor) {
        await audit(ctx, {
          actor,
          action: "ml.demandModelRegistered",
          entityType: "mlModel",
          entityId: args.version,
          detail: `XGBoost demand model ${args.version} registered from ${args.payload.slice(0, 120)}.`,
        });
      }
    }
    return { stored: true };
  },
});

export const mlServiceStatus = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.ml.authorizeMlAction, { mode: "predict" });
    try {
      const response = await mlFetch("/health", { method: "GET" }, { timeoutMs: 8_000, attempts: 2 });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return { configured: true, reachable: true, ...(await response.json()) };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        error: error instanceof Error ? error.message : "ML service unreachable",
      };
    }
  },
});

/* ------------------------------------------------------------------ */
/* Scheduled refresh
/* ------------------------------------------------------------------ */

/**
 * Daily network forecast when the service is configured. A missing service is
 * logged as skipped rather than fabricating a forecast.
 */
export const refreshScheduledForecasts = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!mlServiceConfigured()) {
      return { skipped: true, reason: "ML_SERVICE_URL is not configured." };
    }
    try {
      const history = (await ctx.runQuery(internal.ml.collectDemandHistory, {
        days: 120,
      })) as DemandHistory;
      const component: Component = "red_cells";
      const activeGroups = BLOOD_GROUPS.map((bloodGroup) => {
        const points = continuousPoints(history.records, bloodGroup, component, 120);
        return {
          bloodGroup,
          points,
          total: points.reduce((sum, point) => sum + point.units, 0),
        };
      }).filter((row) => row.total > 0);
      if (activeGroups.length === 0) {
        return { skipped: true, reason: "No demand history." };
      }
      const response = await mlFetch("/v1/predict/demand/batch", {
        method: "POST",
        body: JSON.stringify({
          series: activeGroups.map((row) => ({
            blood_group: row.bloodGroup,
            component,
            points: row.points,
          })),
          horizon_days: 30,
        }),
      }, { timeoutMs: 20_000, attempts: 2 });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        model_ready: boolean;
        model_version?: string;
        results: Array<{
          blood_group: string;
          status: string;
          metrics?: Record<string, unknown> | null;
          horizons?: { h24?: number | null; h7?: number | null; h30?: number | null };
          explanation?: string;
          confidence?: number | null;
          confidence_label?: string | null;
          synthetic_training_data?: boolean;
        }>;
      };
      if (!payload.model_ready) {
        return { skipped: true, reason: "Model artifact unavailable." };
      }
      const byGroup = new Map(payload.results.map((row) => [row.blood_group, row]));
      const runAt = Date.now();
      const forecasts = BLOOD_GROUPS.map((bloodGroup) => {
        const row = byGroup.get(bloodGroup);
        if (!row || row.status !== "ok") {
          return {
            bloodGroup,
            status: "insufficient_data" as const,
            sampleSize: 0,
            explanation:
              row?.explanation ?? "No recorded demand history for this blood group.",
            horizons: { h24: null, h7: null, h30: null },
          };
        }
        const raw = row.metrics ?? {};
        const trainSize = finiteOrNull(raw.train_size) ?? 0;
        const holdoutSize = finiteOrNull(raw.holdout_size) ?? 0;
        return {
          bloodGroup,
          status: "ok" as const,
          sampleSize: trainSize + holdoutSize,
          metrics: {
            mae: finiteOrNull(raw.mae) ?? 0,
            rmse: finiteOrNull(raw.rmse) ?? 0,
            baselineMae: finiteOrNull(raw.baseline_mae) ?? 0,
            baselineRmse: finiteOrNull(raw.baseline_rmse) ?? 0,
            trainSize,
            holdoutSize,
            meanActual: finiteOrNull(raw.mean_actual) ?? 0,
          },
          confidence: finiteOrNull(row.confidence) ?? undefined,
          confidenceLabel: ["high", "medium", "low"].includes(row.confidence_label ?? "")
            ? (row.confidence_label as "high" | "medium" | "low")
            : undefined,
          explanation:
            row.explanation ??
            "Scheduled XGBoost forecast with chronological holdout evaluation.",
          horizons: {
            h24: finiteOrNull(row.horizons?.h24),
            h7: finiteOrNull(row.horizons?.h7),
            h30: finiteOrNull(row.horizons?.h30),
          },
        };
      });
      const syntheticData =
        payload.results.some((row) => row.synthetic_training_data === true) ||
        history.includesDemo;
      await ctx.runMutation(internal.ml.persistDemandForecasts, {
        scope: "network",
        component,
        runAt,
        modelVersion: payload.model_version ?? "xgboost-demand-unknown",
        syntheticData,
        datasetLabel: syntheticData
          ? "Synthetic/demo transactions; not real hospital demand"
          : "Recorded LifeLink dispatch/issue transactions",
        dataDays: 120,
        forecasts,
      });
      return { stored: forecasts.length };
    } catch (error) {
      return {
        skipped: true,
        reason: error instanceof Error ? error.message : "ML refresh failed.",
      };
    }
  },
});
