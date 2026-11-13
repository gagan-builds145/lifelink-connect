import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { enforceFwRateLimit, enforceOtpRateLimit, normalizeEmail } from "./lib/helpers";

/**
 * Server-side OTP gate.
 *
 * Convex Auth's email provider runs inside the deployment, so it calls this
 * gate over the deployment's own HTTP endpoint before handing a code to the
 * email gateway. The gate applies a durable per-email window and a coarse
 * endpoint budget in the `rateLimits` table, then records a security event when
 * a limit is hit.
 *
 * It is intentionally not a public mutation: only the authenticated HTTP action
 * in `http.ts` can reach it, and that action requires the deployment's internal
 * gate secret.
 */
export const reserveOtp = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    // 5 code requests per 15 minutes per address, plus a hard ceiling on the
    // whole endpoint so one address cannot exhaust the email gateway.
    const perEmail = await enforceOtpRateLimit(ctx, email, 15 * 60, 5);
    if (!perEmail) return { allowed: false as const };
    const endpoint = await enforceFwRateLimit(ctx, "otp:endpoint", 120, 60_000, "high");
    if (!endpoint) return { allowed: false as const };
    return { allowed: true as const };
  },
});
