import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import {
  enforceFwRateLimit,
  enforceOtpRateLimit,
  hashIdentifier,
  normalizeEmail,
} from "./lib/helpers";

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

/**
 * Login pre-flight: is this email attached to a registered account?
 *
 * Convex Auth's email provider creates an account the first time a code is
 * requested, so without this check an unregistered address could silently
 * become a new account from the login form. The login UI calls this before
 * requesting a code and asks the visitor to create an account instead.
 *
 * Only a coarse status leaves the server; no ids, names or profile data. The
 * response is rate limited per address (and endpoint-wide) so it cannot be used
 * to bulk-enumerate the user base. The status necessarily tells the caller
 * whether the address they typed has an account — that is the "clear login
 * error" the product requires for an unregistered email — so the limiter, not
 * the wording, is the enumeration control here.
 */
export const checkLoginEmail = mutation({
  args: { email: v.string() },
  returns: v.object({
    status: v.union(v.literal("registered"), v.literal("unknown"), v.literal("rate_limited")),
  }),
  handler: async (ctx, args) => {
    let email: string;
    try {
      email = normalizeEmail(args.email);
    } catch {
      // Malformed input must not distinguish itself from a normal lookup.
      return { status: "unknown" as const };
    }

    // Key on a digest, not the address: rate-limit rows and the events they
    // emit are admin-readable and must not store an email in clear text.
    const digest = await hashIdentifier(email);
    const perEmail = await enforceFwRateLimit(ctx, `login-check:${digest}`, 10, 15 * 60_000, "medium");
    if (!perEmail) return { status: "rate_limited" as const };
    const endpoint = await enforceFwRateLimit(ctx, "login-check:endpoint", 300, 60_000, "medium");
    if (!endpoint) return { status: "rate_limited" as const };

    if (await accountExists(ctx, email, args.email)) {
      return { status: "registered" as const };
    }
    return { status: "unknown" as const };
  },
});

/**
 * Accounts created before a normalization pass may store the address with the
 * case it was typed in, so probe both the normalized value and the trimmed
 * input. Both are still exact index lookups.
 */
async function accountExists(
  ctx: MutationCtx,
  normalizedEmail: string,
  rawEmail: string,
): Promise<boolean> {
  for (const email of new Set([normalizedEmail, rawEmail.trim()])) {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "email-otp").eq("providerAccountId", email),
      )
      .unique();
    if (account) return true;
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (user && !user.isAnonymous) return true;
  }
  return false;
}
