/**
 * Provider-independent Aadhaar verification adapter.
 *
 * IMPORTANT COMPLIANCE NOTE
 * -------------------------
 * LifeLink does not call UIDAI directly, does not scrape Aadhaar data and does
 * not implement unofficial OTP/biometric flows. A live integration is only
 * possible through a legally authorised provider (for example an AUA/KUA
 * acting under a valid contract and UIDAI directions) after the operator has
 * completed legal review and configured the credentials below.
 *
 * With the default configuration this module exposes only an explicitly
 * labelled SANDBOX provider. Sandbox sessions never represent a UIDAI
 * verification and are stored with `sandbox: true` so every dashboard and
 * admin view can say so.
 */

export const AADHAAR_CONSENT_VERSION = "2026-11-donor-identity-v1";

export type VerificationProviderName = "sandbox" | string;

export type CreatedVerificationSession = {
  provider: string;
  reference: string;
  maskedReference?: string;
  expiresAt: number;
  sandbox: boolean;
};

export type ProviderVerificationStatus =
  | "PENDING"
  | "VERIFIED"
  | "FAILED"
  | "EXPIRED"
  | "REVOKED"
  | "REQUIRES_REVIEW";

export type AadhaarVerificationProvider = {
  name: string;
  isSandbox: boolean;
  createVerificationSession(input: {
    donorUserId: string;
    consentVersion: string;
    now: number;
  }): Promise<CreatedVerificationSession>;
  getVerificationStatus(reference: string): Promise<ProviderVerificationStatus>;
  cancelVerificationSession(reference: string): Promise<void>;
};

function env(name: string): string | undefined {
  return process.env[name];
}

/** Live verification stays off unless every credential and the explicit flag exist. */
export function liveVerificationConfigured(): boolean {
  return (
    env("AADHAAR_VERIFICATION_ENABLED") === "true" &&
    env("AADHAAR_SANDBOX_MODE") !== "true" &&
    Boolean(env("AADHAAR_PROVIDER")) &&
    Boolean(env("AADHAAR_PROVIDER_BASE_URL")) &&
    Boolean(env("AADHAAR_CLIENT_ID")) &&
    Boolean(env("AADHAAR_CLIENT_SECRET"))
  );
}

export function sandboxEnabled(): boolean {
  return env("AADHAAR_SANDBOX_MODE") !== "false";
}

export function providerName(): string {
  return liveVerificationConfigured()
    ? (env("AADHAAR_PROVIDER") as string)
    : "sandbox";
}

export function verificationSessionTtlMs(): number {
  const minutes = Number(env("AADHAAR_SESSION_TTL_MINUTES") ?? 15);
  return Math.min(60, Math.max(5, Number.isFinite(minutes) ? minutes : 15)) * 60_000;
}

function randomReference(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `llv_${hex}`;
}

/**
 * Sandbox provider. It creates a local session only; it does not contact any
 * external service and it cannot produce verified identity data by itself.
 */
export const sandboxProvider: AadhaarVerificationProvider = {
  name: "sandbox",
  isSandbox: true,
  async createVerificationSession({ now }) {
    return {
      provider: "sandbox",
      reference: randomReference(),
      expiresAt: now + verificationSessionTtlMs(),
      sandbox: true,
    };
  },
  async getVerificationStatus() {
    return "PENDING";
  },
  async cancelVerificationSession() {
    // Nothing external to cancel.
  },
};

/**
 * Live provider placeholder. It intentionally never manufactures a success.
 * A real adapter must be implemented and legally reviewed before the operator
 * enables `AADHAAR_VERIFICATION_ENABLED`.
 */
export const unconfiguredLiveProvider: AadhaarVerificationProvider = {
  name: providerName(),
  isSandbox: false,
  async createVerificationSession() {
    throw new Error(
      "Live Aadhaar verification is disabled. An authorised provider integration and legal approval are required before it can be enabled.",
    );
  },
  async getVerificationStatus() {
    throw new Error("Live Aadhaar provider is not configured.");
  },
  async cancelVerificationSession() {
    throw new Error("Live Aadhaar provider is not configured.");
  },
};

export function getAadhaarProvider(): AadhaarVerificationProvider {
  if (liveVerificationConfigured()) {
    // Deliberately refuses until a provider-specific adapter is implemented
    // and reviewed; no credentials are shipped with a fabricated client.
    return unconfiguredLiveProvider;
  }
  if (sandboxEnabled()) return sandboxProvider;
  throw new Error(
    "Identity verification is disabled in this deployment. Contact support if you need to verify your identity.",
  );
}

/** Constant-time comparison for hex HMAC signatures. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify an HMAC-SHA256 provider callback signature over `${timestamp}.${body}`.
 * The callback secret must be set as a Convex environment variable.
 */
export async function verifyProviderCallbackSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!secret || !timestamp || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  return timingSafeEqual(toHex(mac), signature.toLowerCase());
}
