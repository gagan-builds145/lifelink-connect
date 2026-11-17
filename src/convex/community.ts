import { query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  getDonorProfile,
  getRequestorProfile,
  requireUser,
  roleOf,
} from "./lib/helpers";
import {
  COMPONENT_LABELS,
  STATUS_LABELS,
  donationGuidance,
  type Component,
  type RequestStatus,
} from "../lib/blood";

/**
 * Unified community dashboard data.
 *
 * Everything here is derived from the signed-in user's own rows. Nothing is
 * seeded, sampled or invented: an empty list means the account has no record of
 * that activity yet.
 */

type ActivityKind =
  | "donation"
  | "invitation"
  | "offer"
  | "request"
  | "allocation"
  | "transfer"
  | "receipt"
  | "availability"
  | "consent"
  | "donor_profile"
  | "requestor_profile";

type ActivityItem = {
  id: string;
  kind: ActivityKind;
  action: string;
  title: string;
  detail: string | null;
  status: string | null;
  at: number;
  href: string | null;
  requestCode: string | null;
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const ACTIVE_REQUEST_STATUSES: RequestStatus[] = [
  "pending",
  "under_verification",
  "approved",
  "dispatched",
  "partially_fulfilled",
];

const RECENT_LIMIT = 6;

async function collectActivity(ctx: QueryCtx, userId: Id<"users">): Promise<ActivityItem[]> {
  const items: ActivityItem[] = [];

  const organizations = await ctx.db.query("organizations").collect();
  const orgName = new Map(organizations.map((org) => [String(org._id), org.name]));

  /* ------------------------------- requests ------------------------------- */
  const requests = await ctx.db
    .query("bloodRequests")
    .withIndex("by_creator", (q) => q.eq("createdByUserId", userId))
    .collect();

  for (const request of requests) {
    const href = `/requests/${request._id}`;
    items.push({
      id: `request-created-${request._id}`,
      kind: "request",
      action: "created",
      title: `Request ${request.requestId} created`,
      detail: `${request.units} unit(s) ${COMPONENT_LABELS[request.component as Component]} · ${request.hospitalName}`,
      status: request.status,
      at: request.createdAt,
      href,
      requestCode: request.requestId,
    });

    const history = await ctx.db
      .query("requestStatusHistory")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect();
    for (const entry of history) {
      // The submission row duplicates the "created" event above.
      if (entry.status === "pending" && Math.abs(entry.createdAt - request.createdAt) < 5_000) {
        continue;
      }
      items.push({
        id: `request-status-${entry._id}`,
        kind: "request",
        action: entry.status,
        title: `Request ${request.requestId}: ${STATUS_LABELS[entry.status as RequestStatus]}`,
        detail: entry.note ?? null,
        status: entry.status,
        at: entry.createdAt,
        href,
        requestCode: request.requestId,
      });
    }

    const reservations = await ctx.db
      .query("inventoryReservations")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect();
    for (const reservation of reservations) {
      items.push({
        id: `reservation-${reservation._id}`,
        kind: "allocation",
        action: reservation.status,
        title: "Supply allocated",
        detail: `${reservation.units} unit(s) reserved for ${request.requestId} by ${orgName.get(String(reservation.organizationId)) ?? "a network facility"}.`,
        status: reservation.status,
        at: reservation.createdAt,
        href,
        requestCode: request.requestId,
      });
    }

    const transfers = await ctx.db
      .query("transfers")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect();
    for (const transfer of transfers) {
      if (transfer.dispatchedAt) {
        items.push({
          id: `transfer-dispatch-${transfer._id}`,
          kind: "transfer",
          action: "dispatched",
          title: `Transfer ${transfer.transferId} dispatched`,
          detail: `${transfer.units} unit(s) ${COMPONENT_LABELS[transfer.component as Component]} for ${request.requestId}.`,
          status: transfer.status,
          at: transfer.dispatchedAt,
          href,
          requestCode: request.requestId,
        });
      }
      if (transfer.receivedAt) {
        items.push({
          id: `transfer-received-${transfer._id}`,
          kind: "transfer",
          action: "received",
          title: `Transfer ${transfer.transferId} received`,
          detail: `Custody confirmed for ${request.requestId}.`,
          status: transfer.status,
          at: transfer.receivedAt,
          href,
          requestCode: request.requestId,
        });
      }
    }

    const receipts = await ctx.db
      .query("transferReceipts")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect();
    for (const receipt of receipts) {
      items.push({
        id: `receipt-${receipt._id}`,
        kind: "receipt",
        action: "verified",
        title: "Verified receipt",
        detail: `${receipt.units} unit(s) ${COMPONENT_LABELS[receipt.component as Component]} checked in for ${request.requestId}.`,
        status: "received",
        at: receipt.createdAt,
        href,
        requestCode: request.requestId,
      });
    }
  }

  /* ------------------------------ invitations ----------------------------- */
  const invitations = await ctx.db
    .query("donorInvitations")
    .withIndex("by_donor", (q) => q.eq("donorUserId", userId))
    .collect();
  for (const invite of invitations) {
    const facility = orgName.get(String(invite.requestingOrgId)) ?? "a network facility";
    items.push({
      id: `invite-${invite._id}`,
      kind: "invitation",
      action: "received",
      title: `Donation invitation · ${invite.bloodGroup} ${COMPONENT_LABELS[invite.component as Component]}`,
      detail: `${facility}${invite.distanceKm != null ? ` · ~${invite.distanceKm} km away` : ""}`,
      status: invite.status,
      at: invite.createdAt,
      href: "/community/dashboard?section=donate",
      requestCode: null,
    });
    if (invite.respondedAt) {
      items.push({
        id: `invite-response-${invite._id}`,
        kind: "invitation",
        action: invite.status,
        title: invite.status === "accepted" ? "Invitation accepted" : "Invitation declined",
        detail:
          invite.status === "accepted"
            ? `Appointment${invite.appointmentAt ? ` on ${new Date(invite.appointmentAt).toLocaleString()}` : ""} — final eligibility is confirmed at the centre.`
            : "The network keeps looking for other eligible donors.",
        status: invite.status,
        at: invite.respondedAt,
        href: "/community/dashboard?section=donate",
        requestCode: null,
      });
    }
  }

  /* ------------------------------- donations ------------------------------ */
  const donations = await ctx.db
    .query("donations")
    .withIndex("by_donor_user", (q) => q.eq("donorUserId", userId))
    .collect();
  for (const donation of donations) {
    items.push({
      id: `donation-${donation._id}`,
      kind: "donation",
      action: "recorded",
      title: "Donation recorded",
      detail: `${donation.units} unit(s) ${COMPONENT_LABELS[donation.component as Component]} at ${donation.organizationId ? orgName.get(String(donation.organizationId)) ?? "a partner facility" : "a partner facility"} · donated ${donation.donationDate}.`,
      status: "recorded",
      at: donation.createdAt,
      href: "/community/dashboard?section=donate",
      requestCode: null,
    });
  }

  /* --------------------------- donor offers made -------------------------- */
  const offers = await ctx.db
    .query("donorOffers")
    .withIndex("by_donor", (q) => q.eq("donorUserId", userId))
    .collect();
  for (const offer of offers) {
    const request = await ctx.db.get(offer.requestId);
    items.push({
      id: `offer-${offer._id}`,
      kind: "offer",
      action: "offered",
      title: "Offer to help sent",
      detail: request
        ? `${request.requestId} · ${request.hospitalName}`
        : "Coordinating team notified.",
      status: offer.status,
      at: offer.createdAt,
      href: request ? `/requests/${request._id}` : null,
      requestCode: request?.requestId ?? null,
    });
    if (offer.status === "accepted" && offer.updatedAt !== offer.createdAt) {
      items.push({
        id: `offer-accepted-${offer._id}`,
        kind: "offer",
        action: "accepted",
        title: "Offer accepted by the coordinating team",
        detail: request ? `A coordinator accepted your offer for ${request.requestId}.` : null,
        status: "accepted",
        at: offer.updatedAt,
        href: request ? `/requests/${request._id}` : null,
        requestCode: request?.requestId ?? null,
      });
    }
  }

  /* --------------------- profile, availability, consent ------------------- */
  const entries = await ctx.db
    .query("communityActivity")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const entry of entries) {
    items.push({
      id: `profile-${entry._id}`,
      kind: entry.kind,
      action: entry.kind,
      title: entry.title,
      detail: entry.detail ?? null,
      status: null,
      at: entry.createdAt,
      href: "/community/dashboard?section=profile",
      requestCode: null,
    });
  }

  // Most-recent-first, with a stable tie-break so React keys stay put.
  items.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  return items;
}

