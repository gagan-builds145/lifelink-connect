import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  audit,
  enforceRateLimit,
  getDonorProfile,
  nextSequentialId,
  normalizeEmail,
  notifyOrganization,
  notifyRole,
  notifyUser,
  requireOrganization,
  requirePhone,
  requireRedCross,
  requireStaff,
  requireText,
  requireUnits,
  requireUser,
  roleOf,
} from "./lib/helpers";
import {
  bloodGroupValidator,
  componentValidator,
  requestStatusValidator,
  requestorTypeValidator,
  urgencyValidator,
} from "./validators";
import { compatibility, locationRule, scoreMatch, stateOfCity, URGENCY_LABELS } from "../lib/blood";
import { evaluateStockLevel } from "./lib/stockWatch";

const MAX_DOC_BYTES = 5 * 1024 * 1024;
const ALLOWED_DOC_TYPES = ["application/pdf", "image/jpeg", "image/png"];

const summaryFields = (r: Doc<"bloodRequests">) => ({
  _id: r._id,
  requestId: r.requestId,
  source: r.source,
  bloodGroup: r.bloodGroup,
  component: r.component,
  units: r.units,
  urgency: r.urgency,
  status: r.status,
  city: r.city,
  hospitalName: r.hospitalName,
  requiredBy: r.requiredBy,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  isDemo: r.isDemo ?? false,
  assignedOrgId: r.assignedOrgId ?? null,
  hasDocument: r.documentId != null,
  requestorName: r.requestorName,
  patientRef: r.patientRef,
});

/**
 * Requests a donor may still help with: awaiting verification, in review, or
 * approved. Donors see the request (with its status) as soon as it is created
 * instead of only after Red Cross approval; coordinators still control
 * verification, reservation and dispatch.
 */
const OPEN_REQUEST_STATUSES: ReadonlySet<Doc<"bloodRequests">["status"]> = new Set([
  "pending",
  "under_verification",
  "approved",
]);

