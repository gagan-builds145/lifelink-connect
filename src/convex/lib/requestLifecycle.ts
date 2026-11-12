import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { audit, roleOf, type AppUser } from "./helpers";

type Ctx = QueryCtx | MutationCtx;

/**
 * Verified quantities are the only source of truth for request fulfilment.
 * Transfer custody status is deliberately not consulted here.
 */
export async function verifiedReceivedUnits(
  ctx: Ctx,
  requestId: Id<"bloodRequests">,
): Promise<number> {
  const receipts = await ctx.db
    .query("transferReceipts")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .collect();
  return receipts.reduce((sum, receipt) => sum + receipt.units, 0);
}

export async function activeReservedUnits(
  ctx: Ctx,
  requestId: Id<"bloodRequests">,
): Promise<number> {
  const reservations = await ctx.db
    .query("inventoryReservations")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .collect();
  return reservations
    .filter((reservation) => reservation.status === "active")
    .reduce((sum, reservation) => sum + reservation.units, 0);
}

export async function requestCoverage(
  ctx: Ctx,
  request: Doc<"bloodRequests">,
): Promise<{
  receivedUnits: number;
  reservedUnits: number;
  inFlightUnits: number;
  remainingUnits: number;
}> {
  const [receivedUnits, reservedUnits, transfers] = await Promise.all([
    verifiedReceivedUnits(ctx, request._id),
    activeReservedUnits(ctx, request._id),
    ctx.db
      .query("transfers")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect(),
  ]);
  // Dispatch consumes the reservation but not the need. Units already on the
  // road must not be allocated a second time while receipt is pending.
  const inFlightUnits = transfers
    .filter((transfer) => transfer.status === "dispatched" || transfer.status === "in_transit")
    .reduce((sum, transfer) => sum + transfer.units, 0);
  return {
    receivedUnits,
    reservedUnits,
    inFlightUnits,
    remainingUnits: Math.max(
      0,
      request.units - receivedUnits - reservedUnits - inFlightUnits,
    ),
  };
}

export function fulfilmentStatusFor(
  request: Doc<"bloodRequests">,
  receivedUnits: number,
): Doc<"bloodRequests">["status"] | null {
  if (receivedUnits < 1) return null;
  if (request.status === "cancelled" || request.status === "rejected") return null;
  if (receivedUnits >= request.units) return "fulfilled";
  // The legacy `received` status predates quantity reconciliation. Do not
  // downgrade it while still allowing new transfer receipts to advance it.
  if (request.status === "received") return null;
  return "partially_fulfilled";
}

/**
 * Reconciles a verified receipt into the request lifecycle. The caller must
 * already have authenticated the receiving facility and validated the receipt.
 * Writes the status, history, and audit row in the same Convex mutation.
 */
export async function reconcileRequestReceipt(
  ctx: MutationCtx,
  args: {
    request: Doc<"bloodRequests">;
    actor: AppUser;
    note?: string;
  },
): Promise<{
  receivedUnits: number;
  status: Doc<"bloodRequests">["status"];
  changed: boolean;
}> {
  const receivedUnits = await verifiedReceivedUnits(ctx, args.request._id);
  const nextStatus = fulfilmentStatusFor(args.request, receivedUnits);
  if (!nextStatus || nextStatus === args.request.status) {
    return {
      receivedUnits,
      status: args.request.status,
      changed: false,
    };
  }

  const now = Date.now();
  await ctx.db.patch(args.request._id, {
    status: nextStatus,
    updatedAt: now,
  });
  await ctx.db.insert("requestStatusHistory", {
    requestId: args.request._id,
    status: nextStatus,
    actorUserId: args.actor._id,
    actorRole: roleOf(args.actor),
    note:
      args.note ??
      (nextStatus === "fulfilled"
        ? `${receivedUnits}/${args.request.units} requested unit(s) verified by the receiving facility.`
        : `${receivedUnits}/${args.request.units} requested unit(s) verified; the request remains partially fulfilled.`),
    isDemo: args.request.isDemo,
    createdAt: now,
  });
  await audit(ctx, {
    actor: args.actor,
    action: `request.${nextStatus}`,
    entityType: "bloodRequest",
    entityId: args.request.requestId,
    detail: `${receivedUnits} verified unit(s) received against ${args.request.units} requested.`,
    organizationId: args.request.hospitalOrgId,
    isDemo: args.request.isDemo,
  });

  return {
    receivedUnits,
    status: nextStatus,
    changed: true,
  };
}
