import { v } from "convex/values";
import { action, internalMutation, mutation } from "./_generated/server";
import type {
  ActionCtx,
  MutationCtx,
  QueryCtx,
  DatabaseReader,
  genericActionCtx,
} from "./_generated/server";

external type VehiclesCtx = ActionCtx | MutationCtx | QueryCtx;

external type AnyQueryBuilder = any;

external interface VehicleLookupResultTable {}

external type VehicleLookupResultRow = {
  _id: Doc<"vehicleLookupResults">;
  _creationTime: number;
  guardianUserId: Doc<"users">;
  registrationNumber: string;
  manufacturer: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  vehicleCategory: string | null;
  vehicleClass: string | null;
  fuelType: string | null;
  registrationDate: string | null;
  registrationState: string | null;
  rtoCode: string | null;
  registrationValidityDate: string | null;
  fitnessExpiryDate: string | null;
  insuranceExpiryDate: string | null;
  pucExpiryDate: string | null;
  seatingCapacity: number | null;
  engineCapacityCc: number | null;
  source: string | null;
  lookedUpAt: number | null;
  providerName: string | null;
} & {
  _id: Doc<"vehicleLookupResults">;
};
import type { Doc } from "./_generated/dataModel";
import {
  audit,
  enforceRateLimit,
  requireRole,
  requireText,
  requireUser,
} from "./lib/helpers";
import {
  normalizeVehiclePayload,
  ambulanceTypeFromDetails,
} from "./lib/vehicles";

external type VehiclesCtx = ActionCtx | MutationCtx | QueryCtx;

external type AnyQueryBuilder = any;

external interface VehicleLookupResultTable {}

external type VehicleLookupResultRow = {
  _id: Doc<"vehicleLookupResults">;
  _creationTime: number;
  guardianUserId: Doc<"users">;
  registrationNumber: string;
  manufacturer: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  vehicleCategory: string | null;
  vehicleClass: string | null;
  fuelType: string | null;
  registrationDate: string | null;
  registrationState: string | null;
  rtoCode: string | null;
  registrationValidityDate: string | null;
  fitnessExpiryDate: string | null;
  insuranceExpiryDate: string | null;
  pucExpiryDate: string | null;
  seatingCapacity: number | null;
  engineCapacityCc: number | null;
  source: string | null;
  lookedUpAt: number | null;
  providerName: string | null;
} & {
  _id: Doc<"vehicleLookupResults">;
};

const REGISTRATION_NUMBER_PATTERN =
  /^(?:^|[A-Z])[A-Z]{1,2}\d{1,2}[A-Z0-9]{1,3}\d{3,4}$/;

