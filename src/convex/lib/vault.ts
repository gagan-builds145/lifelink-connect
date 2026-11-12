import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  optionalUser,
  requireUser,
  roleOf,
  type AppUser,
  type AppRole,
} from "./helpers";

export type Ctx = QueryCtx | MutationCtx;

/**
 * Vault-style authorization helpers for LifeLink.
 *
 * These sit on top of the existing role helpers and are deliberately narrow:
 * ownership checks, staff/organization guards, transfer-receipt authorization,
 * ML-token presence checks, and drone command authorization primitives.
 * They do not replace existing mutation logic; they centralize the patterns
 * that protect blood supply chain operations.
 */

// ---------------------------------------------------------------------------
// User presence
// ---------------------------------------------------------------------------

export async function requireSignedIn(ctx: Ctx): Promise<AppUser> {
  return requireUser(ctx);
}

export async function maybeUser(ctx: Ctx): Promise<AppUser | null> {
  return optionalUser(ctx);
}

// ---------------------------------------------------------------------------
// Role guards
// ---------------------------------------------------------------------------

export async function requireRole(ctx: Ctx, roles: AppRole[]): Promise<AppUser> {
  const user = await requireUser(ctx);
  const role = roleOf(user);
  if (!roles.includes(role)) {
    throw new Error("Your account is not authorized for this action.");
  }
  return user;
}

export async function requireAnyOf(ctx: Ctx, roles: AppRole[]): Promise<AppUser> {
  return requireRole(ctx, roles);
}

export async function requireAdmin(ctx: Ctx): Promise<AppUser> {
  return requireRole(ctx, ["admin"]);
}

export async function requireStaff(ctx: Ctx): Promise<AppUser> {
  return requireRole(ctx, ["red_cross", "hospital", "admin"]);
}

export async function requireReceivingOrg(
  ctx: Ctx,
  user: AppUser,
  orgId: Id<"organizations">,
): Promise<Doc<"organizations">> {
  const role = roleOf(user);
  if (role !== "admin" && user.organizationId !== orgId) {
    throw new Error("Only the intended receiving organization can perform this action.");
  }
  const org = await ctx.db.get(orgId);
  if (!org) throw new Error("Organization not found.");
  if (org.status !== "verified") {
    throw new Error("The receiving organization is not verified.");
  }
  return org;
}

export async function requireLinkedOrg(
  ctx: Ctx,
  user: AppUser,
  types: Array<"red_cross" | "hospital" | "blood_bank"> = [
    "red_cross",
    "hospital",
    "blood_bank",
  ],
): Promise<Doc<"organizations">> {
  if (!user.organizationId) {
    throw new Error("No organization is linked to this account.");
  }
  const org = await ctx.db.get(user.organizationId);
  if (!org) throw new Error("Linked organization not found.");
  if (org.status !== "verified") {
    throw new Error("Your organization is not verified.");
  }
  if (!types.includes(org.type)) {
    throw new Error("This organization type cannot perform that action.");
  }
  return org;
}

// ---------------------------------------------------------------------------
// Cross-user / tenant isolation
// ---------------------------------------------------------------------------

export async function canAccessRequest(
  ctx: Ctx,
  user: AppUser,
  request: Doc<"bloodRequests">,
): Promise<boolean> {
  const role = roleOf(user);
  if (role === "admin" || role === "red_cross") return true;
  if (request.createdByUserId === user._id) return true;
  if (
    role === "hospital" &&
    user.organizationId &&
    (request.hospitalOrgId === user.organizationId ||
      request.assignedOrgId === user.organizationId)
  ) {
    return true;
  }
  return false;
}

export async function authorizeRequestAccess(
  ctx: Ctx,
  user: AppUser,
  request: Doc<"bloodRequests">,
): Promise<Doc<"bloodRequests">> {
  const ok = await canAccessRequest(ctx, user, request);
  if (!ok) {
    throw new Error("You are not authorized to access that request.");
  }
  return request;
}

// ---------------------------------------------------------------------------
// Transfer / inventory authorization
// ---------------------------------------------------------------------------

export async function authorizeTransferOwnershipOrStaff(
  ctx: Ctx,
  user: AppUser,
  transfer: Doc<"transfers">,
): Promise<Doc<"transfers">> {
  const role = roleOf(user);
  if (role === "admin") return transfer;
  if (user.organizationId !== transfer.requestingOrgId && user.organizationId !== transfer.supplyingOrgId) {
    throw new Error("Your facility is not part of this transfer.");
  }
  return transfer;
}

