import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { verifyProviderCallbackSignature } from "./lib/aadhaarProvider";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * Internal OTP gate used by the email provider before a code is sent.
 *
 * This endpoint is not a user-facing API. It requires the deployment's
 * `OTP_GATE_SECRET` (falling back to `VLY_INTEGRATION_KEY`) as a bearer token
 * and never returns whether an account exists. Rate-limit decisions are
 * recorded as security events by the mutation.
 */
http.route({
  path: "/otp-gate",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const expected = process.env.OTP_GATE_SECRET ?? process.env.VLY_INTEGRATION_KEY;
    if (!expected) {
      return new Response(
        JSON.stringify({ allowed: false, reason: "OTP gate is not configured." }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }
    const supplied = request.headers.get("authorization") ?? "";
    if (supplied !== `Bearer ${expected}`) {
      return new Response(JSON.stringify({ allowed: false, reason: "Unauthorized." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    let email: unknown;
    try {
      const body = (await request.json()) as { email?: unknown };
      email = body.email;
    } catch {
      return new Response(JSON.stringify({ allowed: false, reason: "Malformed request." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (typeof email !== "string" || email.length > 320) {
      return new Response(JSON.stringify({ allowed: false, reason: "Malformed request." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    let allowed = false;
    try {
      const result = await ctx.runMutation(internal.authGate.reserveOtp, { email });
      allowed = result.allowed;
    } catch {
      // Do not echo internals; the provider shows its own generic message.
      allowed = false;
    }
    if (!allowed) {
      return new Response(
        JSON.stringify({ allowed: false, reason: "Too many requests. Please wait." }),
        { status: 429, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
      );
    }
    return new Response(JSON.stringify({ allowed: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }),
});

const CALLBACK_STATUSES = ["VERIFIED", "FAILED", "EXPIRED", "REVOKED", "REQUIRES_REVIEW"] as const;
type CallbackStatus = (typeof CALLBACK_STATUSES)[number];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Authorised-provider callback endpoint for identity verification.
 *
 * Security properties:
 * - requires `AADHAAR_CALLBACK_SECRET`; unsigned calls are refused
 * - HMAC-SHA256 over `${timestamp}.${rawBody}` with a 5-minute replay window
 * - idempotent: the internal mutation ignores already-terminal sessions
 * - stores only permitted fields, never a raw provider payload or Aadhaar number
 */
http.route({
  path: "/aadhaar/callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.AADHAAR_CALLBACK_SECRET;
    if (!secret) return jsonResponse({ ok: false, reason: "not_configured" }, 503);

    const timestamp = request.headers.get("x-aadhaar-timestamp") ?? "";
    const signature = request.headers.get("x-aadhaar-signature") ?? "";
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60_000) {
      return jsonResponse({ ok: false, reason: "stale_or_missing_timestamp" }, 401);
    }

    const rawBody = await request.text();
    if (rawBody.length > 8_000) {
      return jsonResponse({ ok: false, reason: "payload_too_large" }, 413);
    }
    const valid = await verifyProviderCallbackSignature(
      rawBody,
      timestamp,
      signature,
      secret,
    );
    if (!valid) return jsonResponse({ ok: false, reason: "invalid_signature" }, 401);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return jsonResponse({ ok: false, reason: "malformed" }, 400);
    }

    const reference = typeof body.reference === "string" ? body.reference : "";
    const status = typeof body.status === "string" ? body.status : "";
    if (!reference || reference.length > 120) {
      return jsonResponse({ ok: false, reason: "invalid_reference" }, 400);
    }
    if (!CALLBACK_STATUSES.includes(status as CallbackStatus)) {
      return jsonResponse({ ok: false, reason: "invalid_status" }, 400);
    }

    const optional = (value: unknown, max: number) =>
      typeof value === "string" ? value.slice(0, max) : undefined;

    const result = await ctx.runMutation(internal.aadhaar.ingestProviderCallback, {
      reference,
      status: status as CallbackStatus,
      providerTransactionReference: optional(body.transactionRef, 120),
      verifiedName: optional(body.verifiedName, 160),
      verifiedAddress: optional(body.verifiedAddress, 300),
      maskedReference: optional(body.maskedReference, 40),
      failureReason: optional(body.failureReason, 300),
    });
    return jsonResponse(result, 200);
  }),
});

export default http;
