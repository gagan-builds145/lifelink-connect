import { describe, expect, test } from "bun:test";
import { convexTest, type TestConvex } from "convex-test";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";

const modules = {
  "./_generated/api.js": () => import("../src/convex/_generated/api"),
  "./_generated/server.js": () => import("../src/convex/_generated/server"),
  "./aiRegistry.ts": () => import("../src/convex/aiRegistry"),
};

type TestApp = TestConvex<typeof schema>;

const checksum = "a".repeat(64);

async function seed(t: TestApp) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const admin = await ctx.db.insert("users", {
      name: "AI Admin",
      email: "ai-admin@test.example",
      role: "admin",
      profileCompleted: true,
      createdAt: now,
    });
    const donor = await ctx.db.insert("users", {
      name: "AI Donor",
      email: "ai-donor@test.example",
      role: "community",
      profileCompleted: true,
      createdAt: now,
    });
    return { admin, donor };
  });
}

function datasetArgs(overrides: Record<string, unknown> = {}) {
  return {
    datasetKey: "demand-history",
    version: "v1",
    stage: "training" as const,
    format: "parquet" as const,
    objectKey: "datasets/training/demand-history/v1/rows.parquet",
    sizeBytes: 1024,
    rowCount: 24,
    checksumSha256: checksum,
    synthetic: true,
    containsPhi: false,
    source: "synthetic generator",
    schemaJson: JSON.stringify({ hour: "string", units: "int64" }),
    retentionDays: 365,
    ...overrides,
  };
}

function modelArgs(overrides: Record<string, unknown> = {}) {
  return {
    modelKind: "lstm_demand" as const,
    version: "2026.11.1",
    datasetKey: "demand-history",
    datasetVersion: "v1",
    framework: "tensorflow",
    artifactKey: "models/lstm_demand/2026.11.1/artifact.keras",
    artifactFormat: "keras" as const,
    sizeBytes: 2048,
    checksumSha256: "b".repeat(64),
    metricsJson: JSON.stringify({ mae: 0.31 }),
    trainingConfigJson: JSON.stringify({ epochs: 10 }),
    trainedAt: Date.now(),
    ...overrides,
  };
}

