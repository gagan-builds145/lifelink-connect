import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  audit,
  optionalUser,
  requireAdmin,
  requireUser,
  roleOf,
  type AppRole,
} from "./lib/helpers";
import { evaluateStockLevel } from "./lib/stockWatch";
import {
  BLOOD_GROUPS,
  COMPONENTS,
  type BloodGroup,
  type Component,
} from "../lib/blood";

const integrationKind = v.union(
  v.literal("hms_api"),
  v.literal("blood_bank_api"),
  v.literal("rest_webhook"),
  v.literal("database_replica"),
);

const inventoryRecordValidator = v.object({
  externalUnitRef: v.string(),
  bloodGroup: v.string(),
  component: v.string(),
  units: v.number(),
  collectedAt: v.string(),
  expiresAt: v.string(),
  storageLocation: v.string(),
  screened: v.boolean(),
  released: v.boolean(),
  storageTempC: v.optional(v.number()),
});

type InventoryRecord = {
  externalUnitRef: string;
  bloodGroup: string;
  component: string;
  units: number;
  collectedAt: string;
  expiresAt: string;
  storageLocation: string;
  screened: boolean;
  released: boolean;
  storageTempC?: number;
};

const iso = (daysAhead: number) =>
  new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

/**
 * Sample adapter payload. It is deterministic, labelled isDemo and returned
 * only by an integration explicitly registered as mock. It is never mixed into
 * a live facility's unreleased inventory without the demo flag.
 */
function mockRecords(): InventoryRecord[] {
  return [
    {
      externalUnitRef: "MOCK-O-POS-001",
      bloodGroup: "O+",
      component: "red_cells",
      units: 6,
      collectedAt: iso(-6),
      expiresAt: iso(29),
      storageLocation: "Mock cold room A · 2–6 °C",
      screened: true,
      released: true,
      storageTempC: 4,
    },
    {
      externalUnitRef: "MOCK-A-POS-002",
      bloodGroup: "A+",
      component: "platelets",
      units: 3,
      collectedAt: iso(-1),
      expiresAt: iso(4),
      storageLocation: "Mock agitator · 20–24 °C",
      screened: true,
      released: true,
      storageTempC: 22,
    },
    {
      externalUnitRef: "MOCK-B-POS-003",
      bloodGroup: "B+",
      component: "whole_blood",
      units: 4,
      collectedAt: iso(-9),
      expiresAt: iso(26),
      storageLocation: "Mock vault B · 2–6 °C",
      screened: true,
      released: true,
      storageTempC: 5,
    },
    {
      externalUnitRef: "MOCK-AB-NEG-004",
      bloodGroup: "AB-",
      component: "plasma",
      units: 5,
      collectedAt: iso(-21),
      expiresAt: iso(160),
      storageLocation: "Mock freezer · ≤ −25 °C",
      screened: true,
      released: true,
      storageTempC: -30,
    },
  ];
}

function normalizeRecord(record: InventoryRecord) {
  const bloodGroup = BLOOD_GROUPS.includes(record.bloodGroup as BloodGroup)
    ? (record.bloodGroup as BloodGroup)
    : null;
  const component = COMPONENTS.includes(record.component as Component)
    ? (record.component as Component)
    : null;
  const collected = new Date(record.collectedAt);
  const expiry = new Date(record.expiresAt);
  if (!bloodGroup || !component) return null;
  if (Number.isNaN(collected.getTime()) || Number.isNaN(expiry.getTime())) return null;
  if (!Number.isFinite(record.units) || record.units < 0) return null;
  if (expiry <= collected) return null;
  const ref = (record.externalUnitRef ?? "").trim();
  if (!ref) return null;
  return {
    externalUnitRef: ref,
    bloodGroup,
    component,
    units: Math.round(record.units),
    collectionDate: collected.toISOString().slice(0, 10),
    expiryDate: expiry.toISOString().slice(0, 10),
    storageLocation: (record.storageLocation ?? "Imported batch").trim().slice(0, 120),
    screened: record.screened === true,
    released: record.released === true,
    storageTempC: record.storageTempC,
  };
}

/* ------------------------------------------------------------------ *
 * Registration and visibility
 * ------------------------------------------------------------------ */