async function isFullViewer(
  ctx: any,
  user: Doc<"users">,
  request: Doc<"bloodRequests">,
) {
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

async function addHistory(
  ctx: any,
  request: Doc<"bloodRequests">,
  status: Doc<"bloodRequests">["status"],
  actorRole: string,
  actorUserId: Id<"users">,
  note?: string,
) {
  await ctx.db.insert("requestStatusHistory", {
    requestId: request._id,
    status,
    actorUserId,
    actorRole,
    note,
    createdAt: Date.now(),
  });
}

/**
 * Donor alerts are sent only after a request has been verified/approved, never
 * while it is an unverified submission. The payload never contains patient
 * identity, contact details or a precise address.
 */
async function notifyCompatibleDonors(
  ctx: any,
  request: Doc<"bloodRequests">,
) {
  const donors = await ctx.db
    .query("donorProfiles")
    .withIndex("by_availability", (q: any) => q.eq("available", true))
    .collect();
  const requestState = stateOfCity(request.city);
  let notified = 0;
  for (const donor of donors) {
    if (notified >= 25) break;
    // Blood group, state and country must match; only an emergency may widen
    // the area beyond the request's own city.
    const location = locationRule(donor.city, request.city, request.urgency);
    if (!location.ok) continue;
    if (!compatibility(donor.bloodGroup, request.bloodGroup, request.component).compatible) {
      continue;
    }
    const area = location.sameCity
      ? request.city
      : `${request.city}, ${requestState ?? "same state"}`;
    await notifyUser(ctx, donor.userId, {
      title: location.sameCity
        ? `Donor match near ${request.city}`
        : `Emergency donor match · ${area}`,
      body: `A verified ${URGENCY_LABELS[request.urgency].toLowerCase()} request needs ${request.component.replace("_", " ")} at a hospital in ${area}. Open your dashboard to view the masked request.`,
      kind: "match",
      requestId: request._id,
      link: "/donor/dashboard",
    });
    notified += 1;
  }
}

export const create = mutation({
  args: {
    source: v.union(v.literal("requestor"), v.literal("hospital")),
    requestorName: v.string(),
    requestorType: requestorTypeValidator,
    requesterPhone: v.string(),
    requesterEmail: v.optional(v.string()),
    patientName: v.string(),
    patientRef: v.string(),
    patientAge: v.optional(v.number()),
    hospitalName: v.string(),
    city: v.string(),
    area: v.optional(v.string()),
    bloodGroup: bloodGroupValidator,
    component: componentValidator,
    units: v.number(),
    requiredBy: v.number(),
    urgency: urgencyValidator,
    reason: v.string(),
    doctorName: v.optional(v.string()),
    doctorContact: v.optional(v.string()),
    documentId: v.optional(v.id("documentMetadata")),
    consent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.consent !== true) {
      throw new Error("You must confirm the declaration before submitting a request.");
    }
    await enforceRateLimit(ctx, `request-create:${user._id}`, 6);

    const role = roleOf(user);
    let organization = null;
    if (args.source === "hospital") {
      if (!["hospital", "admin"].includes(role)) {
        throw new Error("Only verified hospital staff can submit a hospital request.");
      }
      organization = await requireOrganization(ctx, user, ["hospital"]);
    } else if (!["requestor", "donor", "user", "member"].includes(role)) {
      throw new Error("This account cannot submit a requestor request.");
    }

    const units = requireUnits(args.units);
    const patientName = requireText(args.patientName, "Patient name", 2, 120);
    const patientRef = requireText(args.patientRef, "Patient ID / reference", 2, 80);
    const hospitalName =
      organization?.name ?? requireText(args.hospitalName, "Hospital name", 2, 160);
    const city = requireText(args.city, "City", 2, 80);
    const reason = requireText(args.reason, "Reason for request", 10, 600);
    const requesterPhone = requirePhone(args.requesterPhone);
    const requiredBy = Number(args.requiredBy);
    if (!Number.isFinite(requiredBy) || requiredBy < Date.now() - 60_000) {
      throw new Error("The required date and time must be in the future.");
    }
    if (requiredBy > Date.now() + 90 * 86_400_000) {
      throw new Error("Required date must be within the next 90 days.");
    }
    if (
      args.patientAge != null &&
      (!Number.isFinite(args.patientAge) || args.patientAge < 0 || args.patientAge > 120)
    ) {
      throw new Error("Patient age must be between 0 and 120.");
    }

    if (args.documentId) {
      const doc = await ctx.db.get(args.documentId);
      if (!doc || doc.uploadedByUserId !== user._id) {
        throw new Error("The attached document is not available to this account.");
      }
      if (doc.requestId) throw new Error("That document is already attached to another request.");
      if (!ALLOWED_DOC_TYPES.includes(doc.contentType) || doc.size > MAX_DOC_BYTES) {
        throw new Error("Documents must be PDF, JPEG or PNG and under 5 MB.");
      }
    }

    const requestId = await nextSequentialId(ctx, "blood-request", "LL-REQ");
    const now = Date.now();
    const id = await ctx.db.insert("bloodRequests", {
      requestId,
      source: args.source,
      createdByUserId: user._id,
      createdByOrgId: organization?._id,
      requestorName: requireText(args.requestorName, "Requestor name"),
      requestorType: args.requestorType,
      requesterPhone,
      requesterEmail: args.requesterEmail ? normalizeEmail(args.requesterEmail) : undefined,
      patientName,
      patientRef,
      patientAge: args.patientAge,
      hospitalName,
      hospitalOrgId: organization?._id,
      city,
      area: args.area,
      bloodGroup: args.bloodGroup,
      component: args.component,
      units,
      requiredBy,
      urgency: args.urgency,
      reason,
      doctorName: args.doctorName,
      doctorContact: args.doctorContact,
      documentId: args.documentId,
      consent: true,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const request = (await ctx.db.get(id))!;

    if (args.documentId) {
      await ctx.db.patch(args.documentId, { requestId: id });
    }

    await addHistory(
      ctx,
      request,
      "pending",
      args.source === "hospital" ? "hospital" : "requestor",
      user._id,
      "Request submitted and queued for verification.",
    );

    await notifyRole(ctx, "red_cross", {
      title: `${args.urgency === "emergency" ? "Emergency" : "New"} request ${requestId}`,
      body: `${args.bloodGroup} ${args.component.replace("_", " ")} · ${units} unit(s) needed in ${city}. Sign in to verify.`,
      kind: "request",
      requestId: id,
      link: "/red-cross/dashboard",
    });

    if (args.source === "hospital" && organization) {
      await notifyOrganization(ctx, organization._id, {
        title: `Request ${requestId} submitted`,
        body: `Your request is pending Red Cross verification. Track its status from the hospital dashboard.`,
        kind: "request",
        requestId: id,
        link: "/hospital/dashboard",
      });
    }

    await audit(ctx, {
      actor: user,
      action: "request.created",
      entityType: "bloodRequest",
      entityId: requestId,
      detail: `${args.bloodGroup} ${args.component} x${units} for ${city}; urgency ${args.urgency}.`,
      organizationId: organization?._id,
    });

    return { id, requestId };
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const role = roleOf(user);
    const byCreator = await ctx.db
      .query("bloodRequests")
      .withIndex("by_creator", (q) => q.eq("createdByUserId", user._id))
      .collect();
    let rows = byCreator;
    if (role === "hospital" && user.organizationId) {
      const byOrg = await ctx.db
        .query("bloodRequests")
        .withIndex("by_hospital_org", (q) => q.eq("hospitalOrgId", user.organizationId!))
        .collect();
      const map = new Map(rows.map((r) => [r._id, r]));
      for (const r of byOrg) map.set(r._id, r);
      rows = [...map.values()];
    }
    return rows.sort((a, b) => b.createdAt - a.createdAt).map(summaryFields);
  },
});

export const listForStaff = query({
  args: {
    status: v.optional(v.string()),
    city: v.optional(v.string()),
    bloodGroup: v.optional(v.string()),
    component: v.optional(v.string()),
    urgency: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireStaff(ctx);
    const role = roleOf(user);
    let rows = await ctx.db.query("bloodRequests").collect();
    if (role === "hospital") {
      rows = rows.filter(
        (r) =>
          r.hospitalOrgId === user.organizationId ||
          r.assignedOrgId === user.organizationId,
      );
    }
    const search = (args.search ?? "").trim().toLowerCase();
    return rows
      .filter((r) => (args.status ? r.status === args.status : true))
      .filter((r) => (args.city ? r.city === args.city : true))
      .filter((r) => (args.bloodGroup ? r.bloodGroup === args.bloodGroup : true))
      .filter((r) => (args.component ? r.component === args.component : true))
      .filter((r) => (args.urgency ? r.urgency === args.urgency : true))
      .filter((r) =>
        search
          ? [r.requestId, r.patientRef, r.hospitalName, r.city, r.requestorName]
              .join(" ")
              .toLowerCase()
              .includes(search)
          : true,
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(summaryFields);
  },
});

export const getDetail = query({
  args: { id: v.id("bloodRequests") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const request = await ctx.db.get(args.id);
    if (!request) return null;

    const full = await isFullViewer(ctx, user, request);
    const donor = await getDonorProfile(ctx, user._id);
    const donorCompatible =
      donor != null &&
      compatibility(donor.bloodGroup, request.bloodGroup, request.component).compatible &&
      OPEN_REQUEST_STATUSES.has(request.status);
    if (!full && !donorCompatible) {
      return null;
    }

    const history = await ctx.db
      .query("requestStatusHistory")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect();

    let document: { fileName: string; contentType: string; url: string | null } | null =
      null;
    if (full && request.documentId) {
      const meta = await ctx.db.get(request.documentId);
      if (meta) {
        document = {
          fileName: meta.fileName,
          contentType: meta.contentType,
          url: await ctx.storage.getUrl(meta.storageId),
        };
      }
    }

    const offers = full
      ? await ctx.db
          .query("donorOffers")
          .withIndex("by_request", (q) => q.eq("requestId", request._id))
          .collect()
      : [];
    const offerRows = [];
    for (const offer of offers) {
      const profile = await ctx.db.get(offer.donorProfileId);
      const donorUser = await ctx.db.get(offer.donorUserId);
      const canShare =
        profile?.shareContact === true &&
        ["red_cross", "admin"].includes(roleOf(user));
      offerRows.push({
        _id: offer._id,
        status: offer.status,
        note: offer.note ?? null,
        createdAt: offer.createdAt,
        donorName: canShare ? profile?.fullName ?? "Donor" : "Donor (contact protected)",
        donorId: profile?.donorId ?? null,
        bloodGroup: profile?.bloodGroup ?? null,
        city: profile?.city ?? null,
        phone: canShare ? profile?.phone ?? null : null,
        email: canShare ? donorUser?.email ?? null : null,
      });
    }

    const myOffer = donor
      ? await ctx.db
          .query("donorOffers")
          .withIndex("by_request", (q) => q.eq("requestId", request._id))
          .filter((q) => q.eq(q.field("donorUserId"), user._id))
          .first()
      : null;

    const assignedOrg = request.assignedOrgId
      ? await ctx.db.get(request.assignedOrgId)
      : null;
    const hospitalOrg = request.hospitalOrgId
      ? await ctx.db.get(request.hospitalOrgId)
      : null;
    const activeReservations = full
      ? await ctx.db
          .query("inventoryReservations")
          .withIndex("by_request", (q) => q.eq("requestId", request._id))
          .collect()
      : [];
    const reservedUnits = activeReservations
      .filter((r) => r.status === "active")
      .reduce((sum, r) => sum + r.units, 0);

    // Pressing "Offer to help" unlocks the requestor's basic coordination
    // details (name, phone, hospital location) for that responder. Patient
    // identity, prescriptions and documents stay restricted to staff.
    const contactUnlocked =
      full || (myOffer != null && myOffer.status !== "withdrawn");

    return {
      viewer: full ? ("full" as const) : ("donor" as const),
      contactUnlocked,
      request: {
        ...summaryFields(request),
        area: contactUnlocked ? request.area ?? null : null,
        requestorType: request.requestorType,
        patientName: full ? request.patientName : "Confidential",
        patientAge: full ? request.patientAge ?? null : null,
        patientRef: full ? request.patientRef : "Restricted",
        requesterPhone: contactUnlocked ? request.requesterPhone : null,
        requesterEmail: contactUnlocked ? request.requesterEmail ?? null : null,
        hospitalPhone: contactUnlocked ? hospitalOrg?.phone ?? null : null,
        hospitalAddress: contactUnlocked ? hospitalOrg?.address ?? null : null,
        reason: full ? request.reason : "Clinical details are restricted to authorized staff.",
        doctorName: full ? request.doctorName ?? null : null,
        doctorContact: full ? request.doctorContact ?? null : null,
        verifiedAt: request.verifiedAt ?? null,
        rejectionReason: full ? request.rejectionReason ?? null : null,
        createdByUserId: request.createdByUserId ?? null,
        hospitalOrgId: request.hospitalOrgId ?? null,
        assignedOrgName: assignedOrg?.name ?? null,
        assignedOrgPhone: full ? assignedOrg?.phone ?? null : null,
        reservedUnits,
        documentId: full ? request.documentId ?? null : null,
      },
      history: history
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((h) => ({
          _id: h._id,
          status: h.status,
          actorRole: h.actorRole,
          note: full ? h.note ?? null : null,
          createdAt: h.createdAt,
        })),
      document,
      offers: offerRows,
      myOffer: myOffer
        ? { _id: myOffer._id, status: myOffer.status, note: myOffer.note ?? null }
        : null,
      canManage: full,
    };
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("bloodRequests"),
    status: requestStatusValidator,
    note: v.optional(v.string()),
    assignedOrgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const request = await ctx.db.get(args.id);
    if (!request) throw new Error("Request not found.");
    const role = roleOf(user);
    const status = args.status;
    const now = Date.now();
    const note = args.note?.trim() || undefined;

    if (status === "cancelled") {
      const isOwner =
        request.createdByUserId === user._id ||
        (role === "hospital" &&
          user.organizationId != null &&
          request.hospitalOrgId === user.organizationId);
      if (!isOwner || !["pending", "under_verification"].includes(request.status)) {
        throw new Error("Only the request owner can cancel a pending request.");
      }
      await ctx.db.patch(request._id, {
        status: "cancelled",
        updatedAt: now,
      });
      await addHistory(ctx, request, "cancelled", role, user._id, note ?? "Cancelled by request owner.");
      await notifyRole(ctx, "red_cross", {
        title: `Request ${request.requestId} cancelled`,
        body: "The requestor cancelled this request. No stock should be reserved.",
        kind: "request",
        requestId: request._id,
        link: "/red-cross/dashboard",
      });
      await audit(ctx, {
        actor: user,
        action: "request.cancelled",
        entityType: "bloodRequest",
        entityId: request.requestId,
        detail: "Request cancelled by owner.",
      });
      return { ok: true };
    }

    if (!["red_cross", "admin", "hospital"].includes(role)) {
      throw new Error("Only authorized staff can change request status.");
    }

    if (status === "received") {
      if (
        role !== "hospital" ||
        !user.organizationId ||
        request.hospitalOrgId !== user.organizationId
      ) {
        throw new Error("Only the receiving hospital can record receipt.");
      }
      if (request.status !== "dispatched") {
        throw new Error("Stock must be dispatched before receipt can be recorded.");
      }
      await ctx.db.patch(request._id, { status: "received", updatedAt: now });
      // Close the ledger loop: the units already left stock at dispatch, so the
      // receipt rows document custody without changing available units again.
      const dispatchedRows = await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_request", (q) => q.eq("requestId", request._id))
        .collect();
      for (const row of dispatchedRows.filter((t) => t.type === "dispatch")) {
        await ctx.db.insert("inventoryTransactions", {
          inventoryId: row.inventoryId,
          organizationId: row.organizationId,
          type: "receipt",
          units: row.units,
          bloodGroup: row.bloodGroup,
          component: row.component,
          requestId: request._id,
          actorUserId: user._id,
          actorRole: role,
          note: `Receipt confirmed by hospital for ${request.requestId}`,
          createdAt: now,
        });
      }
      await addHistory(ctx, request, "received", role, user._id, note ?? "Hospital recorded receipt.");
      if (request.createdByUserId) {
        await notifyUser(ctx, request.createdByUserId, {
          title: `Request ${request.requestId} received`,
          body: "The hospital confirmed receipt of the blood components.",
          kind: "request",
          requestId: request._id,
          link: `/requests/${request._id}`,
        });
      }
      if (request.assignedOrgId) {
        await notifyOrganization(ctx, request.assignedOrgId, {
          title: `Receipt confirmed for ${request.requestId}`,
          body: "The receiving hospital confirmed receipt. The shared inventory ledger now includes the receipt entry.",
          kind: "request",
          requestId: request._id,
          link: `/requests/${request._id}`,
        });
      }
      await audit(ctx, {
        actor: user,
        action: "request.received",
        entityType: "bloodRequest",
        entityId: request.requestId,
        detail: "Hospital confirmed receipt.",
        organizationId: user.organizationId,
      });
      return { ok: true };
    }

    if (role === "hospital") {
      throw new Error("Hospitals may only confirm receipt or cancel their own pending request.");
    }

    const allowed: Record<string, string[]> = {
      pending: ["under_verification", "rejected"],
      under_verification: ["approved", "rejected"],
      approved: ["fulfilled"],
      dispatched: ["fulfilled"],
      received: ["fulfilled"],
    };
    if (!allowed[request.status]?.includes(status)) {
      throw new Error(`Cannot move a request from ${request.status} to ${status}.`);
    }
    if (status === "fulfilled") {
      const reservations = await ctx.db
        .query("inventoryReservations")
        .withIndex("by_request", (q) => q.eq("requestId", request._id))
        .collect();
      if (reservations.some((r) => r.status === "active")) {
        throw new Error(
          "This request still has reserved stock. Dispatch it first or release the reservation before marking it fulfilled.",
        );
      }
    }

    let assignedOrgId = request.assignedOrgId;
    if (status === "approved") {
      const org = await requireOrganization(ctx, user, ["red_cross"]);
      const targetOrgId = args.assignedOrgId ?? org._id;
      const target = await ctx.db.get(targetOrgId);
      if (!target || target.status !== "verified" || !["red_cross", "blood_bank"].includes(target.type)) {
        throw new Error("Choose a verified Red Cross branch or blood bank to own fulfilment.");
      }
      assignedOrgId = targetOrgId;
    }
    if (status === "rejected" && (!note || note.length < 5)) {
      throw new Error("A rejection reason of at least 5 characters is required.");
    }

    await ctx.db.patch(request._id, {
      status,
      updatedAt: now,
      ...(status === "approved"
        ? { verifiedById: user._id, verifiedAt: now, assignedOrgId }
        : {}),
      ...(status === "rejected" ? { rejectionReason: note, updatedAt: now } : {}),
    });
    await addHistory(ctx, request, status, role, user._id, note);
    if (status === "approved") {
      await notifyCompatibleDonors(ctx, request);
    }

    if (request.createdByUserId) {
      await notifyUser(ctx, request.createdByUserId, {
        title: `Request ${request.requestId} is now ${status.replace("_", " ")}`,
        body:
          status === "rejected"
            ? `Reason: ${note}`
            : `An authorized Red Cross reviewer updated your request. Open it for the full timeline.`,
        kind: "request",
        requestId: request._id,
        link: `/requests/${request._id}`,
      });
    }
    if (assignedOrgId) {
      await notifyOrganization(ctx, assignedOrgId, {
        title: `Request ${request.requestId}: ${status.replace("_", " ")}`,
        body: `${request.bloodGroup} ${request.component.replace("_", " ")} · ${request.units} unit(s) in ${request.city}.`,
        kind: "request",
        requestId: request._id,
        link: `/requests/${request._id}`,
      });
    }
    await audit(ctx, {
      actor: user,
      action: `request.${status}`,
      entityType: "bloodRequest",
      entityId: request.requestId,
      detail: note ?? `Status changed to ${status}.`,
      organizationId: assignedOrgId,
    });
    return { ok: true };
  },
});

export const reserveStock = mutation({
  args: {
    id: v.id("bloodRequests"),
    inventoryId: v.id("inventory"),
    units: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireRedCross(ctx);
    const org = await requireOrganization(ctx, user, ["red_cross", "blood_bank"]);
    const request = await ctx.db.get(args.id);
    if (!request) throw new Error("Request not found.");
    if (!["under_verification", "approved"].includes(request.status)) {
      throw new Error("Stock can only be reserved for a verified or approved request.");
    }
    if (request.assignedOrgId && request.assignedOrgId !== org._id) {
      throw new Error("This request is assigned to another Red Cross branch.");
    }
    const item = await ctx.db.get(args.inventoryId);
    if (!item || item.organizationId !== org._id) {
      throw new Error("That inventory batch does not belong to your organization.");
    }
    if (!item.verified) throw new Error("This batch is not verified and cannot be reserved.");
    if (item.bloodGroup !== request.bloodGroup || item.component !== request.component) {
      throw new Error("The selected batch does not match the requested group and component.");
    }
    const units = requireUnits(args.units);
    if (units > request.units) throw new Error("Cannot reserve more units than requested.");
    const free = item.unitsAvailable - item.unitsReserved;
    if (units > free) {
      throw new Error(`Only ${free} unreserved unit(s) are available in this batch.`);
    }
    const existingReservations = await ctx.db
      .query("inventoryReservations")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect();
    const alreadyReserved = existingReservations
      .filter((r) => r.status === "active")
      .reduce((sum, r) => sum + r.units, 0);
    if (alreadyReserved + units > request.units) {
      throw new Error(
        `This request already has ${alreadyReserved} unit(s) reserved and only needs ${request.units}.`,
      );
    }

    const now = Date.now();
    // Single Convex mutation = serializable transaction: two staff members
    // cannot reserve the same unit concurrently.
    await ctx.db.patch(item._id, {
      unitsReserved: item.unitsReserved + units,
      lastUpdated: now,
    });
    await ctx.db.insert("inventoryTransactions", {
      inventoryId: item._id,
      organizationId: org._id,
      type: "reserve",
      units,
      bloodGroup: item.bloodGroup,
      component: item.component,
      requestId: request._id,
      actorUserId: user._id,
      actorRole: roleOf(user),
      note: `Reserved for ${request.requestId}`,
      createdAt: now,
    });
    await ctx.db.insert("inventoryReservations", {
      inventoryId: item._id,
      organizationId: org._id,
      requestId: request._id,
      units,
      status: "active",
      actorUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });
    // Reserving stock lowers free availability, so re-check the threshold and
    // escalate to donors automatically if the branch is now running low.
    await evaluateStockLevel(ctx, org, item.bloodGroup, item.component);
    await ctx.db.patch(request._id, {
      assignedOrgId: org._id,
      status: request.status === "under_verification" ? "approved" : request.status,
      verifiedById: request.verifiedById ?? user._id,
      verifiedAt: request.verifiedAt ?? now,
      updatedAt: now,
    });
    await addHistory(
      ctx,
      request,
      "approved",
      roleOf(user),
      user._id,
      `${request.status === "under_verification" ? "Verified. " : ""}${units} unit(s) reserved from batch ${item.batchRef} at ${org.name}.`,
    );
    if (request.status === "under_verification") {
      await notifyCompatibleDonors(ctx, request);
    }
    if (request.createdByUserId) {
      await notifyUser(ctx, request.createdByUserId, {
        title: `Stock reserved for ${request.requestId}`,
        body: `${org.name} reserved ${units} unit(s). Final issue still requires medical confirmation.`,
        kind: "request",
        requestId: request._id,
        link: `/requests/${request._id}`,
      });
    }
    await audit(ctx, {
      actor: user,
      action: "inventory.reserved",
      entityType: "bloodRequest",
      entityId: request.requestId,
      detail: `${units} unit(s) of ${item.bloodGroup} ${item.component} reserved from ${item.batchRef}.`,
      organizationId: org._id,
    });
    return { ok: true };
  },
});

/**
 * Release units held for a request so they return to general availability.
 * Only the organization that made the reservation can release it, and only
 * before dispatch.
 */
export const releaseReservation = mutation({
  args: { id: v.id("bloodRequests"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireRedCross(ctx);
    const org = await requireOrganization(ctx, user, ["red_cross", "blood_bank"]);
    const request = await ctx.db.get(args.id);
    if (!request) throw new Error("Request not found.");
    if (!["under_verification", "approved"].includes(request.status)) {
      throw new Error("Reserved stock can only be released before dispatch.");
    }
    if (request.assignedOrgId !== org._id) {
      throw new Error("This request is assigned to another Red Cross branch.");
    }

    const reservations = await ctx.db
      .query("inventoryReservations")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect();
    const active = reservations.filter(
      (r) => r.status === "active" && r.organizationId === org._id,
    );
    if (active.length === 0) {
      throw new Error("This request has no reserved stock to release.");
    }

    const now = Date.now();
    let released = 0;
    for (const reservation of active) {
      const batch = await ctx.db.get(reservation.inventoryId);
      if (!batch || batch.organizationId !== org._id) {
        throw new Error("A reserved inventory batch could not be found.");
      }
      const held = Math.min(batch.unitsReserved, reservation.units);
      await ctx.db.patch(batch._id, {
        unitsReserved: batch.unitsReserved - held,
        lastUpdated: now,
      });
      await ctx.db.insert("inventoryTransactions", {
        inventoryId: batch._id,
        organizationId: org._id,
        type: "release",
        units: held,
        bloodGroup: batch.bloodGroup,
        component: batch.component,
        requestId: request._id,
        actorUserId: user._id,
        actorRole: roleOf(user),
        note: args.note ?? `Reservation released for ${request.requestId}`,
        createdAt: now,
      });
      await ctx.db.patch(reservation._id, { status: "released", units: 0, updatedAt: now });
      released += held;
    }

    await addHistory(
      ctx,
      request,
      "approved",
      roleOf(user),
      user._id,
      args.note ?? `Released ${released} reserved unit(s) back to available stock.`,
    );
    await audit(ctx, {
      actor: user,
      action: "inventory.reservation_released",
      entityType: "bloodRequest",
      entityId: request.requestId,
      detail: `Released ${released} unit(s) reserved for ${request.requestId}.`,
      organizationId: org._id,
    });
    return { released };
  },
});

export const dispatch = mutation({
  args: { id: v.id("bloodRequests"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireRedCross(ctx);
    const org = await requireOrganization(ctx, user, ["red_cross", "blood_bank"]);
    const request = await ctx.db.get(args.id);
    if (!request) throw new Error("Request not found.");
    if (request.status !== "approved") {
      throw new Error("Only approved requests can be dispatched.");
    }
    if (request.assignedOrgId !== org._id) {
      throw new Error("This request is not assigned to your organization.");
    }
    // Consume exactly the units that were reserved against specific batches for
    // this request. This keeps the ledger correct even when a batch is fully
    // reserved by several different requests.
    const reservations = await ctx.db
      .query("inventoryReservations")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .collect();
    const active = reservations
      .filter((r) => r.status === "active" && r.organizationId === org._id)
      .sort((a, b) => a.createdAt - b.createdAt);
    const reservedUnits = active.reduce((sum, r) => sum + r.units, 0);
    if (reservedUnits < request.units) {
      throw new Error(
        `Reserve all ${request.units} unit(s) before dispatching (currently ${reservedUnits}).`,
      );
    }

    let remaining = request.units;
    const now = Date.now();
    const consumed: string[] = [];
    for (const reservation of active) {
      if (remaining <= 0) break;
      const batch = await ctx.db.get(reservation.inventoryId);
      if (!batch || batch.organizationId !== org._id) {
        throw new Error("A reserved inventory batch could not be found.");
      }
      const take = Math.min(reservation.units, remaining);
      if (batch.unitsAvailable < take || batch.unitsReserved < take) {
        throw new Error(
          `Stock for batch ${batch.batchRef} is inconsistent. Refresh inventory before dispatching.`,
        );
      }
      await ctx.db.patch(batch._id, {
        unitsAvailable: batch.unitsAvailable - take,
        unitsReserved: batch.unitsReserved - take,
        lastUpdated: now,
      });
      await ctx.db.insert("inventoryTransactions", {
        inventoryId: batch._id,
        organizationId: org._id,
        type: "dispatch",
        units: take,
        bloodGroup: batch.bloodGroup,
        component: batch.component,
        requestId: request._id,
        actorUserId: user._id,
        actorRole: roleOf(user),
        note: args.note ?? `Dispatched for ${request.requestId}`,
        createdAt: now,
      });
      await ctx.db.patch(reservation._id, {
        units: reservation.units - take,
        status: reservation.units - take === 0 ? "consumed" : "active",
        updatedAt: now,
      });
      consumed.push(`${batch.batchRef} (${take})`);
      remaining -= take;
    }
    if (remaining > 0) {
      throw new Error("Insufficient verified reserved stock to dispatch this request.");
    }

    await ctx.db.patch(request._id, { status: "dispatched", updatedAt: now });
    // Dispatching removes units from the branch ledger; escalate the shortfall
    // automatically (donor alerts only for Red Cross origin stock).
    await evaluateStockLevel(ctx, org, request.bloodGroup, request.component);
    await addHistory(
      ctx,
      request,
      "dispatched",
      roleOf(user),
      user._id,
      args.note ?? `Dispatched ${consumed.join(", ")}.`,
    );
    if (request.createdByUserId) {
      await notifyUser(ctx, request.createdByUserId, {
        title: `Request ${request.requestId} dispatched`,
        body: `${org.name} dispatched the blood components. The hospital must confirm receipt.`,
        kind: "request",
        requestId: request._id,
        link: `/requests/${request._id}`,
      });
    }
    if (request.hospitalOrgId) {
      await notifyOrganization(ctx, request.hospitalOrgId, {
        title: `Incoming blood components for ${request.requestId}`,
        body: `${request.bloodGroup} ${request.component.replace("_", " ")} · ${request.units} unit(s) dispatched by ${org.name}.`,
        kind: "request",
        requestId: request._id,
        link: `/requests/${request._id}`,
      });
    }
    await audit(ctx, {
      actor: user,
      action: "inventory.dispatched",
      entityType: "bloodRequest",
      entityId: request.requestId,
      detail: `Dispatched ${consumed.join(", ")}.`,
      organizationId: org._id,
    });
    return { ok: true };
  },
});

export const createOffer = mutation({
  args: {
    id: v.id("bloodRequests"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) throw new Error("Only registered donors can offer to help.");
    const request = await ctx.db.get(args.id);
    if (!request) throw new Error("Request not found.");
    if (request.createdByUserId === user._id) {
      throw new Error("You cannot offer on your own request.");
    }
    if (!OPEN_REQUEST_STATUSES.has(request.status)) {
      throw new Error("This request is no longer accepting donor offers.");
    }
    const compat = compatibility(donor.bloodGroup, request.bloodGroup, request.component);
    if (!compat.compatible) {
      throw new Error("Your blood group is not compatible with this request.");
    }
    await enforceRateLimit(ctx, `offer:${user._id}`, 12);

    const existing = await ctx.db
      .query("donorOffers")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .filter((q) => q.eq(q.field("donorUserId"), user._id))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "offered",
        note: args.note,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("donorOffers", {
        requestId: request._id,
        donorUserId: user._id,
        donorProfileId: donor._id,
        note: args.note,
        status: "offered",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    if (request.assignedOrgId) {
      await notifyOrganization(ctx, request.assignedOrgId, {
        title: `Donor offer for ${request.requestId}`,
        body: `A compatible ${donor.bloodGroup} donor in ${donor.city} offered to help. Review the offer from the request page.`,
        kind: "match",
        requestId: request._id,
        link: `/requests/${request._id}`,
      });
    } else {
      await notifyRole(ctx, "red_cross", {
        title: `Donor offer for ${request.requestId}`,
        body: `A compatible ${donor.bloodGroup} donor in ${donor.city} offered to help. Assign the request to a branch to coordinate.`,
        kind: "match",
        requestId: request._id,
        link: "/red-cross/dashboard",
      });
    }
    if (request.createdByUserId) {
      await notifyUser(ctx, request.createdByUserId, {
        title: `A donor offered to help with ${request.requestId}`,
        body: "An authorized coordinator will review donor offers. Contact details stay protected.",
        kind: "match",
        requestId: request._id,
        link: `/requests/${request._id}`,
      });
    }
    await audit(ctx, {
      actor: user,
      action: "offer.created",
      entityType: "bloodRequest",
      entityId: request.requestId,
      detail: `Donor ${donor.donorId} offered to help.`,
    });
    return { ok: true };
  },
});

export const withdrawOffer = mutation({
  args: { id: v.id("bloodRequests") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const offer = await ctx.db
      .query("donorOffers")
      .withIndex("by_request", (q) => q.eq("requestId", args.id))
      .filter((q) => q.eq(q.field("donorUserId"), user._id))
      .first();
    if (!offer) throw new Error("You have not offered to help with this request.");
    await ctx.db.patch(offer._id, { status: "withdrawn", updatedAt: Date.now() });
    return { ok: true };
  },
});

export const acceptOffer = mutation({
  args: { id: v.id("bloodRequests"), offerId: v.id("donorOffers") },
  handler: async (ctx, args) => {
    const user = await requireRedCross(ctx);
    const request = await ctx.db.get(args.id);
    if (!request) throw new Error("Request not found.");
    const offer = await ctx.db.get(args.offerId);
    if (!offer || offer.requestId !== request._id) throw new Error("Offer not found.");
    const profile = await ctx.db.get(offer.donorProfileId);
    await ctx.db.patch(offer._id, { status: "accepted", updatedAt: Date.now() });
    await notifyUser(ctx, offer.donorUserId, {
      title: `Your offer was accepted`,
      body: `A coordinator accepted your offer for request ${request.requestId}. They may contact you through the details on your profile.`,
      kind: "match",
      requestId: request._id,
      link: `/requests/${request._id}`,
    });
    await addHistory(
      ctx,
      request,
      request.status,
      roleOf(user),
      user._id,
      `Donor offer accepted (${profile?.bloodGroup ?? "compatible group"}).`,
    );
    await audit(ctx, {
      actor: user,
      action: "offer.accepted",
      entityType: "bloodRequest",
      entityId: request.requestId,
      detail: `Offer from ${profile?.donorId ?? "donor"} accepted.`,
    });
    return { ok: true };
  },
});

export const donorNearby = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) return [];
    const offers = await ctx.db
      .query("donorOffers")
      .withIndex("by_donor", (q) => q.eq("donorUserId", user._id))
      .collect();
    // An active offer unlocks the requestor's basic coordination details.
    const myOffers = new Map(
      offers
        .filter((o) => o.status !== "withdrawn")
        .map((o) => [String(o.requestId), o.status] as const),
    );
    const rows = await ctx.db.query("bloodRequests").collect();
    return rows
      .filter(
        (r) =>
          // Every open request a donor can still help with — including ones
          // still awaiting Red Cross verification. Terminal states (dispatched,
          // received, fulfilled, rejected, cancelled) stay hidden.
          OPEN_REQUEST_STATUSES.has(r.status) &&
          compatibility(donor.bloodGroup, r.bloodGroup, r.component).compatible &&
          // Same blood group rules, same state and country; a different city is
          // only surfaced when the request is an emergency.
          locationRule(donor.city, r.city, r.urgency).ok,
      )
      .sort((a, b) => {
        const scoreA = scoreMatch({
          compatible: true,
          sameCity: a.city === donor.city,
          distanceKm: null,
          urgency: a.urgency,
          verified: a.status === "approved",
        }).score;
        const scoreB = scoreMatch({
          compatible: true,
          sameCity: b.city === donor.city,
          distanceKm: null,
          urgency: b.urgency,
          verified: b.status === "approved",
        }).score;
        return scoreB - scoreA;
      })
      .slice(0, 30)
      .map((r) => {
        const offer = myOffers.get(String(r._id));
        const contactUnlocked = offer != null;
        return {
          ...summaryFields(r),
          requestorName: contactUnlocked ? r.requestorName : "Verified requestor",
          patientRef: "Restricted",
          nearby: r.city === donor.city,
          contactUnlocked,
          myOfferStatus: offer ?? null,
          requesterPhone: contactUnlocked ? r.requesterPhone : null,
          area: contactUnlocked ? r.area ?? null : null,
        };
      });
  },
});
