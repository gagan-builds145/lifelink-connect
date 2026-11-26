import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, internalMutation, mutation } from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  audit,
  requireRole,
  requireText,
} from "./lib/helpers";
import { normalizeVehiclePayload } from "./lib/vehicles";

type AnyQueryBuilder = any;

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

function nullToUndefined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

export const requestVehicleLookup = action({
  args: { registrationNumber: v.string() },
  handler: async (ctx: ActionCtx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in to look up a vehicle.");

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

    // Look up from provider; this is a read-only operation from the action.
    const providerResult = await lookupVehicleFromProvider(normalized);
    if (!providerResult) {
      throw new Error(
        "No vehicle details were returned for that registration number. You can still enter the details manually below.",
      );
    }

    return {
      providerReturned: providerResult,
      normalizedRegistrationNumber: normalized,
    };
  },
});

export const saveVehicleLookupResult = mutation({
  args: {
    registrationNumber: v.string(),
    providerResult: v.object({
      manufacturer: v.optional(v.string()),
      make: v.optional(v.string()),
      model: v.optional(v.string()),
      variant: v.optional(v.string()),
      vehicleCategory: v.optional(v.string()),
      vehicleClass: v.optional(v.string()),
      fuelType: v.optional(v.string()),
      registrationDate: v.optional(v.string()),
      registrationState: v.optional(v.string()),
      rtoCode: v.optional(v.string()),
      registrationValidityDate: v.optional(v.string()),
      fitnessExpiryDate: v.optional(v.string()),
      insuranceExpiryDate: v.optional(v.string()),
      pucExpiryDate: v.optional(v.string()),
      seatingCapacity: v.optional(v.number()),
      engineCapacityCc: v.optional(v.number()),
    }),
  },
  handler: async (ctx: MutationCtx, args) => {
    const user = await requireGuardian(ctx);

    const normalized = normalizeRegistrationNumber(
      requireText(args.registrationNumber, "Vehicle registration number", 3, 28),
    );
    if (!isValidRegistrationNumber(normalized)) {
      throw new Error(
        "That registration number is not in a recognized Indian format.",
      );
    }

    // Prevent duplicate ambulance for this plate.
    const allAmbulances = await ctx.db.query("ambulances").collect();
    const existingAmbulance = allAmbulances.find(
      (a) => a.registrationNumber === normalized,
    );
    if (existingAmbulance) {
      throw new Error(
        "That ambulance registration number is already registered.",
      );
    }

    const payload = normalizeVehiclePayload(args.providerResult);

    const insertedId = await ctx.db.insert("vehicleLookupResults", {
      guardianUserId: user._id,
      registrationNumber: normalized,
      manufacturer: nullToUndefined(payload.manufacturer),
      make: nullToUndefined(payload.make),
      model: nullToUndefined(payload.model),
      variant: nullToUndefined(payload.variant),
      vehicleCategory: nullToUndefined(payload.vehicleCategory),
      vehicleClass: nullToUndefined(payload.vehicleClass),
      fuelType: nullToUndefined(payload.fuelType),
      registrationDate: nullToUndefined(payload.registrationDate),
      registrationState: nullToUndefined(payload.registrationState),
      rtoCode: nullToUndefined(payload.rtoCode),
      registrationValidityDate: nullToUndefined(payload.registrationValidityDate),
      fitnessExpiryDate: nullToUndefined(payload.fitnessExpiryDate),
      insuranceExpiryDate: nullToUndefined(payload.insuranceExpiryDate),
      pucExpiryDate: nullToUndefined(payload.pucExpiryDate),
      seatingCapacity: nullToUndefined(payload.seatingCapacity),
      engineCapacityCc: nullToUndefined(payload.engineCapacityCc),
      source: "vehicle_provider",
      lookedUpAt: Date.now(),
      providerName: providerName(),
      createdAt: Date.now(),
    });

    const row = (await ctx.db.get(insertedId))!;

    return { row };
  },
});

export const reviewVehicleLookupResult = mutation({
  args: { registrationNumber: v.string() },
  handler: async (ctx: MutationCtx, args) => {
    const current = await requireRole(ctx, ["guardian"]);

    const normalized = normalizeRegistrationNumber(
      requireText(args.registrationNumber, "Vehicle registration number", 3, 28),
    );
    if (!isValidRegistrationNumber(normalized)) {
      throw new Error(
        "That registration number is not in a recognized Indian format.",
      );
    }

    const allRows = await ctx.db.query("vehicleLookupResults").collect();
    const row = allRows.find((r) => r.registrationNumber === normalized);

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
    const allRows = await ctx.db.query("vehicleLookupResults").collect();
    const stale = allRows.filter((r) => r.lookedUpAt != null && r.lookedUpAt < cutoff);

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

// ---- Provider response contract ----
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