export async function authorizeSupplySideTransfer(
  ctx: Ctx,
  user: AppUser,
  transfer: Doc<"transfers">,
): Promise<Doc<"transfers">> {
  const role = roleOf(user);
  if (role === "admin") return transfer;
  if (user.organizationId !== transfer.supplyingOrgId) {
    throw new Error("Only the supplying facility can perform this action.");
  }
  return transfer;
}

export async function authorizeReceiptSideTransfer(
  ctx: Ctx,
  user: AppUser,
  transfer: Doc<"transfers">,
): Promise<Doc<"transfers">> {
  const role = roleOf(user);
  if (role === "admin") return transfer;
  if (user.organizationId !== transfer.requestingOrgId) {
    throw new Error("Only the receiving facility can confirm this transfer.");
  }
  return transfer;
}

export async function authorizeRequestSideTransfer(
  ctx: Ctx,
  user: AppUser,
  transfer: Doc<"transfers">,
): Promise<Doc<"transfers">> {
  const role = roleOf(user);
  if (role === "admin") return transfer;
  if (user.organizationId !== transfer.requestingOrgId) {
    throw new Error("Only the requesting facility can perform this action.");
  }
  return transfer;
}

// ---------------------------------------------------------------------------
// Inventory mutation guards
// ---------------------------------------------------------------------------

export async function authorizeInventoryOwnershipOrStaff(
  ctx: Ctx,
  user: AppUser,
  inventory: Doc<"inventory">,
): Promise<Doc<"inventory">> {
  const role = roleOf(user);
  if (role === "admin") return inventory;
  if (user.organizationId !== inventory.organizationId) {
    throw new Error("You cannot modify another organization's inventory.");
  }
  return inventory;
}

export async function guardInventoryMutationByOrg(
  ctx: Ctx,
  user: AppUser,
  organizationId: Id<"organizations">,
): Promise<Doc<"organizations">> {
  const role = roleOf(user);
  if (role === "admin") {
    const org = await ctx.db.get(organizationId);
    if (!org) throw new Error("Organization not found.");
    return org;
  }
  if (user.organizationId !== organizationId) {
    throw new Error("You cannot modify another organization's inventory.");
  }
  return await requireLinkedOrg(ctx, user);
}

// ---------------------------------------------------------------------------
// ML service token checks (Convex-side)
// ---------------------------------------------------------------------------

export function mlServiceTokenConfigured(): boolean {
  return Boolean(process.env.ML_SERVICE_TOKEN?.trim());
}

export function requireMlServiceToken(): void {
  if (!mlServiceTokenConfigured()) {
    throw new Error("The ML service token is not configured on this deployment.");
  }
}

// ---------------------------------------------------------------------------
// Drone command authorization primitives
// ---------------------------------------------------------------------------

export async function requireDroneCommandAuthority(ctx: Ctx): Promise<AppUser> {
  const user = await requireUser(ctx);
  const role = roleOf(user);
  if (role !== "admin" && role !== "drone_ops") {
    throw new Error("Only drone operations staff or administrators can issue drone commands.");
  }
  return user;
}

export async function requireMissionAuthorityForOrganization(
  ctx: Ctx,
  user: AppUser,
  mission: Doc<"droneMissions">,
): Promise<Doc<"droneMissions">> {
  const role = roleOf(user);
  if (role === "admin" || role === "drone_ops") return mission;
  if (user.organizationId !== mission.pickupOrgId && user.organizationId !== mission.dropoffOrgId) {
    throw new Error("Your facility is not part of this mission.");
  }
  return mission;
}

export async function requireDropoffAuthorityForMission(
  ctx: Ctx,
  user: AppUser,
  mission: Doc<"droneMissions">,
): Promise<Doc<"droneMissions">> {
  const role = roleOf(user);
  if (role === "admin" || role === "drone_ops") return mission;
  if (user.organizationId !== mission.dropoffOrgId) {
    throw new Error("Only the receiving facility can confirm delivery for this mission.");
  }
  return mission;
}

// ---------------------------------------------------------------------------
// Generic unsafe-input guards
// ---------------------------------------------------------------------------

export function guardAgainstOversizedJson(
  body: unknown,
  maxBytes: number,
): void {
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  if (encoded.length > maxBytes) {
    throw new Error("Request payload is too large.");
  }
}

export function guardStringField(
  value: unknown,
  label: string,
  maxBytes: number,
  regex?: RegExp,
): string {
  const str = value != null && typeof value === "string" ? value : "";
  if (!str.trim()) throw new Error(`${label} is required.`);
  if (new TextEncoder().encode(str).length > maxBytes) {
    throw new Error(`${label} is too long.`);
  }
  if (regex && !regex.test(str)) {
    throw new Error(`${label} is not formatted correctly.`);
  }
  return str;
}