export const registerIntegration = mutation({
  args: {
    organizationId: v.id("organizations"),
    kind: integrationKind,
    label: v.string(),
    baseUrl: v.optional(v.string()),
    authScheme: v.union(
      v.literal("api_key"),
      v.literal("bearer"),
      v.literal("basic"),
      v.literal("none"),
    ),
    credentialEnvVar: v.optional(v.string()),
    syncMode: v.union(v.literal("event"), v.literal("periodic"), v.literal("manual")),
    isMock: v.boolean(),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const org = await ctx.db.get(args.organizationId);
    if (!org) throw new Error("Organization not found.");
    if (org.status !== "verified") {
      throw new Error("Only verified facilities can be connected.");
    }
    const label = args.label.trim();
    if (label.length < 3) throw new Error("Give the integration a descriptive label.");
    const now = Date.now();
    const integrationId = await ctx.db.insert("facilityIntegrations", {
      organizationId: org._id,
      kind: args.kind,
      label,
      baseUrl: args.baseUrl?.trim(),
      authScheme: args.authScheme,
      credentialEnvVar: args.credentialEnvVar?.trim(),
      syncMode: args.syncMode,
      status: args.isMock ? "connected" : "not_configured",
      isMock: args.isMock,
      lastSyncStatus: "never",
      configNote: args.isMock
        ? "Mock adapter. Every imported batch is flagged as demo data and is never shown as live hospital inventory."
        : "Live adapter. Requires the named environment variable and a reachable endpoint. Sync failures are recorded and surfaced; no data is invented.",
      createdAt: now,
      updatedAt: now,
    });
    await audit(ctx, {
      actor: admin,
      action: "integration.registered",
      entityType: "facilityIntegration",
      entityId: String(integrationId),
      detail: `${label} (${args.kind}) registered for ${org.name}${args.isMock ? " as a labelled mock adapter" : ""}.`,
      organizationId: org._id,
    });
    return { integrationId };
  },
});

export const listIntegrations = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const role = roleOf(user);
    const all = await ctx.db.query("facilityIntegrations").collect();
    const scoped = all.filter(
      (row) => role === "admin" || (user.organizationId != null && row.organizationId === user.organizationId),
    );
    const orgs = await ctx.db.query("organizations").collect();
    const orgById = new Map(orgs.map((o) => [o._id, o]));
    const runs = await ctx.db.query("facilitySyncRuns").collect();
    const runsByIntegration = new Map<string, Doc<"facilitySyncRuns">[]>();
    for (const run of runs) {
      const key = String(run.integrationId);
      runsByIntegration.set(key, [...(runsByIntegration.get(key) ?? []), run]);
    }

    return scoped
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((row) => {
        const org = orgById.get(row.organizationId);
        const history = (runsByIntegration.get(String(row._id)) ?? [])
          .sort((a, b) => b.startedAt - a.startedAt)
          .slice(0, 3)
          .map((run) => ({
            _id: run._id,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt ?? null,
            status: run.status,
            source: run.source,
            recordsRead: run.recordsRead,
            recordsApplied: run.recordsApplied,
            error: run.error ?? null,
            isMock: run.isMock,
          }));
        return {
          _id: row._id,
          organizationId: row.organizationId,
          organizationName: org?.name ?? "Unknown facility",
          organizationCity: org?.city ?? null,
          organizationType: org?.type ?? null,
          kind: row.kind,
          label: row.label,
          baseUrl: row.baseUrl ?? null,
          authScheme: row.authScheme,
          credentialEnvVar: row.credentialEnvVar ?? null,
          syncMode: row.syncMode,
          status: row.status,
          isMock: row.isMock,
          lastSyncAt: row.lastSyncAt ?? null,
          lastSyncStatus: row.lastSyncStatus ?? "never",
          lastError: row.lastError ?? null,
          recordsLastSync: row.recordsLastSync ?? 0,
          configNote: row.configNote ?? null,
          history,
          isDemo: org?.isDemo ?? false,
        };
      });
  },
});

/* ------------------------------------------------------------------ *
 * Mock sync
 * ------------------------------------------------------------------ */

export const runMockSync = mutation({
  args: { integrationId: v.id("facilityIntegrations") },
  handler: async (ctx, args) => {
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Integration not found.");
    if (!integration.isMock) {
      throw new Error(
        "This is a live integration. Use the credentialed live sync, which records failures instead of inventing inventory.",
      );
    }
    const user = await requireUser(ctx);
    await assertIntegrationAccess(ctx, user, integration);
    const startedAt = Date.now();
    const runId = await ctx.db.insert("facilitySyncRuns", {
      integrationId: integration._id,
      organizationId: integration.organizationId,
      startedAt,
      status: "running",
      source: "mock",
      recordsRead: 0,
      recordsApplied: 0,
      isMock: true,
      actorUserId: user._id,
    });
    const result = await applyRecords(ctx, {
      integration,
      records: mockRecords(),
      source: "mock",
      runId,
      startedAt,
      actorUserId: user._id,
    });
    return { ...result, isMock: true, message: "Mock sync completed. Imported batches are marked Demo." };
  },
});

