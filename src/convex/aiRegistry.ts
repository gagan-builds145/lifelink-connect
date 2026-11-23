import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, requireAdmin } from "./lib/helpers";
import {
  aiDatasetStageValidator,
  aiDatasetStatusValidator,
  aiModelKindValidator,
  aiTrainingRunStatusValidator,
} from "./validators";

const CHECKSUM = /^[a-f0-9]{64}$/;
const SAFE_KEY = /^(datasets|models|checkpoints|evaluations|training-logs|backups)\/[A-Za-z0-9._/-]+$/;

function requireFinite(value: number, label: string, minimum = 0) {
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} is invalid.`);
  }
}

function requireKey(value: string, label: string) {
  const key = value.trim().replace(/^\/+/, "");
  if (!SAFE_KEY.test(key) || key.includes("..")) {
    throw new Error(`${label} must be a controlled AI object key.`);
  }
  return key;
}

function requireText(value: string, label: string, max = 180) {
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`${label} is required.`);
  return text;
}

/**
 * AI storage and model registry summary. This reads metadata only; datasets,
 * artifacts and logs stay in S3-compatible object storage.
 */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [datasets, artifacts, runs, snapshots, predictions, retention] =
      await Promise.all([
        ctx.db.query("aiDatasets").collect(),
        ctx.db.query("aiModelArtifacts").collect(),
        ctx.db.query("aiTrainingRuns").collect(),
        ctx.db.query("aiStorageSnapshots").order("desc").take(30),
        ctx.db.query("aiPredictionSummaries").collect(),
        ctx.db.query("aiRetentionRuns").order("desc").take(10),
      ]);
    const latest = snapshots[0] ?? null;
    const byStage: Record<string, { objects: number; bytes: number }> = {};
    for (const dataset of datasets) {
      if (dataset.status !== "active") continue;
      const row = byStage[dataset.stage] ?? { objects: 0, bytes: 0 };
      row.objects += 1;
      row.bytes += dataset.sizeBytes;
      byStage[dataset.stage] = row;
    }
    const activeModels = artifacts.filter((item) => item.status === "active");
    const candidates = artifacts.filter((item) => item.status === "candidate");
    const failedRuns = runs.filter((run) => run.status === "failed");
    const predictionCount = predictions.reduce((sum, item) => sum + item.predictionCount, 0);
    const predictionErrors = predictions.reduce((sum, item) => sum + item.errorCount, 0);
    const capacityBytes = latest?.capacityBytes ?? 0;
    const usedBytes = latest?.usedBytes ?? 0;
    return {
      datasets: {
        total: datasets.length,
        active: datasets.filter((item) => item.status === "active").length,
        synthetic: datasets.filter((item) => item.synthetic).length,
        containsPhi: datasets.filter((item) => item.containsPhi).length,
        byStage,
      },
      models: {
        total: artifacts.length,
        active: activeModels.length,
        candidates: candidates.length,
        activeByKind: activeModels.map((item) => ({
          id: item._id,
          kind: item.modelKind,
          version: item.version,
          trainedAt: item.trainedAt,
          datasetVersion: item.datasetVersion,
          metricsJson: item.metricsJson,
        })),
        recentCandidates: candidates
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 10)
          .map((item) => ({
            id: item._id,
            kind: item.modelKind,
            version: item.version,
            trainedAt: item.trainedAt,
            datasetVersion: item.datasetVersion,
            artifactFormat: item.artifactFormat,
          })),
      },
      training: {
        total: runs.length,
        running: runs.filter((run) => run.status === "running").length,
        succeeded: runs.filter((run) => run.status === "succeeded").length,
        failed: failedRuns.length,
        lastFinishedAt:
          runs
            .map((run) => run.finishedAt)
            .filter((value): value is number => typeof value === "number")
            .sort((a, b) => b - a)[0] ?? null,
      },
      predictions: {
        total: predictionCount,
        errors: predictionErrors,
        modelCount: predictions.length,
      },
      storage: latest
        ? {
            capturedAt: latest.capturedAt,
            provider: latest.provider,
            bucket: latest.bucket,
            capacityBytes,
            usedBytes,
            objectCount: latest.objectCount,
            thresholdPct: latest.thresholdPct,
            usagePct:
              capacityBytes > 0
                ? Math.round((usedBytes / capacityBytes) * 10000) / 100
                : null,
            needsExpansion: latest.needsExpansion,
            headroomBytes: Math.max(0, capacityBytes - usedBytes),
            byStageJson: latest.byStageJson,
          }
        : null,
      retention: retention.map((run) => ({
        id: run._id,
        status: run.status,
        startedAt: run.startedAt,
        deletedObjects: run.deletedObjects,
        deletedBytes: run.deletedBytes,
      })),
      history: snapshots.map((snapshot) => ({
        capturedAt: snapshot.capturedAt,
        usedBytes: snapshot.usedBytes,
        capacityBytes: snapshot.capacityBytes,
        objectCount: snapshot.objectCount,
      })),
    };
  },
});

export const datasets = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    return await ctx.db.query("aiDatasets").order("desc").take(limit);
  },
});

export const models = query({
  args: {
    kind: v.optional(aiModelKindValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    if (args.kind) {
      return await ctx.db
        .query("aiModelArtifacts")
        .withIndex("by_kind", (q) => q.eq("modelKind", args.kind!))
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("aiModelArtifacts").order("desc").take(limit);
  },
});

export const trainingRuns = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 200);
    return await ctx.db.query("aiTrainingRuns").order("desc").take(limit);
  },
});

export const registerDataset = mutation({
  args: {
    datasetKey: v.string(),
    version: v.string(),
    stage: aiDatasetStageValidator,
    format: v.union(v.literal("parquet"), v.literal("csv"), v.literal("json")),
    objectKey: v.string(),
    sizeBytes: v.number(),
    rowCount: v.optional(v.number()),
    checksumSha256: v.string(),
    synthetic: v.boolean(),
    containsPhi: v.boolean(),
    source: v.string(),
    schemaJson: v.string(),
    retentionDays: v.number(),
    lineage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (args.containsPhi) {
      throw new Error("AI datasets must be minimised and anonymised; PHI is refused.");
    }
    if (!CHECKSUM.test(args.checksumSha256)) {
      throw new Error("A SHA-256 checksum is required.");
    }
    requireFinite(args.sizeBytes, "Dataset size", 1);
    requireFinite(args.retentionDays, "Retention", 1);
    if (args.rowCount !== undefined) requireFinite(args.rowCount, "Row count", 0);
    const objectKey = requireKey(args.objectKey, "Dataset object key");
    if (!objectKey.startsWith(`datasets/${args.stage}/`)) {
      throw new Error("Dataset object key must use its declared stage.");
    }
    const existing = await ctx.db
      .query("aiDatasets")
      .withIndex("by_dataset", (q) =>
        q.eq("datasetKey", args.datasetKey).eq("version", args.version),
      )
      .first();
    if (existing) throw new Error("That dataset version is already registered.");
    const duplicate = await ctx.db
      .query("aiDatasets")
      .withIndex("by_checksum", (q) => q.eq("checksumSha256", args.checksumSha256))
      .first();
    if (duplicate) throw new Error("An identical dataset payload is already registered.");
    const id = await ctx.db.insert("aiDatasets", {
      ...args,
      datasetKey: requireText(args.datasetKey, "Dataset key", 80),
      version: requireText(args.version, "Dataset version", 80),
      objectKey,
      source: requireText(args.source, "Dataset source", 200),
      status: "active",
      createdAt: Date.now(),
    });
    await audit(ctx, {
      actor: admin,
      action: "ai.dataset_registered",
      entityType: "aiDatasets",
      entityId: id,
      detail: `${args.datasetKey}@${args.version} (${args.stage})`,
    });
    return { id };
  },
});

export const setDatasetStatus = mutation({
  args: { datasetId: v.id("aiDatasets"), status: aiDatasetStatusValidator },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const dataset = await ctx.db.get(args.datasetId);
    if (!dataset) throw new Error("Dataset not found.");
    await ctx.db.patch(dataset._id, { status: args.status });
    await audit(ctx, {
      actor: admin,
      action: "ai.dataset_status",
      entityType: "aiDatasets",
      entityId: dataset._id,
      detail: `${dataset.datasetKey}@${dataset.version}: ${args.status}`,
    });
    return { ok: true };
  },
});

export const registerModelArtifact = mutation({
  args: {
    modelKind: aiModelKindValidator,
    version: v.string(),
    datasetKey: v.string(),
    datasetVersion: v.string(),
    framework: v.string(),
    artifactKey: v.string(),
    artifactFormat: v.union(
      v.literal("keras"),
      v.literal("joblib"),
      v.literal("json"),
      v.literal("onnx"),
      v.literal("safetensors"),
    ),
    sizeBytes: v.number(),
    checksumSha256: v.string(),
    preprocessingKey: v.optional(v.string()),
    evaluationKey: v.optional(v.string()),
    metricsJson: v.string(),
    trainingConfigJson: v.string(),
    trainedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    if (!CHECKSUM.test(args.checksumSha256)) throw new Error("A SHA-256 checksum is required.");
    requireFinite(args.sizeBytes, "Artifact size", 1);
    if (["ann_donor", "lstm_demand", "autoencoder_inventory", "cnn_research"].includes(args.modelKind) && args.artifactFormat !== "keras") {
      throw new Error("TensorFlow/Keras models must use .keras artifacts.");
    }
    const artifactKey = requireKey(args.artifactKey, "Artifact key");
    if (!artifactKey.startsWith(`models/${args.modelKind}/`)) {
      throw new Error("Artifact key must use the declared model kind.");
    }
    const dataset = await ctx.db
      .query("aiDatasets")
      .withIndex("by_dataset", (q) =>
        q.eq("datasetKey", args.datasetKey).eq("version", args.datasetVersion),
      )
      .first();
    if (!dataset || dataset.status !== "active") {
      throw new Error("Register an active dataset version before its model artifact.");
    }
    const duplicate = await ctx.db
      .query("aiModelArtifacts")
      .withIndex("by_kind", (q) => q.eq("modelKind", args.modelKind))
      .filter((q) => q.eq(q.field("version"), args.version))
      .first();
    if (duplicate) throw new Error("That model version is already registered.");
    const id = await ctx.db.insert("aiModelArtifacts", {
      ...args,
      version: requireText(args.version, "Model version", 80),
      framework: requireText(args.framework, "Framework", 60),
      artifactKey,
      metricsJson: requireText(args.metricsJson, "Metrics JSON", 20000),
      trainingConfigJson: requireText(args.trainingConfigJson, "Training config", 20000),
      status: "candidate",
      createdAt: Date.now(),
    });
    await audit(ctx, {
      actor: admin,
      action: "ai.model_registered",
      entityType: "aiModelArtifacts",
      entityId: id,
      detail: `${args.modelKind}@${args.version}`,
    });
    return { id };
  },
});

export const promoteModel = mutation({
  args: { artifactId: v.id("aiModelArtifacts"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const target = await ctx.db.get(args.artifactId);
    if (!target) throw new Error("Model artifact not found.");
    if (target.status === "rejected") throw new Error("Rejected artifacts cannot be promoted.");
    if (target.status === "active") return { ok: true };
    const current = await ctx.db
      .query("aiModelArtifacts")
      .withIndex("by_kind", (q) => q.eq("modelKind", target.modelKind).eq("status", "active"))
      .collect();
    for (const model of current) {
      await ctx.db.patch(model._id, { status: "rolled_back" });
    }
    const now = Date.now();
    await ctx.db.patch(target._id, {
      status: "active",
      approvedByUserId: admin._id,
      approvedAt: now,
    });
    await audit(ctx, {
      actor: admin,
      action: "ai.model_promoted",
      entityType: "aiModelArtifacts",
      entityId: target._id,
      detail: `${target.modelKind}@${target.version}${args.note ? ` — ${args.note}` : ""}`,
    });
    return { ok: true };
  },
});

export const recordStorageSnapshot = mutation({
  args: {
    capturedAt: v.number(),
    provider: v.string(),
    bucket: v.string(),
    capacityBytes: v.number(),
    usedBytes: v.number(),
    objectCount: v.number(),
    thresholdPct: v.number(),
    byStageJson: v.string(),
    reportJson: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    requireFinite(args.capacityBytes, "Capacity", 1);
    requireFinite(args.usedBytes, "Used bytes", 0);
    requireFinite(args.objectCount, "Object count", 0);
    if (args.thresholdPct < 1 || args.thresholdPct > 100) {
      throw new Error("Expansion threshold must be between 1 and 100.");
    }
    const id = await ctx.db.insert("aiStorageSnapshots", {
      ...args,
      provider: requireText(args.provider, "Storage provider", 40),
      bucket: requireText(args.bucket, "Bucket", 120),
      needsExpansion: args.usedBytes >= args.capacityBytes * (args.thresholdPct / 100),
    });
    return { id };
  },
});

export const recordTrainingRun = mutation({
  args: {
    runKey: v.string(),
    modelKind: aiModelKindValidator,
    modelVersion: v.string(),
    datasetKey: v.string(),
    datasetVersion: v.string(),
    status: aiTrainingRunStatusValidator,
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    configJson: v.string(),
    metricsJson: v.optional(v.string()),
    logsKey: v.optional(v.string()),
    artifactKey: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const runKey = requireText(args.runKey, "Training run key", 120);
    const existing = await ctx.db
      .query("aiTrainingRuns")
      .withIndex("by_run", (q) => q.eq("runKey", runKey))
      .first();
    const now = Date.now();
    const duration =
      args.startedAt && args.finishedAt
        ? Math.max(0, Math.round((args.finishedAt - args.startedAt) / 1000))
        : undefined;
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        runKey,
        durationSeconds: duration,
      });
      return { id: existing._id };
    }
    const id = await ctx.db.insert("aiTrainingRuns", {
      ...args,
      runKey,
      durationSeconds: duration,
      createdAt: now,
    });
    return { id };
  },
});

export const recordPredictionSummary = mutation({
  args: {
    modelKind: aiModelKindValidator,
    modelVersion: v.string(),
    windowStart: v.number(),
    windowEnd: v.number(),
    predictionCount: v.number(),
    errorCount: v.number(),
    p50LatencyMs: v.optional(v.number()),
    p95LatencyMs: v.optional(v.number()),
    synthetic: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    requireFinite(args.predictionCount, "Prediction count", 0);
    requireFinite(args.errorCount, "Error count", 0);
    if (args.errorCount > args.predictionCount) {
      throw new Error("Error count cannot exceed prediction count.");
    }
    if (args.windowEnd < args.windowStart) throw new Error("Invalid prediction window.");
    const id = await ctx.db.insert("aiPredictionSummaries", {
      ...args,
      modelVersion: requireText(args.modelVersion, "Model version", 80),
      updatedAt: Date.now(),
    });
    return { id };
  },
});