function normalizeRegistrationNumber(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

function isValidRegistrationNumber(raw: string): boolean {
  return REGISTRATION_NUMBER_PATTERN.test(normalizeRegistrationNumber(raw));
}

async function requireGuardian(
  ctx: MutationCtx,
): Promise<Doc<"users">> {
  const user = await requireRole(ctx, ["guardian"]);
  const profile = await ctx.db
    .query("guardianProfiles")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .unique();
  if (!profile) throw new Error("Complete your Guardian registration first.");
  return user;
}

export const requestVehicleLookup = action({
  args: { registrationNumber: v.string() },
  handler: async (ctx: ActionCtx, args) => {
    const user = await requireUser(ctx);
    await enforceRateLimit(ctx, `vehicle-lookup:${user._id}`, 5, 60_000);

    const input = requireText(
      args.registrationNumber,
      "Vehicle registration number",
      3,
      28,
    );
    if (!isValidRegistrationNumber(input)) {
      throw new Error(
        "That registration number is not in a recognized Indian format.",
      );
    }

    const normalized = normalizeRegistrationNumber(input);

    // Prevent a duplicate ambulance record for this plate before the lookup.
    const existing = await ctx.db
      .query("ambulances")
      .withIndex("by_registration_number", (q: AnyQueryBuilder) =>
        q.eq("registrationNumber", normalized),
      )
      .unique();
    if (existing) {
      throw new Error(
        "That ambulance registration number is already registered.",
      );
    }

    const providerResult = await lookupVehicleFromProvider(normalized);
    if (!providerResult) {
      throw new Error(
        "No vehicle details were returned for that registration number. You can still enter the details manually below.",
      );
    }

    const payload = await normalizeVehiclePayload(providerResult);

    const insertedId = await ctx.db.insert("vehicleLookupResults", {
      guardianUserId: user._id,
      registrationNumber: normalized,
      manufacturer: payload.manufacturer,
      make: payload.make,
      model: payload.model,
      variant: payload.variant,
      vehicleCategory: payload.vehicleCategory,
      vehicleClass: payload.vehicleClass,
      fuelType: payload.fuelType,
      registrationDate: payload.registrationDate,
      registrationState: payload.registrationState,
      rtoCode: payload.rtoCode,
      registrationValidityDate: payload.registrationValidityDate,
      fitnessExpiryDate: payload.fitnessExpiryDate,
      insuranceExpiryDate: payload.insuranceExpiryDate,
      pucExpiryDate: payload.pucExpiryDate,
      seatingCapacity: payload.seatingCapacity,
      engineCapacityCc: payload.engineCapacityCc,
      source: "vehicle_provider",
      lookedUpAt: Date.now(),
      providerName: providerName(),
    });

    const row = (await ctx.db.get(insertedId))!;

    return {
      row,
      providerReturned: providerResult,
    } satisfies VehicleLookupActionResult;
  },
});

export const reviewVehicleLookupResult = mutation({
  args: { registrationNumber: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const current = await requireUser(ctx);
    await requireRole(ctx, ["guardian"]);

    const normalized = normalizeRegistrationNumber(
      requireText(args.registrationNumber, "Vehicle registration number", 3, 28),
    );
    if (!isValidRegistrationNumber(normalized)) {
      throw new Error(
        "That registration number is not in a recognized Indian format.",
      );
    }

    const row = await ctx.db
      .query("vehicleLookupResults")
      .withIndex("by_registration_number", (q: AnyQueryBuilder) =>
        q.eq("registrationNumber", normalized),
      )
      .first();

    if (!row || row.guardianUserId !== current._id) {
      throw new Error("No recent vehicle lookup for that registration number.");
    }

    return row;
  },
});

export const clearStaleVehicleLookup = internalMutation({
  args: { olderThanMs: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanMs;
    const stale = await ctx.db
      .query("vehicleLookupResults")
      .withIndex("by_looked_up_at", (q: AnyQueryBuilder) => q.lt("lookedUpAt", cutoff))
      .collect();

    for (const row of stale) {
      await ctx.db.delete(row._id);
    }

    await audit(ctx, {
      actor: {
        _id: "system",
        role: "admin",
        email: undefined,
        name: "system",
        isAnonymous: false,
      } as never,
      action: "vehicle_lookup_stale_cleaned",
      entityType: "vehicleLookupResult",
      entityId: String(stale.length),
      detail: `Cleaned ${stale.length} stale vehicle lookup result(s).`,
    });

    return { cleaned: stale.length };
  },
});

// ---- Provider abstraction ----

/**
 * Provider contract, version 1.
 *
 * LifeLink never stores or transmits more identifying data than the provider
 * contract requires. The frontend never sees provider credentials. When no
 * provider is configured, the lookup fails closed and the user is offered the
 * manual fallback.
 */
type VehicleLookupProvider = {
  fetchVehicle(registrationNumber: string): Promise<VehicleProviderResponse | null>;
  name: string;
};

async function lookupVehicleFromProvider(
  registrationNumber: string,
): Promise<VehicleProviderResponse | null> {
  const provider = vehicleLookupProvider();
  if (!provider) return null;
  try {
    return await provider.fetchVehicle(registrationNumber);
  } catch {
    return null;
  }
}

function vehicleLookupProvider(): VehicleLookupProvider | null {
  const baseUrl =
    process.env.VEHICLE_LOOKUP_BASE_URL ??
    process.env.VEHICLE_LOOKUP_PROVIDER_BASE_URL ??
    null;
  const apiKey =
    process.env.VEHICLE_LOOKUP_API_KEY ??
    process.env.VEHICLE_LOOKUP_PROVIDER_API_KEY ??
    null;

  if (!baseUrl || !apiKey) return null;

  return {
    name: providerName(),
    fetchVehicle: async (registrationNumber: string) => {
      try {
        const response = await fetch(baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            vehicle_number: registrationNumber,
          }),
        });

        if (!response.ok) return null;

        const body = (await response.json()) as {
          success?: boolean;
          vehicle?: VehicleProviderResponse;
          data?: VehicleProviderResponse;
          error?: string;
        } | null;

        if (!body) return null;

        const payload =
          "vehicle" in body && body.vehicle
            ? body.vehicle
            : "data" in body && body.data
              ? body.data
              : null;
        if (!payload) return null;

        return payload as VehicleProviderResponse;
      } catch {
        return null;
      }
    },
  };
}