/* ------------------------------------------------------------------ *
 * Shared import logic. Internal: only actions/mutations already authorized
 * can reach it.
 * ------------------------------------------------------------------ */

async function assertIntegrationAccess(
  ctx: MutationCtx,
  user: Doc<"users">,
  integration: Doc<"facilityIntegrations">,
) {
  const role = roleOf(user);
  if (role === "admin") return;
  if (user.organizationId !== integration.organizationId) {
    throw new Error("This integration belongs to another facility.");
  }
  const allowed: AppRole[] = ["hospital", "red_cross"];
  if (!allowed.includes(role)) {
    throw new Error("Only facility staff can run an inventory sync.");
  }
}

async function applyRecords(
  ctx: MutationCtx,
  input: {
    integration: Doc<"facilityIntegrations">;
    records: InventoryRecord[];
    source: "mock" | "live";
    runId: Id<"facilitySyncRuns">;
    startedAt: number;
    actorUserId?: Id<"users">;
    error?: string;
  },
) {
  const org = await ctx.db.get(input.integration.organizationId);
  if (!org) throw new Error("Linked facility not found.");
  const existing = await ctx.db
    .query("inventory")
    .withIndex("by_organization", (q) => q.eq("organizationId", org._id))
    .collect();
  const byRef = new Map(
    existing.filter((b) => b.externalUnitRef).map((b) => [`${b.integrationId}:${b.externalUnitRef}`, b]),
  );

  let applied = 0;
  let read = 0;
  const touched = new Set<string>();
  const now = Date.now();
  for (const raw of input.records) {
    read += 1;
    const record = normalizeRecord(raw);
    if (!record) continue;
    const key = `${input.integration._id}:${record.externalUnitRef}`;
    const current = byRef.get(key);
    if (current) {
      await ctx.db.patch(current._id, {
        unitsAvailable: record.units,
        collectionDate: record.collectionDate,
        expiryDate: record.expiryDate,
        storageLocation: record.storageLocation,
        screened: record.screened,
        released: record.released,
        storageTempC: record.storageTempC,
        verified: true,
        lastUpdated: now,
      });
    } else {
      await ctx.db.insert("inventory", {
        organizationId: org._id,
        bloodGroup: record.bloodGroup,
        component: record.component,
        unitsAvailable: record.units,
        unitsReserved: 0,
        collectionDate: record.collectionDate,
        expiryDate: record.expiryDate,
        storageLocation: record.storageLocation,
        batchRef: record.externalUnitRef,
        lowStockThreshold: 1,
        verified: true,
        screened: record.screened,
        released: record.released,
        protectedReserve: org.protectedReserveDefault ?? 0,
        storageTempC: record.storageTempC,
        integrationId: input.integration._id,
        externalUnitRef: record.externalUnitRef,
        lastUpdated: now,
        isDemo: input.source === "mock" || (org.isDemo ?? false),
        createdAt: now,
      });
    }
    applied += 1;
    touched.add(`${record.bloodGroup}:${record.component}`);
  }

  const finishedAt = Date.now();
  await ctx.db.patch(input.runId, {
    finishedAt,
    status: input.error ? "failed" : applied === read ? "success" : applied > 0 ? "partial" : "failed",
    recordsRead: read,
    recordsApplied: applied,
    error: input.error,
  });
  await ctx.db.patch(input.integration._id, {
    lastSyncAt: finishedAt,
    lastSyncStatus: input.error ? "failed" : applied === read ? "success" : applied > 0 ? "partial" : "failed",
    lastError: input.error,
    recordsLastSync: applied,
    status: input.error ? "error" : "connected",
    updatedAt: finishedAt,
  });

  for (const pair of touched) {
    const [group, component] = pair.split(":") as [BloodGroup, Component];
    await evaluateStockLevel(ctx, org, group, component);
  }

  if (input.error) {
    await ctx.db.insert("anomalyEvents", {
      organizationId: org._id,
      kind: "sync_failure",
      severity: "critical",
      observed: 0,
      expected: 1,
      at: finishedAt,
      note: `${input.integration.label}: ${input.error}`,
      acknowledged: false,
      createdAt: finishedAt,
    });
  }

  if (!input.error) {
    await ctx.db.insert("auditLogs", {
      actorUserId: input.actorUserId,
      actorRole: "system",
      action: input.source === "mock" ? "integration.mockSync" : "integration.liveSync",
      entityType: "facilityIntegration",
      entityId: String(input.integration._id),
      detail: `${applied}/${read} record(s) applied from ${input.integration.label}${input.source === "mock" ? " (demo data)" : ""}.`,
      organizationId: org._id,
      isDemo: input.source === "mock",
      createdAt: finishedAt,
    });
  }

  return { recordsRead: read, recordsApplied: applied };
}

