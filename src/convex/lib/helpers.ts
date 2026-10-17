import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export type AppUser = Doc<"users">;

export const APP_ROLES = [
  "admin",
  "donor",
  "requestor",
  "red_cross",
  "hospital",
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
