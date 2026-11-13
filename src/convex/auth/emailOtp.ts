import { Email } from "@convex-dev/auth/providers/Email";
import axios from "axios";
import { RandomReader, generateRandomString } from "@oslojs/crypto/random";

/**
 * Email OTP provider wrapper.
 *
 * Convex Auth calls the provider hooks internally. We keep the existing send
 * path but centralize error handling so auth failures can be logged as security
 * events without exposing tokens or one-time codes.
 */
export const emailOtp = Email({
  id: "email-otp",
  maxAge: 60 * 15, // 15 minutes
  // This function can be asynchronous
  async generateVerificationToken() {
    const random: RandomReader = {
      read(bytes: Uint8Array) {
        crypto.getRandomValues(bytes);
      },
    };
    const alphabet = "0123456789";
    return generateRandomString(random, alphabet, 6);
  },
  async sendVerificationRequest({ identifier: email, token }) {
    await guardOtpRequest(email);
    try {
      await axios.post(
        freebuffEmailOtpUrl(),
        { to: email, otp: token },
        { headers: freebuffEmailOtpHeaders() },
      );
    } catch (error) {
      throw freebuffEmailOtpError(error);
    }
  },
});

// NOTE: Convex Auth may call sendVerificationEmail at the Convex function layer.
// If your deployment exposes a mutation/action that translates user-facing auth
// attempts into security events, record them there rather than inside this
// provider object. This file deliberately does not log tokens or codes.

/**
 * Authentication firewall: throttle OTP requests before a code is generated
 * into an email. The durable limits live in Convex (`authGate.reserveOtp`),
 * reached through the deployment's own /otp-gate endpoint with a server-only
 * secret. If that endpoint is not configured (for example a local deployment
 * without CONVEX_SITE_URL), a best-effort in-isolate limiter still applies.
 */
const localOtpWindows = new Map<string, number[]>();
const LOCAL_WINDOW_MS = 15 * 60_000;
const LOCAL_MAX_REQUESTS = 5;

function localOtpAllow(email: string): boolean {
  const key = email.trim().toLowerCase();
  const now = Date.now();
  const window = (localOtpWindows.get(key) ?? []).filter((at) => now - at < LOCAL_WINDOW_MS);
  if (window.length >= LOCAL_MAX_REQUESTS) {
    localOtpWindows.set(key, window);
    return false;
  }
  window.push(now);
  localOtpWindows.set(key, window);
  return true;
}

async function guardOtpRequest(email: string): Promise<void> {
  const secret = process.env.OTP_GATE_SECRET ?? process.env.VLY_INTEGRATION_KEY;
  const base = process.env.CONVEX_SITE_URL;
  if (!secret || !base) {
    if (!localOtpAllow(email)) {
      throw new Error("Too many sign-in code requests. Please wait a few minutes and try again.");
    }
    return;
  }
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(`${base.replace(/\/+$/, "")}/otp-gate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Fail closed for OTP sends: a gate we cannot reach must not become a
    // bypass. The user sees a generic retry message (no account enumeration).
    if (!localOtpAllow(email)) {
      throw new Error("Too many sign-in code requests. Please wait a few minutes and try again.");
    }
    return;
  }
  if (response.status === 429) {
    throw new Error("Too many sign-in code requests. Please wait a few minutes and try again.");
  }
  if (!response.ok) {
    throw new Error("Sign-in is temporarily unavailable. Please try again shortly.");
  }
}

// Sign-in codes are sent by the Freebuff integrations gateway, which knows
// this project by its own key: VLY_INTEGRATION_KEY, a Convex environment
// variable set when the project was created. The email's wording is fixed by
// the gateway.
function freebuffEmailOtpUrl(): string {
  const base =
    process.env.VLY_INTEGRATION_BASE_URL || "https://integrations.vly.ai";
  return `${base.replace(/\/+$/, "")}/v1/email/otp`;
}

function freebuffEmailOtpHeaders(): Record<string, string> {
  const key = process.env.VLY_INTEGRATION_KEY;
  if (!key) {
    throw new Error(
      "VLY_INTEGRATION_KEY is not set on this Convex deployment, so email sign-in cannot send codes.",
    );
  }
  return { Authorization: `Bearer ${key}` };
}

// Never stringify the whole request error: it carries the request headers.
function freebuffEmailOtpError(error: unknown): Error {
  const response = (
    error as { response?: { status?: number; data?: { error?: unknown } } }
  )?.response;
  if (response) {
    const detail =
      typeof response.data?.error === "string" ? `: ${response.data.error}` : "";
    return new Error(
      `Could not send the sign-in code (HTTP ${response.status})${detail}`,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Could not send the sign-in code: ${message}`);
}
