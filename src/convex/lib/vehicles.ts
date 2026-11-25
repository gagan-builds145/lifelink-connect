import { v } from "convex/values";

/**
 * Map provider-reported vehicle details onto LifeLink's ambulance model
 * category where the provider gives enough signal to do so confidently.
 *
 * This is a heuristic, not a legal determination. If the provider only returns
 * a generic truck/SUV class, the Guardian still chooses the real ambulance
 * category in the form.
 */
export type VehicleCategoryHint =
  | "light ambulance"
  | "medium ambulance"
  | "advanced ambulance"
  | "specialist ambulance"
  | "non-ambulance vehicle"
  | null;

export function ambulanceTypeFromDetails(details: {
  vehicleCategory?: string | null;
  vehicleClass?: string | null;
  make?: string | null;
  model?: string | null;
}): { suggestedType?: "bls" | "als" | "icu" | "neonatal"; reason?: string } {
  const text = [
    details.vehicleCategory,
    details.vehicleClass,
    details.make,
    details.model,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/icu|neonatal|incubator|intensive|advanced/i.test(text)) {
    return { suggestedType: "icu" };
  }
  if (/advanced life support|als|paramedic/i.test(text)) {
    return { suggestedType: "als" };
  }
  if (
    /neonatal|incubator|newborn|infant/i.test(text)
  ) {
    return { suggestedType: "neonatal" };
  }
  if (/basic life support|bls|first responder|emergency/i.test(text)) {
    return { suggestedType: "bls" };
  }

  return { suggestedType: undefined };
}

/**
 * Normalize a provider response into the canonical backend shape used by the
 * vehicle lookup result table.
 *
 * Validation rules:
 * - Strings are trimmed.
 * - Names keep letters, spaces, hyphens and dots only (no control characters).
 * - Dates must be ISO-8601 dates only (YYYY-MM-DD).
 * - Numbers are rounded to integers and bounded into realistic ranges.
 * - Missing fields become null and render as "Not available" in the UI.
 */
export function normalizeVehiclePayload(
  response: Record<string, unknown>,
): {
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
} {
  return {
    manufacturer: safeText(response.manufacturer),
    make: safeText(response.make),
    model: safeText(response.model),
    variant: safeText(response.variant),
    vehicleCategory: safeText(response.vehicleCategory),
    vehicleClass: safeText(response.vehicleClass),
    fuelType: safeFuelType(response.fuelType),
    registrationDate: safeDate(response.registrationDate, "registrationDate"),
    registrationState: safeText(response.registrationState),
    rtoCode: safeText(response.rto),
    registrationValidityDate: safeDate(
      response.registrationValidityDate,
      "registrationValidityDate",
    ),
    fitnessExpiryDate: safeDate(response.fitnessExpiryDate, "fitnessExpiryDate"),
    insuranceExpiryDate: safeDate(
      response.insuranceExpiryDate,
      "insuranceExpiryDate",
    ),
    pucExpiryDate: safeDate(response.pucExpiryDate, "pucExpiryDate"),
    seatingCapacity: safeCapacity(response.seatingCapacity),
    engineCapacityCc: safeCc(response.engineCapacityCc),
  };
}

export function safeText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^[\p{L}\p{N}.\-' ]+$/u.test(trimmed)) return null;
  if (trimmed.length > 80) return trimmed.slice(0, 80);
  return trimmed;
}

export function safeFuelType(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;
  // Accept common fuel types but normalize casing.
  if (
    !/^(petrol|diesel|cng|lpg|electric|hybrid|petrol-electric|diesel-electric|hydrogen|battery|castrol|solar)$/.test(
      normalized,
    )
  ) {
    // Provider may return free-form text; keep it if short and safe.
    if (normalized.length > 24) return null;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
  return normalized;
}

export function safeDate(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) return trimmed;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Epoch ms or seconds?
    const maybe = new Date(value);
    if (!Number.isNaN(maybe.getTime())) {
      const iso = maybe.toISOString().slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    }
  }
  return null;
}

export function safeCapacity(value: unknown): number | null {
  const n = toNumber(value);
  if (n == null) return null;
  if (n < 1 || n > 30) return null;
  return Math.round(n);
}

export function safeCc(value: unknown): number | null {
  const n = toNumber(value);
  if (n == null) return null;
  if (n < 50 || n > 12000) return null;
  return Math.round(n);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

// ---- Validation helpers shared with the client (lightweight) ----

export const REGISTRATION_NUMBER_REGEX = /^[A-Z]{1,2}\d{1,2}[A-Z0-9]{1,3}\d{3,4}$/;

export function normalizeVehicleRegistrationInput(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function isValidVehicleRegistrationInput(raw: string): boolean {
  const normalized = normalizeVehicleRegistrationInput(raw);
  if (normalized.length < 5 || normalized.length > 18) return false;
  return REGISTRATION_NUMBER_REGEX.test(normalized);
}

/** Format a date/datetime for display if present. */
export function formatVehicleDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not available";
  return parsed.toISOString().slice(0, 10);
}

/** Ordinal-ish suffix for display-only sequencing of lookup attempts. */
export function shortIdSuffix(id: string | undefined): string {
  if (!id || id.length < 6) return id ?? "";
  return id.slice(-6);
}

export type VehicleLookupRow = {
  _id: string;
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
};