function providerName(): string {
  return (
    process.env.VEHICLE_LOOKUP_PROVIDER_NAME ??
    process.env.VEHICLE_LOOKUP_NAME ??
    "authorized vehicle registration provider"
  );
}

// ---- Public action result type ----

export type VehicleLookupActionResult = {
  row: Doc<"vehicleLookupResults">;
  providerReturned: VehicleProviderResponse;
} & {
  readonly __actionResultBrand: "VehicleLookupActionResult";
};

// ---- Provider response contract ----

/**
 * Raw provider response shape that the backend accepts.
 *
 * This is intentionally permissive: the provider may return any subset. The
 * backend normalizes and validates this into the canonical shape before
 * storing it. Fields the provider does not return are preserved as `null` and
 * the UI renders "Not available" for them.
 */
export type VehicleProviderResponse = {
  manufacturer?: string | null;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  vehicleCategory?: string | null;
  vehicleClass?: string | null;
  fuelType?: string | null;
  registrationDate?: string | null;
  registrationState?: string | null;
  rto?: string | null;
  registrationValidityDate?: string | null;
  fitnessExpiryDate?: string | null;
  insuranceExpiryDate?: string | null;
  pucExpiryDate?: string | null;
  seatingCapacity?: number | null;
  engineCapacityCc?: number | null;
};

export type VehicleProviderResponseInput = {
  manufacturer?: string | null;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  vehicleCategory?: string | null;
  vehicleClass?: string | null;
  fuelType?: string | null;
  registrationDate?: string | null;
  registrationState?: string | null;
  rto?: string | null;
  registrationValidityDate?: string | null;
  fitnessExpiryDate?: string | null;
  insuranceExpiryDate?: string | null;
  pucExpiryDate?: string | null;
  seatingCapacity?: number | null;
  engineCapacityCc?: number | null;
};

export type VehicleProviderResponseRecord = {
  manufacturer: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  vehicleCategory: string | null;
  vehicleClass: string | null;
  fuelType: string | null;
  registrationDate: string | null;
  registrationState: string | null;
  rtoCode: string | null;
  registrationValidityDate: string | null;
  fitnessExpiryDate: string | null;
  insuranceExpiryDate: string | null;
  pucExpiryDate: string | null;
  seatingCapacity: number | null;
  engineCapacityCc: number | null;
};

declare module "./schema" {
  interface TableDefinitions {
    vehicleLookupResults: VehicleLookupResultTable;
  }
}

export type { VehicleProviderResponse, VehicleLookupActionResult, VehicleProviderResponseInput, VehicleProviderResponseRecord };

export {};