function monthlyDonations(
  rows: { createdAt: number; units: number }[],
): { key: string; label: string; count: number; units: number }[] {
  const buckets: { key: string; label: string; count: number; units: number }[] = [];
  const now = new Date();
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    buckets.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: MONTH_LABELS[date.getMonth()],
      count: 0,
      units: 0,
    });
  }
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const row of rows) {
    const date = new Date(row.createdAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const bucket = byKey.get(key);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.units += row.units;
  }
  return buckets;
}

/** Everything the overview cards, status panels and charts need. */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const donor = await getDonorProfile(ctx, user._id);
    const requestor = await getRequestorProfile(ctx, user._id);

    const [donations, requests, invitations, offers] = await Promise.all([
      ctx.db
        .query("donations")
        .withIndex("by_donor_user", (q) => q.eq("donorUserId", user._id))
        .collect(),
      ctx.db
        .query("bloodRequests")
        .withIndex("by_creator", (q) => q.eq("createdByUserId", user._id))
        .collect(),
      ctx.db
        .query("donorInvitations")
        .withIndex("by_donor", (q) => q.eq("donorUserId", user._id))
        .collect(),
      ctx.db
        .query("donorOffers")
        .withIndex("by_donor", (q) => q.eq("donorUserId", user._id))
        .collect(),
    ]);

    const unreadNotifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id).eq("read", false))
      .collect();

    const countByStatus = (status: RequestStatus) =>
      requests.filter((request) => request.status === status).length;

    const activity = await collectActivity(ctx, user._id);

    const totalUnits = donations.reduce((sum, row) => sum + row.units, 0);
    const lastDonationDate =
      donations
        .map((row) => row.donationDate)
        .sort((a, b) => b.localeCompare(a))[0] ??
      donor?.lastDonationDate ??
      null;

    return {
      role: roleOf(user),
      user: {
        name: user.name ?? null,
        email: user.email ?? null,
        city: user.city ?? null,
      },
      donor: donor
        ? {
            donorId: donor.donorId,
            fullName: donor.fullName,
            bloodGroup: donor.bloodGroup,
            city: donor.city,
            available: donor.available,
            shareContact: donor.shareContact,
            lastDonationDate: donor.lastDonationDate ?? null,
            createdAt: donor.createdAt,
            updatedAt: donor.updatedAt,
          }
        : null,
      requestor: requestor
        ? {
            requestorId: requestor.requestorId,
            fullName: requestor.fullName,
            city: requestor.city,
            requestorType: requestor.requestorType,
            createdAt: requestor.createdAt,
          }
        : null,
      donations: {
        count: donations.length,
        totalUnits,
        lastDonationDate,
        guidance: donationGuidance(lastDonationDate),
        monthly: monthlyDonations(donations),
      },
      invitations: {
        total: invitations.length,
        awaiting: invitations.filter((invite) => invite.status === "sent").length,
        accepted: invitations.filter((invite) => invite.status === "accepted").length,
        declined: invitations.filter((invite) => invite.status === "declined").length,
      },
      requests: {
        total: requests.length,
        active: requests.filter((request) =>
          ACTIVE_REQUEST_STATUSES.includes(request.status as RequestStatus),
        ).length,
        pending: countByStatus("pending") + countByStatus("under_verification"),
        partiallyFulfilled: countByStatus("partially_fulfilled"),
        fulfilled: countByStatus("fulfilled") + countByStatus("received"),
        cancelled: countByStatus("cancelled"),
        rejected: countByStatus("rejected"),
        emergency: requests.filter(
          (request) =>
            request.urgency === "emergency" &&
            !["fulfilled", "received", "cancelled", "rejected"].includes(request.status),
        ).length,
        byStatus: (
          [
            "pending",
            "under_verification",
            "approved",
            "dispatched",
            "partially_fulfilled",
            "received",
            "fulfilled",
            "cancelled",
            "rejected",
          ] as RequestStatus[]
        )
          .map((status) => ({
            status,
            label: STATUS_LABELS[status],
            count: countByStatus(status),
          }))
          .filter((row) => row.count > 0),
      },
      offers: {
        active: offers.filter((offer) => offer.status === "offered").length,
        accepted: offers.filter((offer) => offer.status === "accepted").length,
      },
      unreadNotifications: unreadNotifications.length,
      recentActivity: activity.slice(0, RECENT_LIMIT),
    };
  },
});

/** One merged, filterable timeline for the activity centre. */
export const activity = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const items = await collectActivity(ctx, user._id);
    return { items, generatedAt: Date.now() };
  },
});
