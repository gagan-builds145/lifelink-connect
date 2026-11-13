import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export const SECURITY_SCOPED_ROLES = ["admin"] as const;


export type AppUser = Doc<"users">;

export const APP_ROLES = [
  "admin",
  "community",
  "donor",
  "requestor",
  "red_cross",
  "hospital",
  "drone_ops",
  "user",
  "member",
] as const;
export type AppRole = (typeof APP_ROLES)[number];

export function roleOf(user: AppUser | null | undefined): AppRole {
  return (user?.role ?? "user") as AppRole;
}

export async function requireUser(ctx: Ctx): Promise<AppUser> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("You must be signed in to do that.");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Your account could not be found. Please sign in again.");
  if (user.suspended) throw new Error("This account is suspended. Contact the LifeLink administrator.");
  return user;
}

export async function optionalUser(ctx: Ctx): Promise<AppUser | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.get(userId);
}

export async function requireRole(ctx: Ctx, roles: AppRole[]): Promise<AppUser> {
  const user = await requireUser(ctx);
  if (!roles.includes(roleOf(user))) {
    throw new Error("Your account is not authorized for this action.");
  }
  return user;
}

export const STAFF_ROLES: AppRole[] = ["red_cross", "hospital", "admin"];

export async function requireStaff(ctx: Ctx): Promise<AppUser> {
  return await requireRole(ctx, STAFF_ROLES);
}

export async function requireRedCross(ctx: Ctx): Promise<AppUser> {
  return await requireRole(ctx, ["red_cross", "admin"]);
}

export const DRONE_ROLES: AppRole[] = ["drone_ops", "admin"];

/** Flight dispatch is restricted to the drone operations role and admins. */
export async function requireDroneOps(ctx: Ctx): Promise<AppUser> {
  return await requireRole(ctx, DRONE_ROLES);
}

export async function requireAdmin(ctx: Ctx): Promise<AppUser> {
  return await requireRole(ctx, ["admin"]);
}

/** Returns the verified organization attached to this staff account. */
export async function requireOrganization(
  ctx: Ctx,
  user: AppUser,
  types: Array<"red_cross" | "hospital" | "blood_bank"> = [
    "red_cross",
    "hospital",
    "blood_bank",
  ],
): Promise<Doc<"organizations">> {
  const organizationId = user.organizationId;
  if (!organizationId) {
    throw new Error("No organization is linked to this account.");
  }
  const org = await ctx.db.get(organizationId);
  if (!org) throw new Error("Linked organization not found.");
  if (org.status !== "verified") {
    throw new Error("Your organization is not verified yet.");
  }
  if (!types.includes(org.type)) {
    throw new Error("This organization type cannot perform that action.");
  }
  return org;
}