/* ------------------------------------------------------------------ *
 * Live sync: real HTTP call, real failure reporting.
 * ------------------------------------------------------------------ */

export const authorizeLiveSync = internalQuery({
  args: { integrationId: v.id("facilityIntegrations") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Integration not found.");
    const role = roleOf(user);
    if (role !== "admin" && user.organizationId !== integration.organizationId) {
      throw new Error("This integration belongs to another facility.");
    }
    return {
      integration: {
        _id: integration._id,
        organizationId: integration.organizationId,
        label: integration.label,
        baseUrl: integration.baseUrl ?? null,
        authScheme: integration.authScheme,
        credentialEnvVar: integration.credentialEnvVar ?? null,
        isMock: integration.isMock,
      },
      actorUserId: user._id,
    };
  },
});

export const beginLiveRun = internalMutation({
  args: {
    integrationId: v.id("facilityIntegrations"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Integration not found.");
    const runId = await ctx.db.insert("facilitySyncRuns", {
      integrationId: integration._id,
      organizationId: integration.organizationId,
      startedAt: Date.now(),
      status: "running",
      source: "live",
      recordsRead: 0,
      recordsApplied: 0,
      isMock: false,
      actorUserId: args.actorUserId,
    });
    return { runId };
  },
});

export const applyLiveRun = internalMutation({
  args: {
    integrationId: v.id("facilityIntegrations"),
    runId: v.id("facilitySyncRuns"),
    records: v.array(inventoryRecordValidator),
    actorUserId: v.id("users"),
    error: v.optional(v.string()),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const integration = await ctx.db.get(args.integrationId);
    if (!integration) throw new Error("Integration not found.");
    if (args.error) {
      const finishedAt = Date.now();
      await ctx.db.patch(args.runId, {
        status: "failed",
        finishedAt,
        error: args.error,
      });
      await ctx.db.patch(integration._id, {
        status: "error",
        lastSyncStatus: "failed",
        lastError: args.error,
        lastSyncAt: finishedAt,
        updatedAt: finishedAt,
      });
      await ctx.db.insert("anomalyEvents", {
        organizationId: integration.organizationId,
        kind: "sync_failure",
        severity: "critical",
        observed: 0,
        expected: 1,
        at: finishedAt,
        note: `${integration.label}: ${args.error}`,
        acknowledged: false,
        createdAt: finishedAt,
      });
      return { recordsRead: 0, recordsApplied: 0, failed: true };
    }
    return await applyRecords(ctx, {
      integration,
      records: args.records,
      source: "live",
      runId: args.runId,
      startedAt: args.startedAt,
      actorUserId: args.actorUserId,
    });
  },
});

export const runLiveSync = action({
  args: { integrationId: v.id("facilityIntegrations") },
  handler: async (ctx, args): Promise<{ recordsRead: number; recordsApplied: number; failed?: boolean }> => {
    const authorized = await ctx.runQuery(internal.integrations.authorizeLiveSync, {
      integrationId: args.integrationId,
    });
    if (authorized.integration.isMock) {
      throw new Error("Mock integrations must use the labelled mock sync.");
    }
    const startedAt = Date.now();
    const { runId } = await ctx.runMutation(internal.integrations.beginLiveRun, {
      integrationId: args.integrationId,
      actorUserId: authorized.actorUserId,
    });

    const baseUrl = authorized.integration.baseUrl;
    const envVar = authorized.integration.credentialEnvVar;
    if (!baseUrl || !envVar) {
      return await ctx.runMutation(internal.integrations.applyLiveRun, {
        integrationId: args.integrationId,
        runId,
        records: [],
        actorUserId: authorized.actorUserId,
        startedAt,
        error: "Endpoint URL or credential environment variable is not configured.",
      });
    }
    const credential = process.env[envVar];
    if (!credential) {
      return await ctx.runMutation(internal.integrations.applyLiveRun, {
        integrationId: args.integrationId,
        runId,
        records: [],
        actorUserId: authorized.actorUserId,
        startedAt,
        error: `Credential environment variable ${envVar} is not set on the deployment. Add it in Keys/API keys, then retry.`,
      });
    }

    try {
      const url = `${baseUrl.replace(/\/$/, "")}/inventory`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization:
            authorized.integration.authScheme === "api_key"
              ? credential
              : authorized.integration.authScheme === "basic"
                ? `Basic ${credential}`
                : `Bearer ${credential}`,
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Facility API returned HTTP ${response.status}.`);
      }
      const payload = (await response.json()) as { records?: InventoryRecord[] } | InventoryRecord[];
      const records = Array.isArray(payload) ? payload : payload.records ?? [];
      return await ctx.runMutation(internal.integrations.applyLiveRun, {
        integrationId: args.integrationId,
        runId,
        records: records.map((record) => ({
          ...record,
          externalUnitRef: String(record.externalUnitRef ?? ""),
          bloodGroup: String(record.bloodGroup ?? ""),
          component: String(record.component ?? ""),
          units: Number(record.units ?? 0),
          collectedAt: String(record.collectedAt ?? ""),
          expiresAt: String(record.expiresAt ?? ""),
          storageLocation: String(record.storageLocation ?? "Imported batch"),
          screened: record.screened === true,
          released: record.released === true,
        })),
        actorUserId: authorized.actorUserId,
        startedAt,
      });
    } catch (error) {
      return await ctx.runMutation(internal.integrations.applyLiveRun, {
        integrationId: args.integrationId,
        runId,
        records: [],
        actorUserId: authorized.actorUserId,
        startedAt,
        error: error instanceof Error ? error.message : "Facility API request failed.",
      });
    }
  },
});

export const syncStatusSummary = query({
  args: {},
  handler: async (ctx) => {
    const user = await optionalUser(ctx);
    if (!user) return null;
    const role = roleOf(user);
    if (role !== "admin" && role !== "hospital" && role !== "red_cross") return null;
    const integrations = await ctx.db.query("facilityIntegrations").collect();
    const scoped = integrations.filter(
      (row) => role === "admin" || row.organizationId === user.organizationId,
    );
    const runs = await ctx.db.query("facilitySyncRuns").collect();
    const scopedRuns = runs.filter((run) =>
      scoped.some((i) => i._id === run.integrationId),
    );
    return {
      integrations: scoped.length,
      mock: scoped.filter((i) => i.isMock).length,
      live: scoped.filter((i) => !i.isMock).length,
      failing: scoped.filter((i) => i.status === "error").length,
      unconfigured: scoped.filter((i) => i.status === "not_configured").length,
      lastSyncAt: scoped.reduce((max, i) => Math.max(max, i.lastSyncAt ?? 0), 0) || null,
      runsLast24h: scopedRuns.filter((r) => r.startedAt > Date.now() - 86_400_000).length,
      mockRecords: scopedRuns
        .filter((r) => r.source === "mock")
        .reduce((sum, r) => sum + r.recordsApplied, 0),
    };
  },
});

/** Scheduled fallback: periodic sync for integrations flagged periodic. */
export const runPeriodicSyncs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const integrations = await ctx.db.query("facilityIntegrations").collect();
    const due = integrations.filter(
      (i) =>
        i.isMock &&
        i.syncMode === "periodic" &&
        i.status !== "error" &&
        (i.lastSyncAt == null || i.lastSyncAt < Date.now() - 6 * 3_600_000),
    );
    let synced = 0;
    for (const integration of due.slice(0, 5)) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_organization", (q) => q.eq("organizationId", integration.organizationId))
        .first();
      if (!user) continue;
      const startedAt = Date.now();
      const runId = await ctx.db.insert("facilitySyncRuns", {
        integrationId: integration._id,
        organizationId: integration.organizationId,
        startedAt,
        status: "running",
        source: "mock",
        recordsRead: 0,
        recordsApplied: 0,
        isMock: true,
        actorUserId: user._id,
      });
      await applyRecords(ctx, {
        integration,
        records: mockRecords(),
        source: "mock",
        runId,
        startedAt,
        actorUserId: user._id,
      });
      synced += 1;
    }
    return { due: due.length, synced };
  },
});