describe("AI registry and storage metadata", () => {
  test("admin can register a versioned dataset without payload duplication", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seed(t);
    const asAdmin = t.withIdentity({ subject: admin });
    const result = await asAdmin.mutation(api.aiRegistry.registerDataset, datasetArgs());
    expect(result.id).toBeTruthy();
    await expect(
      asAdmin.mutation(api.aiRegistry.registerDataset, datasetArgs()),
    ).rejects.toThrow(/already registered/i);
    const overview = await asAdmin.query(api.aiRegistry.overview, {});
    expect(overview.datasets.active).toBe(1);
    expect(overview.datasets.containsPhi).toBe(0);
    expect(overview.datasets.byStage.training.bytes).toBe(1024);
  });

  test("PHI datasets, checksum duplicates and unsafe keys are refused", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seed(t);
    const asAdmin = t.withIdentity({ subject: admin });
    await expect(
      asAdmin.mutation(api.aiRegistry.registerDataset, datasetArgs({ containsPhi: true })),
    ).rejects.toThrow(/PHI/i);
    await asAdmin.mutation(api.aiRegistry.registerDataset, datasetArgs());
    await expect(
      asAdmin.mutation(
        api.aiRegistry.registerDataset,
        datasetArgs({ version: "v2", objectKey: "datasets/training/demand-history/v2/rows.parquet" }),
      ),
    ).rejects.toThrow(/identical dataset/i);
    await expect(
      asAdmin.mutation(
        api.aiRegistry.registerDataset,
        datasetArgs({ version: "v3", objectKey: "secrets/rows.parquet" }),
      ),
    ).rejects.toThrow(/controlled AI object key|declared stage/i);
  });

  test("non-admin users cannot read or write the AI registry", async () => {
    const t = convexTest(schema, modules);
    const { donor } = await seed(t);
    const asDonor = t.withIdentity({ subject: donor });
    await expect(asDonor.query(api.aiRegistry.overview, {})).rejects.toThrow(/authorized|permission|admin/i);
    await expect(
      asDonor.mutation(api.aiRegistry.registerDataset, datasetArgs()),
    ).rejects.toThrow(/authorized|permission|admin/i);
  });

  test("model artifacts require an active dataset and .keras for TensorFlow", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seed(t);
    const asAdmin = t.withIdentity({ subject: admin });
    await expect(
      asAdmin.mutation(api.aiRegistry.registerModelArtifact, modelArgs()),
    ).rejects.toThrow(/active dataset/i);
    await asAdmin.mutation(api.aiRegistry.registerDataset, datasetArgs());
    await expect(
      asAdmin.mutation(
        api.aiRegistry.registerModelArtifact,
        modelArgs({ artifactFormat: "joblib", artifactKey: "models/lstm_demand/v1/artifact.joblib" }),
      ),
    ).rejects.toThrow(/keras/i);
    const result = await asAdmin.mutation(api.aiRegistry.registerModelArtifact, modelArgs());
    expect(result.id).toBeTruthy();
    const overview = await asAdmin.query(api.aiRegistry.overview, {});
    expect(overview.models.candidates).toBe(1);
    expect(overview.models.active).toBe(0);
  });

  test("promotion activates one version and rolls back the previous", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seed(t);
    const asAdmin = t.withIdentity({ subject: admin });
    await asAdmin.mutation(api.aiRegistry.registerDataset, datasetArgs());
    const first = await asAdmin.mutation(api.aiRegistry.registerModelArtifact, modelArgs());
    await asAdmin.mutation(api.aiRegistry.promoteModel, { artifactId: first.id });
    let overview = await asAdmin.query(api.aiRegistry.overview, {});
    expect(overview.models.active).toBe(1);
    expect(overview.models.activeByKind[0].version).toBe("2026.11.1");

    const second = await asAdmin.mutation(
      api.aiRegistry.registerModelArtifact,
      modelArgs({
        version: "2026.11.2",
        artifactKey: "models/lstm_demand/2026.11.2/artifact.keras",
        checksumSha256: "c".repeat(64),
      }),
    );
    await asAdmin.mutation(api.aiRegistry.promoteModel, { artifactId: second.id });
    overview = await asAdmin.query(api.aiRegistry.overview, {});
    expect(overview.models.active).toBe(1);
    expect(overview.models.activeByKind[0].version).toBe("2026.11.2");
  });

  test("an active model can be disabled but a rejected model cannot be promoted", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seed(t);
    const asAdmin = t.withIdentity({ subject: admin });
    await asAdmin.mutation(api.aiRegistry.registerDataset, datasetArgs());
    const model = await asAdmin.mutation(api.aiRegistry.registerModelArtifact, modelArgs());
    await asAdmin.mutation(api.aiRegistry.promoteModel, { artifactId: model.id });
    await asAdmin.mutation(api.aiRegistry.disableModel, {
      artifactId: model.id,
      reason: "Regression test disable",
    });
    const overview = await asAdmin.query(api.aiRegistry.overview, {});
    expect(overview.models.active).toBe(0);
    await expect(
      asAdmin.mutation(api.aiRegistry.promoteModel, { artifactId: model.id }),
    ).rejects.toThrow(/Rejected/i);
  });

  test("storage snapshots enforce explicit finite capacity and expansion flags", async () => {
    const t = convexTest(schema, modules);
    const { admin } = await seed(t);
    const asAdmin = t.withIdentity({ subject: admin });
    await asAdmin.mutation(api.aiRegistry.recordStorageSnapshot, {
      capturedAt: Date.now(),
      provider: "s3",
      bucket: "lifelink-ai-test",
      capacityBytes: 1000,
      usedBytes: 850,
      objectCount: 12,
      thresholdPct: 80,
      byStageJson: JSON.stringify({ training: 850 }),
      reportJson: JSON.stringify({ provider: "s3" }),
    });
    const overview = await asAdmin.query(api.aiRegistry.overview, {});
    expect(overview.storage?.needsExpansion).toBe(true);
    expect(overview.storage?.usagePct).toBe(85);
    await expect(
      asAdmin.mutation(api.aiRegistry.recordStorageSnapshot, {
        capturedAt: Date.now(),
        provider: "s3",
        bucket: "lifelink-ai-test",
        capacityBytes: 0,
        usedBytes: 1,
        objectCount: 0,
        thresholdPct: 80,
        byStageJson: "{}",
        reportJson: "{}",
      }),
    ).rejects.toThrow(/Capacity/i);
  });
});