export async function getDonorProfile(ctx: Ctx, userId: Id<"users">) {
  return await ctx.db
    .query("donorProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export async function getRequestorProfile(ctx: Ctx, userId: Id<"users">) {
  return await ctx.db
    .query("requestorProfiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

export async function nextSequentialId(
  ctx: MutationCtx,
  key: string,
  prefix: string,
  pad = 4,
) {
  const existing = await ctx.db
    .query("counters")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const next = (existing?.value ?? 0) + 1;
  if (existing) {
    await ctx.db.patch(existing._id, { value: next });
  } else {
    await ctx.db.insert("counters", { key, value: next });
  }
  return `${prefix}-${String(next).padStart(pad, "0")}`;
}

export async function enforceRateLimit(
  ctx: MutationCtx,
  scope: string,
  limit: number,
  windowMs = 60 * 60 * 1000,
) {
  const windowKey = `${scope}:${Math.floor(Date.now() / windowMs)}`;
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", windowKey))
    .unique();
  if (!existing) {
    await ctx.db.insert("rateLimits", {
      key: windowKey,
      count: 1,
      windowStartedAt: Date.now(),
    });
    return;
  }
  if (existing.count >= limit) {
    throw new Error("Too many attempts in a short time. Please try again later.");
  }
  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}

type NotificationInput = {
  title: string;
  body: string;
  kind: "request" | "match" | "inventory" | "camp" | "system";
  requestId?: Doc<"bloodRequests">["_id"];
  link?: string;
};

export async function notifyUser(
  ctx: MutationCtx,
  userId: Id<"users">,
  input: NotificationInput,
) {
  await ctx.db.insert("notifications", {
    userId,
    title: input.title,
    body: input.body,
    kind: input.kind,
    requestId: input.requestId,
    link: input.link,
    read: false,
    createdAt: Date.now(),
  });
}

export async function notifyOrganization(
  ctx: MutationCtx,
  organizationId: Id<"organizations">,
  input: NotificationInput,
) {
  const staff = await ctx.db
    .query("users")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect();
  for (const member of staff) {
    await notifyUser(ctx, member._id, input);
  }
}

export async function notifyRole(
  ctx: MutationCtx,
  role: AppRole,
  input: NotificationInput,
) {
  const members = await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", role))
    .collect();
  for (const member of members) {
    await notifyUser(ctx, member._id, input);
  }
}

export async function audit(
  ctx: MutationCtx,
  input: {
    actor: AppUser;
    action: string;
    entityType: string;
    entityId: string;
    detail: string;
    organizationId?: Doc<"organizations">["_id"];
    isDemo?: boolean;
  },
) {
  await ctx.db.insert("auditLogs", {
    actorUserId: input.actor._id,
    actorRole: roleOf(input.actor),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    detail: input.detail,
    organizationId: input.organizationId,
    isDemo: input.isDemo,
    createdAt: Date.now(),
  });
}

/**
 * Record a security-relevant event. This intentionally avoids storing tokens,
 * OTP codes, patient names or donor contacts. Use generic machine-readable
 * reasons and a human summary that is safe for admin dashboards.
 */
export async function recordSecurityEvent(
  ctx: MutationCtx,
  input: {
    kind:
      | "auth_failure"
      | "brute_force_suspect"
      | "otp_rate_limited"
      | "unauthorized_access"
      | "cross_user_access_denied"
      | "malformed_request"
      | "oversized_request"
      | "inventory_transfer_denied"
      | "ml_auth_failure"
      | "drone_command_denied"
      | "drone_command_replay_suspect"
      | "waf_blocked"
      | "rate_limited";
    severity: "low" | "medium" | "high" | "critical";
    service:
      | "web"
      | "auth"
      | "convex_api"
      | "ml_service"
      | "drone_ops"
      | "integration";
    reason: string;
    summary: string;
    clientRef?: string;
    entityType?: string;
    entityId?: string;
    organizationId?: Doc<"organizations">["_id"];
  },
) {
  await ctx.db.insert("securityEvents", {
    kind: input.kind,
    severity: input.severity,
    service: input.service,
    reason: input.reason,
    summary: input.summary,
    clientRef: input.clientRef,
    entityType: input.entityType,
    entityId: input.entityId,
    organizationId: input.organizationId,
    createdAt: Date.now(),
  });
}

/**
 * Convert an internal error into a safe public-facing message. Operational
 * details are written to audit/security logs separately; the user sees a stable
 * message that cannot leak stack traces, table names, tokens or identifiers.
 */
export function safeError(
  message: string,
  options?: { logDetail?: string; logAction?: string; logEntityType?: string; logEntityId?: string },
): Error {
  // The public message is always the stable one passed in. Any richer detail is
  // intentionally not attached to the thrown error.
  return new Error(message);
}

/* ------------------------------- validation ------------------------------ */

export function requireText(value: string, label: string, min = 2, max = 240) {
  const trimmed = (value ?? "").trim();
  if (trimmed.length < min) throw new Error(`${label} must be at least ${min} characters.`);
  if (trimmed.length > max) throw new Error(`${label} must be under ${max} characters.`);
  return trimmed;
}

export function normalizeEmail(value: string) {
  const email = (value ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

export function requirePhone(value: string) {
  const phone = (value ?? "").trim().replace(/[\s()-]/g, "");
  if (!/^\+?\d{10,15}$/.test(phone)) {
    throw new Error("Enter a valid phone number (10–15 digits).");
  }
  return phone;
}

export function requireDateString(value: string, label: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${label} must be a valid date.`);
  return d.toISOString().slice(0, 10);
}

export function requireUnits(value: number) {
  if (!Number.isFinite(value) || value < 1 || value > 20) {
    throw new Error("Units must be between 1 and 20.");
  }
  return Math.round(value);
}

/**
 * Normalize a client identifier for security logs. Never log raw tokens or
 * one-time codes. If a real IP or session ref is available upstream, pass it
 * here trimmed and truncated; otherwise fall back to a stable placeholder.
 */
export function normalizeClientRef(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  // Keep it short and generic. This is not a hash implementation; it is a
  // safeguard so callers do not accidentally paste a secret into the log.
  return trimmed.slice(0, 128);
}

/**
 * Auth firewall helpers.
 *
 * These are intended to be called from Convex auth integration points (for
 * example a custom auth mutation/action or a pre-auth hook if your deployment
 * uses one). They do not replace Convex Auth itself; they add brute-force
 * protection, OTP attempt rate limiting, account-enumeration-resistant failure
 * handling and security-event logging.
 */

export async function recordAuthOutcome(
  ctx: MutationCtx,
  input: {
    email: string;
    success: boolean;
    clientRef?: string;
    reason?: string;
  },
) {
  const normalized = normalizeEmail(input.email);
  if (input.success) {
    return;
  }
  // Keep failure output identical regardless of whether the email exists.
  // This is the main guard against account enumeration via sign-in timing/text.
  await recordSecurityEvent(ctx, {
    kind: "auth_failure",
    severity: "medium",
    service: "auth",
    reason: input.reason ?? "Sign-in attempt failed.",
    summary: `Sign-in attempt failed for ${normalized}.`,
    clientRef: normalizeClientRef(input.clientRef),
    entityType: "user",
    // Do not persist the email as the entity id in a way that distinguishes
    // nonexistent addresses from existing ones in admin tooling.
    entityId: "redacted",
  });
}

export async function enforceOtpRateLimit(
  ctx: MutationCtx,
  email: string,
  windowSeconds = 15 * 60,
  maxAttempts = 10,
): Promise<boolean> {
  const windowKey = `otp:${normalizeEmail(email)}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", windowKey))
    .first();
  if (!existing) {
    await ctx.db.insert("rateLimits", {
      key: windowKey,
      count: 1,
      windowStartedAt: Date.now(),
    });
    return true;
  }
  if (existing.count >= maxAttempts) {
    // Convex rolls back every write in a mutation that throws, including this
    // event. Denials therefore return `false` so the caller can stop work and
    // still leave a durable, admin-visible security event behind.
    await recordSecurityEvent(ctx, {
      kind: "otp_rate_limited",
      severity: "high",
      service: "auth",
      reason: `OTP requests exceeded ${maxAttempts} in a ${windowSeconds}s window for ${normalizeEmail(email)}.`,
      summary: `OTP request rate limit reached for ${normalizeEmail(email)}.`,
      entityType: "user",
      entityId: "redacted",
    });
    return false;
  }
  await ctx.db.patch(existing._id, { count: existing.count + 1 });
  return true;
}

/**
 * Generic request-firewall rate limit with security-event logging.
 * Use for sign-in, OTP, contact, upload and other abuse-prone endpoints.
 */
export async function enforceFwRateLimit(
  ctx: MutationCtx,
  key: string,
  limit: number,
  windowMs = 60 * 1000,
  severity: "medium" | "high" = "high",
): Promise<boolean> {
  const windowKey = `${key}:${Math.floor(Date.now() / windowMs)}`;
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", windowKey))
    .first();
  if (!existing) {
    await ctx.db.insert("rateLimits", {
      key: windowKey,
      count: 1,
      windowStartedAt: Date.now(),
    });
    return true;
  }
  if (existing.count >= limit) {
    // Return a denial instead of throwing so the security event survives the
    // transaction rollback that an exception would cause.
    await recordSecurityEvent(ctx, {
      kind: "rate_limited",
      severity,
      service: "web",
      reason: `Rate limit ${limit} reached for scope ${key} in a ${windowMs}ms window.`,
      summary: `Request rate limit exceeded for ${key}.`,
      clientRef: normalizeClientRef(key.split(":")[0] ?? undefined),
    });
    return false;
  }
  await ctx.db.patch(existing._id, { count: existing.count + 1 });
  return true;
}
