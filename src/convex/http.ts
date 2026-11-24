import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

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

export default http;
