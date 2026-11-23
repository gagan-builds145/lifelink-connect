import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  audit,
  notifyUser,
  nextSequentialId,
  requireRole,
  requireText,
  requireUser,
  roleOf,
  rolesOf,
} from "./lib/helpers";
import {
  ambulanceBookingStatusValidator,
  ambulanceTypeValidator,
} from "./validators";
import {
  ACTIVE_AMBULANCE_STATUSES,
  AMBULANCE_MAX_REMATCH_ATTEMPTS,
  AMBULANCE_REMATCH_INTERVAL_MS,
  AMBULANCE_SEARCH_WINDOW_MS,
  ambulanceOpenDeadline,
  estimateAmbulanceFare,
  estimateEtaMinutes,
  haversineKm,
  isActiveAmbulanceStatus,
  nextGuardianStatuses,
  type AmbulanceBookingStatus,
} from "../lib/ambulance";
import {
  guardianComplianceIssues,
  isGuardianApproved,
  statusOf,
} from "../lib/guardian";

const BOOKING_ROLES = [
  "community",
  "donor",
  "requestor",
  "hospital",
  "red_cross",
  "admin",
] as const;

const GUARDIAN_ROLES = ["guardian", "admin"] as const;

function validCoordinate(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function bookingSummary(booking: Doc<"ambulanceBookings">) {
  return {
    id: booking._id,
    bookingRef: booking.bookingRef,
    status: booking.status,
    patientName: booking.patientName ?? null,
    pickupLabel: booking.pickupLabel,
    pickupLat: booking.pickupLat,
    pickupLng: booking.pickupLng,
    destinationLabel: booking.destinationLabel,
    destinationLat: booking.destinationLat ?? null,
    destinationLng: booking.destinationLng ?? null,
    ambulanceType: booking.ambulanceType ?? null,
    notes: booking.notes ?? null,
    driverName: booking.driverName ?? null,
    driverPhone: booking.driverPhone ?? null,
    estimatedDistanceKm: booking.estimatedDistanceKm ?? null,
    estimatedEtaMinutes: booking.estimatedEtaMinutes ?? null,
    estimatedFare: booking.estimatedFare ?? null,
    cancellationReason: booking.cancellationReason ?? null,
    searchExpiresAt: booking.searchExpiresAt ?? null,
    rematchAttempts: booking.rematchAttempts ?? 0,
    nextRematchAt: booking.nextRematchAt ?? null,
    rematchExhaustedAt: booking.rematchExhaustedAt ?? null,
    requestedAt: booking.requestedAt,
    acceptedAt: booking.acceptedAt ?? null,
    completedAt: booking.completedAt ?? null,
    cancelledAt: booking.cancelledAt ?? null,
    updatedAt: booking.updatedAt,
  };
}

async function addEvent(
  ctx: Parameters<typeof notifyUser>[0],
  booking: Doc<"ambulanceBookings">,
  status: Doc<"ambulanceBookings">["status"],
  actor: Doc<"users">,
  note: string,
  location?: { lat: number; lng: number },
) {
  await ctx.db.insert("ambulanceBookingEvents", {
    bookingId: booking._id,
    status,
    actorUserId: actor._id,
    actorRole: roleOf(actor),
    note,
    latitude: location?.lat,
    longitude: location?.lng,
    createdAt: Date.now(),
  });
}

type EmergencyCandidate = {
  ambulance: Doc<"ambulances">;
  distanceKm: number;
};

/**
 * Find genuinely dispatchable ambulances for an emergency pickup.
 *
 * A vehicle is excluded when its provider is not approved/online, when it is
 * offline, when it is already assigned to an active booking, or when another
 * open booking has already requested it. The last rule prevents two searching
 * bookings from repeatedly selecting the same vehicle.
 */
async function emergencyCandidates(
  ctx: MutationCtx,
  pickupLat: number,
  pickupLng: number,
  excludeBookingId?: Doc<"ambulanceBookings">["_id"],
): Promise<EmergencyCandidate[]> {
  const [profiles, ambulances, bookings] = await Promise.all([
    ctx.db.query("guardianProfiles").collect(),
    ctx.db.query("ambulances").collect(),
    ctx.db.query("ambulanceBookings").collect(),
  ]);
  const approvedOnline = new Set(
    profiles
      .filter((profile) => profile.online && isGuardianApproved(profile))
      .map((profile) => String(profile.userId)),
  );
  const reserved = new Set<string>();
  for (const booking of bookings) {
    if (
      booking._id === excludeBookingId ||
      !ACTIVE_AMBULANCE_STATUSES.includes(booking.status as AmbulanceBookingStatus)
    ) {
      continue;
    }
    if (booking.assignedAmbulanceId) reserved.add(String(booking.assignedAmbulanceId));
    if (booking.targetAmbulanceId) reserved.add(String(booking.targetAmbulanceId));
  }

  return ambulances
    .filter(
      (ambulance) =>
        ambulance.available &&
        !reserved.has(String(ambulance._id)) &&
        approvedOnline.has(String(ambulance.guardianUserId)) &&
        ambulance.latitude != null &&
        ambulance.longitude != null &&
        validCoordinate(ambulance.latitude, ambulance.longitude),
    )
    .map((ambulance) => ({
      ambulance,
      distanceKm: haversineKm(
        { lat: pickupLat, lng: pickupLng },
        { lat: ambulance.latitude as number, lng: ambulance.longitude as number },
      ),
    }))
    .filter((candidate) => candidate.distanceKm <= 100)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Close an open booking honestly and record why the search ended. */
async function expireOpenBooking(
  ctx: MutationCtx,
  booking: Doc<"ambulanceBookings">,
  now: number,
  reason: string,
  note: string,
) {
  await ctx.db.patch(booking._id, {
    status: "expired",
    cancellationReason: reason,
    rematchExhaustedAt: now,
    nextRematchAt: undefined,
    cancelledAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("ambulanceBookingEvents", {
    bookingId: booking._id,
    status: "expired",
    actorUserId: booking.requesterUserId,
    actorRole: "system",
    note,
    createdAt: now,
  });
  await notifyUser(ctx, booking.requesterUserId, {
    title: "No ambulance confirmed",
    body: `${booking.bookingRef}: ${reason} Call your local emergency service if this is still urgent.`,
    kind: "ambulance",
    link: "/ambulance?auto=1",
  });
}

export const registerGuardian = mutation({
  args: {
    companyName: v.string(),
    contactPerson: v.string(),
    phone: v.string(),
    city: v.string(),
    address: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (["admin", "red_cross", "hospital", "drone_ops"].includes(user.role ?? "user")) {
      throw new Error("Staff accounts cannot register as ambulance Guardians.");
    }
    const existing = await ctx.db
      .query("guardianProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (existing) throw new Error("A Guardian profile already exists for this account.");

    const now = Date.now();
    const profileId = await ctx.db.insert("guardianProfiles", {
      userId: user._id,
      companyName: requireText(args.companyName, "Ambulance service name", 2, 120),
      contactPerson: requireText(args.contactPerson, "Contact person", 2, 120),
      phone: requireText(args.phone, "Phone", 7, 20),
      city: requireText(args.city, "City", 2, 80),
      address: requireText(args.address, "Address", 5, 300),
      online: false,
      documentsStatus: "pending",
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
    });
    const roles = rolesOf(user);
    if (!roles.includes("guardian")) roles.push("guardian");
    await ctx.db.patch(user._id, {
      // Existing donor/requestor workspaces stay usable; Guardian is added.
      roles,
      role:
        user.role === "user" || user.role === "member" || !user.role ? "guardian" : user.role,
      profileCompleted: true,
    });
    await audit(ctx, {
      actor: user,
      action: "guardian.registered",
      entityType: "guardianProfile",
      entityId: String(profileId),
      detail: `Guardian ambulance provider registered in ${args.city}.`,
    });
    return { profileId };
  },
});

export const setGuardianOnline = mutation({
  args: { online: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [...GUARDIAN_ROLES]);
    const profile = await ctx.db
      .query("guardianProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile) throw new Error("Guardian profile not found.");
    if (args.online && !profile.status) {
      // Legacy profile: keep the Phase 2 contract (administrator verified the
      // documents). It is not forced through the new Phase 3 checklist, but a
      // rejected legacy profile still cannot go online.
      if (profile.documentsStatus !== "verified") {
        throw new Error("Your Guardian documents are not verified yet.");
      }
    }
    if (args.online && profile.status) {
      const vehicles = await ctx.db
        .query("ambulances")
        .withIndex("by_guardian", (q) => q.eq("guardianUserId", user._id))
        .collect();
      const documents = await ctx.db
        .query("documentMetadata")
        .withIndex("by_guardian", (q) => q.eq("guardianUserId", user._id))
        .collect();
      const issues = guardianComplianceIssues({
        profile,
        vehicles: vehicles.map((vehicle) => ({
          id: String(vehicle._id),
          type: vehicle.type,
          insuranceExpiryDate: vehicle.insuranceExpiryDate,
          fitnessExpiryDate: vehicle.fitnessExpiryDate,
          pucExpiryDate: vehicle.pucExpiryDate,
          permitExpiryDate: vehicle.permitExpiryDate,
          ambulanceAuthorizationExpiryDate: vehicle.ambulanceAuthorizationExpiryDate,
        })),
        documents: documents.map((doc) => ({
          documentKind: doc.documentKind,
          expiryDate: doc.expiryDate,
          status: doc.status,
          ambulanceId: doc.ambulanceId ? String(doc.ambulanceId) : null,
        })),
      });
      if (issues.length > 0) {
        throw new Error(`Cannot go online yet: ${issues.slice(0, 3).join(" ")}`);
      }
    }
    await ctx.db.patch(profile._id, {
      online: args.online,
      updatedAt: Date.now(),
    });
    return { online: args.online };
  },
});

export const upsertAmbulance = mutation({
  args: {
    ambulanceId: v.optional(v.id("ambulances")),
    registrationNumber: v.string(),
    model: v.string(),
    type: ambulanceTypeValidator,
    capacity: v.number(),
    driverName: v.string(),
    driverPhone: v.string(),
    driverLicenseRef: v.optional(v.string()),
    documentRef: v.optional(v.string()),
    documentId: v.optional(v.id("documentMetadata")),
    make: v.optional(v.string()),
    manufacturingYear: v.optional(v.number()),
    colour: v.optional(v.string()),
    vehicleType: v.optional(v.string()),
    frontPhotoDocumentId: v.optional(v.id("documentMetadata")),
    rearPhotoDocumentId: v.optional(v.id("documentMetadata")),
    sidePhotoDocumentId: v.optional(v.id("documentMetadata")),
    insuranceExpiryDate: v.optional(v.string()),
    fitnessExpiryDate: v.optional(v.string()),
    pucExpiryDate: v.optional(v.string()),
    permitExpiryDate: v.optional(v.string()),
    ambulanceAuthorizationExpiryDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["guardian"]);
    const profile = await ctx.db
      .query("guardianProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!profile) throw new Error("Complete your Guardian registration first.");

    const registrationNumber = requireText(
      args.registrationNumber,
      "Registration number",
      3,
      30,
    ).toUpperCase();
    if (args.capacity < 1 || args.capacity > 20) {
      throw new Error("Capacity must be between 1 and 20.");
    }
    const all = await ctx.db.query("ambulances").collect();
    const duplicate = all.find(
      (vehicle) =>
        vehicle.registrationNumber === registrationNumber &&
        vehicle._id !== args.ambulanceId,
    );
    if (duplicate) throw new Error("That ambulance registration number is already registered.");

    const documentIds = [
      args.documentId,
      args.frontPhotoDocumentId,
      args.rearPhotoDocumentId,
      args.sidePhotoDocumentId,
    ];
    for (const documentId of documentIds) {
      if (!documentId) continue;
      const document = await ctx.db.get(documentId);
      if (!document || document.uploadedByUserId !== user._id) {
        throw new Error("That vehicle document does not belong to your account.");
      }
    }
    const normalizedExpiry = (value: string | undefined, label: string) => {
      if (!value) return undefined;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new Error(`${label} is not a valid date.`);
      return date.toISOString().slice(0, 10);
    };
    const year = args.manufacturingYear != null ? Math.round(args.manufacturingYear) : undefined;
    if (year != null && (year < 1980 || year > new Date().getFullYear() + 1)) {
      throw new Error("Enter a valid manufacturing year.");
    }

    const now = Date.now();
    const fields = {
      registrationNumber,
      model: requireText(args.model, "Vehicle model", 2, 80),
      type: args.type,
      capacity: Math.round(args.capacity),
      driverName: requireText(args.driverName, "Driver name", 2, 120),
      driverPhone: requireText(args.driverPhone, "Driver phone", 7, 20),
      driverLicenseRef: args.driverLicenseRef
        ? requireText(args.driverLicenseRef, "Driver licence reference", 2, 120)
        : undefined,
      documentRef: args.documentRef
        ? requireText(args.documentRef, "Document reference", 2, 200)
        : undefined,
      documentId: args.documentId,
      make: args.make ? requireText(args.make, "Vehicle make", 2, 80) : undefined,
      manufacturingYear: year,
      colour: args.colour ? requireText(args.colour, "Vehicle colour", 2, 40) : undefined,
      vehicleType: args.vehicleType
        ? requireText(args.vehicleType, "Vehicle type", 2, 60)
        : undefined,
      frontPhotoDocumentId: args.frontPhotoDocumentId,
      rearPhotoDocumentId: args.rearPhotoDocumentId,
      sidePhotoDocumentId: args.sidePhotoDocumentId,
      insuranceExpiryDate: normalizedExpiry(args.insuranceExpiryDate, "Insurance expiry"),
      fitnessExpiryDate: normalizedExpiry(args.fitnessExpiryDate, "Fitness certificate expiry"),
      pucExpiryDate: normalizedExpiry(args.pucExpiryDate, "PUC expiry"),
      permitExpiryDate: normalizedExpiry(args.permitExpiryDate, "Permit expiry"),
      ambulanceAuthorizationExpiryDate: normalizedExpiry(
        args.ambulanceAuthorizationExpiryDate,
        "Ambulance authorization expiry",
      ),
      updatedAt: now,
    };

    if (args.ambulanceId) {
      const existing = await ctx.db.get(args.ambulanceId);
      if (!existing || existing.guardianUserId !== user._id) {
        throw new Error("You can only update your own ambulance.");
      }
      await ctx.db.patch(existing._id, fields);
      return { ambulanceId: existing._id };
    }

    const ambulanceId = await ctx.db.insert("ambulances", {
      guardianUserId: user._id,
      ...fields,
      available: true,
      createdAt: now,
    });
    await audit(ctx, {
      actor: user,
      action: "ambulance.created",
      entityType: "ambulance",
      entityId: String(ambulanceId),
      detail: `Ambulance ${registrationNumber} registered by ${profile.companyName}.`,
    });
    return { ambulanceId };
  },
});

export const setAmbulanceAvailability = mutation({
  args: {
    ambulanceId: v.id("ambulances"),
    available: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["guardian"]);
    const ambulance = await ctx.db.get(args.ambulanceId);
    if (!ambulance || ambulance.guardianUserId !== user._id) {
      throw new Error("You can only change your own ambulance.");
    }
    await ctx.db.patch(ambulance._id, {
      available: args.available,
      updatedAt: Date.now(),
    });
    return { available: args.available };
  },
});

export const nearby = query({
  args: {
    pickupLat: v.number(),
    pickupLng: v.number(),
    type: v.optional(ambulanceTypeValidator),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, [...BOOKING_ROLES]);
    if (!validCoordinate(args.pickupLat, args.pickupLng)) {
      throw new Error("Invalid pickup coordinates.");
    }
    const onlineGuardians = await ctx.db.query("guardianProfiles").collect();
    const onlineIds = new Set(
      onlineGuardians
        .filter((profile) => profile.online && isGuardianApproved(profile))
        .map((profile) => String(profile.userId)),
    );

    const ambulances = await ctx.db.query("ambulances").collect();
    const activeBookings = await ctx.db.query("ambulanceBookings").collect();
    const busy = new Set(
      activeBookings
        .filter(
          (booking) =>
            booking.assignedAmbulanceId != null &&
            ACTIVE_AMBULANCE_STATUSES.includes(
              booking.status as AmbulanceBookingStatus,
            ),
        )
        .map((booking) => String(booking.assignedAmbulanceId)),
    );

    return ambulances
      .filter(
        (ambulance) =>
          ambulance.available &&
          !busy.has(String(ambulance._id)) &&
          onlineIds.has(String(ambulance.guardianUserId)) &&
          ambulance.latitude != null &&
          ambulance.longitude != null &&
          validCoordinate(ambulance.latitude, ambulance.longitude) &&
          (args.type ? ambulance.type === args.type : true),
      )
      .map((ambulance) => {
        const distanceKm = haversineKm(
          { lat: args.pickupLat, lng: args.pickupLng },
          { lat: ambulance.latitude as number, lng: ambulance.longitude as number },
        );
        return {
          id: ambulance._id,
          registrationNumber: ambulance.registrationNumber,
          model: ambulance.model,
          type: ambulance.type,
          capacity: ambulance.capacity,
          latitude: ambulance.latitude as number,
          longitude: ambulance.longitude as number,
          distanceKm: Math.round(distanceKm * 10) / 10,
          etaMinutes: estimateEtaMinutes(distanceKm),
          estimatedFare: estimateAmbulanceFare(distanceKm),
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 12);
  },
});

export const createBooking = mutation({
  args: {
    ambulanceId: v.id("ambulances"),
    pickupLabel: v.string(),
    pickupLat: v.number(),
    pickupLng: v.number(),
    destinationLabel: v.string(),
    destinationLat: v.optional(v.number()),
    destinationLng: v.optional(v.number()),
    ambulanceType: v.optional(ambulanceTypeValidator),
    patientName: v.optional(v.string()),
    notes: v.optional(v.string()),
    clientRequestId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [...BOOKING_ROLES]);
    const clientRequestId = requireText(args.clientRequestId, "Request id", 8, 120);
    const existing = await ctx.db
      .query("ambulanceBookings")
      .withIndex("by_client_request", (q) => q.eq("clientRequestId", clientRequestId))
      .first();
    if (existing) {
      if (existing.requesterUserId !== user._id) {
        throw new Error("That request id belongs to another account.");
      }
      return { bookingId: existing._id, bookingRef: existing.bookingRef, reused: true };
    }

    if (!validCoordinate(args.pickupLat, args.pickupLng)) {
      throw new Error("Invalid pickup coordinates.");
    }
    if (
      args.destinationLat != null &&
      args.destinationLng != null &&
      !validCoordinate(args.destinationLat, args.destinationLng)
    ) {
      throw new Error("Invalid destination coordinates.");
    }
    if (args.notes && args.notes.length > 500) {
      throw new Error("Notes must be 500 characters or fewer.");
    }

    const active = await ctx.db
      .query("ambulanceBookings")
      .withIndex("by_requester", (q) => q.eq("requesterUserId", user._id))
      .collect();
    if (active.some((booking) => isActiveAmbulanceStatus(booking.status))) {
      throw new Error(
        "You already have an active ambulance booking. Track or cancel it before booking another.",
      );
    }

    const ambulance = await ctx.db.get(args.ambulanceId);
    if (!ambulance) throw new Error("That ambulance is no longer available.");
    if (!ambulance.available) throw new Error("That ambulance is currently unavailable.");
    if (ambulance.latitude == null || ambulance.longitude == null) {
      throw new Error("That ambulance has no verified location yet.");
    }
    if (!validCoordinate(ambulance.latitude, ambulance.longitude)) {
      throw new Error("That ambulance has an invalid location.");
    }
    if (args.ambulanceType && ambulance.type !== args.ambulanceType) {
      throw new Error("The selected vehicle does not match the requested ambulance type.");
    }
    const guardian = await ctx.db.get(ambulance.guardianUserId);
    if (!guardian) throw new Error("The ambulance provider account is unavailable.");
    const guardianProfile = await ctx.db
      .query("guardianProfiles")
      .withIndex("by_user", (q) => q.eq("userId", ambulance.guardianUserId))
      .unique();
    if (!guardianProfile || !isGuardianApproved(guardianProfile)) {
      throw new Error("That ambulance provider is not approved for bookings yet.");
    }
    if (!guardianProfile.online) throw new Error("That ambulance provider is currently offline.");

    const pickupToAmbulance = haversineKm(
      { lat: args.pickupLat, lng: args.pickupLng },
      { lat: ambulance.latitude, lng: ambulance.longitude },
    );
    const tripKm =
      args.destinationLat != null && args.destinationLng != null
        ? haversineKm(
            { lat: args.pickupLat, lng: args.pickupLng },
            { lat: args.destinationLat, lng: args.destinationLng },
          )
        : null;

    const now = Date.now();
    const bookingRef = await nextSequentialId(ctx, "ambulance_booking", "AMB", 5);
    const bookingId = await ctx.db.insert("ambulanceBookings", {
      bookingRef,
      requesterUserId: user._id,
      requesterRole: roleOf(user),
      patientName: args.patientName?.trim() || undefined,
      pickupLabel: requireText(args.pickupLabel, "Pickup location", 2, 200),
      pickupLat: args.pickupLat,
      pickupLng: args.pickupLng,
      destinationLabel: requireText(args.destinationLabel, "Destination", 2, 200),
      destinationLat: args.destinationLat,
      destinationLng: args.destinationLng,
      ambulanceType: args.ambulanceType ?? ambulance.type,
      notes: args.notes?.trim() || undefined,
      status: "requested",
      targetAmbulanceId: ambulance._id,
      estimatedDistanceKm:
        tripKm != null ? Math.round(tripKm * 10) / 10 : undefined,
      estimatedEtaMinutes: estimateEtaMinutes(pickupToAmbulance),
      estimatedFare: estimateAmbulanceFare(tripKm ?? 0),
      clientRequestId,
      requestedAt: now,
      updatedAt: now,
    });
    const booking = (await ctx.db.get(bookingId))!;
    await addEvent(ctx, booking, "requested", user, "Ambulance booking requested.");
    await notifyUser(ctx, ambulance.guardianUserId, {
      title: "New ambulance request",
      body: `${bookingRef}: pickup at ${booking.pickupLabel}.`,
      kind: "ambulance",
      link: "/guardian/dashboard",
    });
    return { bookingId, bookingRef, reused: false };
  },
});

/**
 * One-tap emergency booking.
 *
 * The donor has only supplied live GPS coordinates. The server finds a
 * genuinely available, approved, online ambulance; if none exists the booking
 * is still created in `searching` so the request is not lost, and the UI shows
 * an honest pending state. No hospital, patient or destination is invented.
 * Destination coordination is left to the assigned provider.
 */
export const createEmergencyBooking = mutation({
  args: {
    pickupLat: v.number(),
    pickupLng: v.number(),
    clientRequestId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, [...BOOKING_ROLES]);
    const clientRequestId = requireText(args.clientRequestId, "Request id", 8, 120);
    const existing = await ctx.db
      .query("ambulanceBookings")
      .withIndex("by_client_request", (q) => q.eq("clientRequestId", clientRequestId))
      .first();
    if (existing) {
      if (existing.requesterUserId !== user._id) {
        throw new Error("That request id belongs to another account.");
      }
      return {
        bookingId: existing._id,
        bookingRef: existing.bookingRef,
        reused: true,
        assigned: existing.targetAmbulanceId != null,
        status: existing.status,
      };
    }

    if (!validCoordinate(args.pickupLat, args.pickupLng)) {
      throw new Error("A valid live GPS location is required to request an ambulance.");
    }

    const active = await ctx.db
      .query("ambulanceBookings")
      .withIndex("by_requester", (q) => q.eq("requesterUserId", user._id))
      .collect();
    const current = active.find((booking) => isActiveAmbulanceStatus(booking.status));
    if (current) {
      return {
        bookingId: current._id,
        bookingRef: current.bookingRef,
        reused: true,
        assigned: current.targetAmbulanceId != null,
        status: current.status,
        existingActive: true,
      };
    }

    const candidates = await emergencyCandidates(ctx, args.pickupLat, args.pickupLng);
    const selected = candidates[0];
    const now = Date.now();
    const bookingRef = await nextSequentialId(ctx, "ambulance_booking", "AMB", 5);
    const bookingId = await ctx.db.insert("ambulanceBookings", {
      bookingRef,
      requesterUserId: user._id,
      requesterRole: roleOf(user),
      pickupLabel: "Current GPS location",
      pickupLat: args.pickupLat,
      pickupLng: args.pickupLng,
      destinationLabel: "Destination to be coordinated by the assigned ambulance provider",
      status: selected ? "requested" : "searching",
      targetAmbulanceId: selected?.ambulance._id,
      ambulanceType: selected?.ambulance.type,
      estimatedEtaMinutes: selected ? estimateEtaMinutes(selected.distanceKm) : undefined,
      searchExpiresAt: selected ? undefined : now + AMBULANCE_SEARCH_WINDOW_MS,
      rematchAttempts: selected ? undefined : 0,
      nextRematchAt: selected ? undefined : now + AMBULANCE_REMATCH_INTERVAL_MS,
      clientRequestId,
      requestedAt: now,
      updatedAt: now,
    });
    const booking = (await ctx.db.get(bookingId))!;
    await addEvent(
      ctx,
      booking,
      selected ? "requested" : "searching",
      user,
      selected
        ? "Emergency request created from live GPS. Searching for the selected provider."
        : "Emergency request created from live GPS. No approved ambulance is currently available.",
    );
    if (selected) {
      await notifyUser(ctx, selected.ambulance.guardianUserId, {
        title: "Emergency ambulance request",
        body: `${bookingRef}: live GPS pickup ${selected.distanceKm.toFixed(1)} km away.`,
        kind: "ambulance",
        link: "/guardian/dashboard",
      });
    }
    return {
      bookingId,
      bookingRef,
      reused: false,
      assigned: selected != null,
      status: booking.status,
      distanceKm: selected ? Math.round(selected.distanceKm * 10) / 10 : null,
    };
  },
});

export const acceptBooking = mutation({
  args: { bookingId: v.id("ambulanceBookings") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["guardian"]);
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error("Booking not found.");
    if (booking.status !== "requested" && booking.status !== "searching") {
      throw new Error("This booking is no longer open for acceptance.");
    }
    if (!booking.targetAmbulanceId) throw new Error("This booking has no target ambulance.");
    const ambulance = await ctx.db.get(booking.targetAmbulanceId);
    if (!ambulance || ambulance.guardianUserId !== user._id) {
      throw new Error("This request is not assigned to your ambulance.");
    }
    if (!ambulance.available) throw new Error("That ambulance is currently unavailable.");
    const guardianProfile = await ctx.db
      .query("guardianProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!guardianProfile || !isGuardianApproved(guardianProfile)) {
      throw new Error("Your Guardian application must be approved before accepting bookings.");
    }

    const all = await ctx.db.query("ambulanceBookings").collect();
    const conflict = all.find(
      (other) =>
        other._id !== booking._id &&
        other.assignedAmbulanceId === ambulance._id &&
        ACTIVE_AMBULANCE_STATUSES.includes(other.status as AmbulanceBookingStatus),
    );
    if (conflict) {
      throw new Error("That ambulance is already assigned to another active booking.");
    }

    const now = Date.now();
    await ctx.db.patch(booking._id, {
      status: "guardian_assigned",
      assignedAmbulanceId: ambulance._id,
      assignedGuardianUserId: user._id,
      driverName: ambulance.driverName,
      driverPhone: ambulance.driverPhone,
      acceptedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(ambulance._id, { available: false, updatedAt: now });
    const accepted = (await ctx.db.get(booking._id))!;
    await addEvent(ctx, accepted, "accepted", user, "Guardian accepted the request.");
    await addEvent(
      ctx,
      accepted,
      "guardian_assigned",
      user,
      `Guardian assigned ${ambulance.driverName} with ${ambulance.registrationNumber}.`,
    );
    await notifyUser(ctx, booking.requesterUserId, {
      title: "Ambulance accepted",
      body: `${booking.bookingRef}: ${ambulance.driverName} is assigned. Driver contact ${ambulance.driverPhone}.`,
      kind: "ambulance",
      link: "/ambulance",
    });

    // Other requesters may have targeted the same vehicle before it was
    // accepted. Close those requests explicitly instead of leaving them open.
    for (const other of all) {
      if (
        other._id === booking._id ||
        other.targetAmbulanceId !== ambulance._id ||
        !["requested", "searching"].includes(other.status)
      ) {
        continue;
      }
      await ctx.db.patch(other._id, {
        status: "cancelled",
        cancellationReason:
          "Another ambulance request for this vehicle was accepted first.",
        cancelledAt: now,
        updatedAt: now,
      });
      await addEvent(
        ctx,
        (await ctx.db.get(other._id))!,
        "cancelled",
        user,
        "Another request for this ambulance was accepted first.",
      );
      await notifyUser(ctx, other.requesterUserId, {
        title: "Ambulance request closed",
        body: `${other.bookingRef}: another request for this vehicle was accepted first. Please choose another available ambulance.`,
        kind: "ambulance",
        link: "/ambulance",
      });
    }
    return { ok: true };
  },
});

export const rejectBooking = mutation({
  args: { bookingId: v.id("ambulanceBookings"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["guardian"]);
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error("Booking not found.");
    if (!["requested", "searching"].includes(booking.status)) {
      throw new Error("Only open requests can be declined.");
    }
    if (!booking.targetAmbulanceId) throw new Error("This request has no target ambulance.");
    const ambulance = await ctx.db.get(booking.targetAmbulanceId);
    if (!ambulance || ambulance.guardianUserId !== user._id) {
      throw new Error("This request is not assigned to your ambulance.");
    }
    const now = Date.now();
    const reason = args.reason?.trim().slice(0, 300) || "Declined by the ambulance provider.";
    await ctx.db.patch(booking._id, {
      status: "rejected",
      cancellationReason: reason,
      cancelledAt: now,
      updatedAt: now,
    });
    await addEvent(ctx, (await ctx.db.get(booking._id))!, "rejected", user, reason);
    await notifyUser(ctx, booking.requesterUserId, {
      title: "Ambulance request declined",
      body: `${booking.bookingRef}: ${reason}`,
      kind: "ambulance",
      link: "/ambulance",
    });
    return { ok: true };
  },
});

export const updateBookingStatus = mutation({
  args: {
    bookingId: v.id("ambulanceBookings"),
    status: ambulanceBookingStatusValidator,
    note: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["guardian"]);
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error("Booking not found.");
    if (booking.assignedGuardianUserId !== user._id) {
      throw new Error("Only the assigned Guardian can update this booking.");
    }
    const allowed = nextGuardianStatuses(
      booking.status as AmbulanceBookingStatus,
    );
    if (!allowed.includes(args.status as AmbulanceBookingStatus)) {
      throw new Error(
        `Cannot move booking from ${booking.status} to ${args.status}.`,
      );
    }
    if (
      args.latitude != null &&
      args.longitude != null &&
      !validCoordinate(args.latitude, args.longitude)
    ) {
      throw new Error("Invalid location coordinates.");
    }
    const now = Date.now();
    await ctx.db.patch(booking._id, {
      status: args.status,
      updatedAt: now,
      completedAt: args.status === "completed" ? now : booking.completedAt,
      cancelledAt: args.status === "cancelled" ? now : booking.cancelledAt,
      cancellationReason:
        args.status === "cancelled"
          ? args.note?.trim().slice(0, 300) || "Cancelled by the ambulance provider."
          : booking.cancellationReason,
    });
    if (args.latitude != null && args.longitude != null) {
      if (booking.assignedAmbulanceId) {
        await ctx.db.patch(booking.assignedAmbulanceId, {
          latitude: args.latitude,
          longitude: args.longitude,
          lastLocationAt: now,
          updatedAt: now,
        });
      }
    }
    const updated = (await ctx.db.get(booking._id))!;
    await addEvent(
      ctx,
      updated,
      args.status,
      user,
      args.note?.trim().slice(0, 300) || `Status updated to ${args.status}.`,
      args.latitude != null && args.longitude != null
        ? { lat: args.latitude, lng: args.longitude }
        : undefined,
    );
    if (args.status === "completed" || args.status === "cancelled") {
      if (booking.assignedAmbulanceId) {
        await ctx.db.patch(booking.assignedAmbulanceId, {
          available: true,
          updatedAt: now,
        });
      }
    }
    await notifyUser(ctx, booking.requesterUserId, {
      title:
        args.status === "completed"
          ? "Ambulance journey completed"
          : args.status === "cancelled"
            ? "Ambulance journey cancelled"
            : "Ambulance status updated",
      body: `${booking.bookingRef}: ${args.note?.trim() || args.status.replace(/_/g, " ")}`,
      kind: "ambulance",
      link: "/ambulance",
    });
    return { ok: true };
  },
});

export const cancelBooking = mutation({
  args: {
    bookingId: v.id("ambulanceBookings"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) throw new Error("Booking not found.");
    const isRequester = booking.requesterUserId === user._id;
    const isGuardian = booking.assignedGuardianUserId === user._id;
    let isTargetGuardian = false;
    if (!isRequester && !isGuardian && booking.targetAmbulanceId) {
      const target = await ctx.db.get(booking.targetAmbulanceId);
      isTargetGuardian = target?.guardianUserId === user._id;
    }
    if (!isRequester && !isGuardian && !isTargetGuardian) {
      throw new Error("You cannot cancel this booking.");
    }
    if (!isActiveAmbulanceStatus(booking.status)) {
      throw new Error("This booking is already closed.");
    }
    const reason =
      args.reason?.trim().slice(0, 300) ||
      (isRequester ? "Cancelled by the requester." : "Cancelled by the ambulance provider.");
    const now = Date.now();
    await ctx.db.patch(booking._id, {
      status: "cancelled",
      cancellationReason: reason,
      cancelledAt: now,
      updatedAt: now,
    });
    if (booking.assignedAmbulanceId) {
      await ctx.db.patch(booking.assignedAmbulanceId, {
        available: true,
        updatedAt: now,
      });
    }
    await addEvent(ctx, (await ctx.db.get(booking._id))!, "cancelled", user, reason);
    if (isRequester && booking.targetAmbulanceId && !booking.assignedGuardianUserId) {
      const target = await ctx.db.get(booking.targetAmbulanceId);
      if (target) {
        await notifyUser(ctx, target.guardianUserId, {
          title: "Ambulance request cancelled",
          body: `${booking.bookingRef}: ${reason}`,
          kind: "ambulance",
          link: "/guardian/dashboard",
        });
      }
    }
    if (!isRequester) {
      await notifyUser(ctx, booking.requesterUserId, {
        title: "Ambulance booking cancelled",
        body: `${booking.bookingRef}: ${reason}`,
        kind: "ambulance",
        link: "/ambulance",
      });
    }
    return { ok: true };
  },
});

export const shareLocation = mutation({
  args: {
    bookingId: v.id("ambulanceBookings"),
    latitude: v.number(),
    longitude: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["guardian"]);
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || booking.assignedGuardianUserId !== user._id) {
      throw new Error("Only the assigned Guardian can share live location.");
    }
    if (!isActiveAmbulanceStatus(booking.status)) {
      throw new Error("Location sharing is only available during an active booking.");
    }
    if (!validCoordinate(args.latitude, args.longitude)) {
      throw new Error("Invalid GPS coordinates.");
    }
    if (!booking.assignedAmbulanceId) throw new Error("No ambulance is assigned.");
    const now = Date.now();
    await ctx.db.patch(booking.assignedAmbulanceId, {
      latitude: args.latitude,
      longitude: args.longitude,
      lastLocationAt: now,
      updatedAt: now,
    });
    await addEvent(
      ctx,
      booking,
      booking.status,
      user,
      "Live ambulance location updated.",
      { lat: args.latitude, lng: args.longitude },
    );
    return { ok: true, at: now };
  },
});

export const myBookings = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, [...BOOKING_ROLES]);
    const bookings = await ctx.db
      .query("ambulanceBookings")
      .withIndex("by_requester", (q) => q.eq("requesterUserId", user._id))
      .collect();
    return bookings
      .sort((a, b) => b.requestedAt - a.requestedAt)
      .slice(0, 50)
      .map(bookingSummary);
  },
});

export const bookingDetail = query({
  args: { bookingId: v.id("ambulanceBookings") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const booking = await ctx.db.get(args.bookingId);
    if (!booking) return null;

    let guardianUserId = booking.assignedGuardianUserId ?? null;
    let ambulance: Doc<"ambulances"> | null = null;
    if (booking.assignedAmbulanceId) {
      ambulance = await ctx.db.get(booking.assignedAmbulanceId);
    } else if (booking.targetAmbulanceId) {
      ambulance = await ctx.db.get(booking.targetAmbulanceId);
    }
    if (!guardianUserId && ambulance) guardianUserId = ambulance.guardianUserId;
    const authorized =
      booking.requesterUserId === user._id ||
      guardianUserId === user._id ||
      user.role === "admin";
    if (!authorized) return null;

    const events = await ctx.db
      .query("ambulanceBookingEvents")
      .withIndex("by_booking", (q) => q.eq("bookingId", booking._id))
      .collect();
    const assigned = booking.assignedAmbulanceId != null;
    return {
      ...bookingSummary(booking),
      requesterRole: booking.requesterRole,
      targetAmbulanceId: booking.targetAmbulanceId ?? null,
      assignedAmbulanceId: booking.assignedAmbulanceId ?? null,
      assignedGuardianUserId: booking.assignedGuardianUserId ?? null,
      ambulance: ambulance
        ? {
            id: ambulance._id,
            registrationNumber: ambulance.registrationNumber,
            model: ambulance.model,
            type: ambulance.type,
            capacity: ambulance.capacity,
            latitude: ambulance.latitude ?? null,
            longitude: ambulance.longitude ?? null,
            lastLocationAt: ambulance.lastLocationAt ?? null,
            driverName: assigned ? ambulance.driverName : null,
            driverPhone: assigned ? ambulance.driverPhone : null,
            documentsStatus: null,
          }
        : null,
      events: events
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((event) => ({
          id: event._id,
          status: event.status,
          note: event.note,
          actorRole: event.actorRole,
          latitude: event.latitude ?? null,
          longitude: event.longitude ?? null,
          createdAt: event.createdAt,
        })),
    };
  },
});

export const guardianOverview = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ["guardian"]);
    const profile = await ctx.db
      .query("guardianProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    const ambulances = await ctx.db
      .query("ambulances")
      .withIndex("by_guardian", (q) => q.eq("guardianUserId", user._id))
      .collect();
    const documents = await ctx.db
      .query("documentMetadata")
      .withIndex("by_guardian", (q) => q.eq("guardianUserId", user._id))
      .collect();
    const issues = profile?.status
      ? guardianComplianceIssues({
          profile,
          vehicles: ambulances.map((vehicle) => ({
            id: String(vehicle._id),
            type: vehicle.type,
            insuranceExpiryDate: vehicle.insuranceExpiryDate,
            fitnessExpiryDate: vehicle.fitnessExpiryDate,
            pucExpiryDate: vehicle.pucExpiryDate,
            permitExpiryDate: vehicle.permitExpiryDate,
            ambulanceAuthorizationExpiryDate: vehicle.ambulanceAuthorizationExpiryDate,
          })),
          documents: documents.map((doc) => ({
            documentKind: doc.documentKind,
            expiryDate: doc.expiryDate,
            status: doc.status,
            ambulanceId: doc.ambulanceId ? String(doc.ambulanceId) : null,
          })),
        })
      : [];
    const ownIds = new Set(ambulances.map((ambulance) => String(ambulance._id)));
    const all = await ctx.db.query("ambulanceBookings").collect();
    const incoming = all.filter(
      (booking) =>
        booking.targetAmbulanceId != null &&
        ownIds.has(String(booking.targetAmbulanceId)) &&
        !booking.assignedGuardianUserId &&
        ["requested", "searching"].includes(booking.status),
    );
    const mine = all.filter(
      (booking) => booking.assignedGuardianUserId === user._id,
    );
    return {
      profile: profile
        ? {
            companyName: profile.companyName,
            contactPerson: profile.contactPerson,
            phone: profile.phone,
            email: profile.email ?? null,
            city: profile.city,
            address: profile.address,
            online: profile.online,
            documentsStatus: profile.documentsStatus,
            status: statusOf(profile),
            approved: isGuardianApproved(profile),
            linkedDonorId: profile.linkedDonorId ?? null,
            submittedAt: profile.submittedAt ?? null,
            reviewedAt: profile.reviewedAt ?? null,
            reviewNote: profile.reviewNote ?? null,
            driver: profile.driver ?? null,
            service: profile.service ?? null,
          }
        : null,
      issues,
      documents: documents.map((doc) => ({
        id: doc._id,
        kind: doc.documentKind ?? null,
        fileName: doc.fileName,
        expiryDate: doc.expiryDate ?? null,
        status: doc.status ?? "pending",
        reviewNote: doc.reviewNote ?? null,
        ambulanceId: doc.ambulanceId ?? null,
      })),
      ambulances: ambulances.map((ambulance) => ({
        id: ambulance._id,
        registrationNumber: ambulance.registrationNumber,
        model: ambulance.model,
        type: ambulance.type,
        capacity: ambulance.capacity,
        driverName: ambulance.driverName,
        driverPhone: ambulance.driverPhone,
        driverLicenseRef: ambulance.driverLicenseRef ?? null,
        documentRef: ambulance.documentRef ?? null,
        documentId: ambulance.documentId ?? null,
        make: ambulance.make ?? null,
        manufacturingYear: ambulance.manufacturingYear ?? null,
        colour: ambulance.colour ?? null,
        vehicleType: ambulance.vehicleType ?? null,
        insuranceExpiryDate: ambulance.insuranceExpiryDate ?? null,
        fitnessExpiryDate: ambulance.fitnessExpiryDate ?? null,
        pucExpiryDate: ambulance.pucExpiryDate ?? null,
        permitExpiryDate: ambulance.permitExpiryDate ?? null,
        ambulanceAuthorizationExpiryDate: ambulance.ambulanceAuthorizationExpiryDate ?? null,
        available: ambulance.available,
        latitude: ambulance.latitude ?? null,
        longitude: ambulance.longitude ?? null,
        lastLocationAt: ambulance.lastLocationAt ?? null,
      })),
      incoming: incoming
        .sort((a, b) => b.requestedAt - a.requestedAt)
        .map((booking) => ({
          ...bookingSummary(booking),
          requesterRole: booking.requesterRole,
          targetAmbulanceId: booking.targetAmbulanceId ?? null,
        })),
      active: mine
        .filter((booking) => isActiveAmbulanceStatus(booking.status))
        .sort((a, b) => b.requestedAt - a.requestedAt)
        .map(bookingSummary),
      history: mine
        .filter((booking) => !isActiveAmbulanceStatus(booking.status))
        .sort((a, b) => b.requestedAt - a.requestedAt)
        .slice(0, 50)
        .map(bookingSummary),
    };
  },
});

export const reviewGuardian = mutation({
  args: {
    guardianUserId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("rejected"),
    ),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    const profile = await ctx.db
      .query("guardianProfiles")
      .withIndex("by_user", (q) => q.eq("userId", args.guardianUserId))
      .unique();
    if (!profile) throw new Error("Guardian profile not found.");
    await ctx.db.patch(profile._id, {
      documentsStatus: args.status,
      online: args.status === "verified" ? profile.online : false,
      updatedAt: Date.now(),
    });
    await audit(ctx, {
      actor: admin,
      action: `guardian.documents_${args.status}`,
      entityType: "guardianProfile",
      entityId: String(profile._id),
      detail:
        args.note?.trim().slice(0, 300) ||
        `Guardian documents marked ${args.status}.`,
    });
    await notifyUser(ctx, args.guardianUserId, {
      title: "Guardian document review",
      body: `Your ambulance service documents were marked ${args.status}.`,
      kind: "ambulance",
      link: "/guardian/dashboard",
    });
    return { ok: true };
  },
});

export const adminGuardians = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const profiles = await ctx.db.query("guardianProfiles").collect();
    const users = await ctx.db.query("users").collect();
    const userById = new Map(users.map((user) => [String(user._id), user]));
    return profiles.map((profile) => ({
      userId: profile.userId,
      companyName: profile.companyName,
      contactPerson: profile.contactPerson,
      phone: profile.phone,
      city: profile.city,
      address: profile.address,
      online: profile.online,
      documentsStatus: profile.documentsStatus,
      accountName: userById.get(String(profile.userId))?.name ?? null,
      email: userById.get(String(profile.userId))?.email ?? null,
      createdAt: profile.createdAt,
    }));
  },
});

export const ambulanceTypes = query({
  args: {},
  handler: async () => ["bls", "als", "icu", "neonatal"] as const,
});

/**
 * Bounded automatic re-matching for emergency bookings that entered
 * `searching` with no available ambulance.
 *
 * The cron runs this once a minute. Each booking has a durable next-attempt
 * time and attempt count, so repeated or overlapping runs are idempotent. A
 * booking is only patched while it is still `searching` and has no target; a
 * vehicle already targeted by another open booking is never selected. When the
 * 30-minute window or attempt cap is reached the booking is closed honestly as
 * expired — it is never marked assigned or dispatched without a real vehicle.
 */
export const rematchSearchingBookings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const searching = await ctx.db
      .query("ambulanceBookings")
      .withIndex("by_status", (q) => q.eq("status", "searching"))
      .collect();
    let scanned = 0;
    let assigned = 0;
    let retried = 0;
    let expired = 0;

    for (const booking of searching) {
      if (booking.targetAmbulanceId != null) continue;
      if (booking.nextRematchAt != null && booking.nextRematchAt > now) continue;
      scanned += 1;

      const attempts = booking.rematchAttempts ?? 0;
      const deadline = ambulanceOpenDeadline(booking);
      if (now >= deadline || attempts >= AMBULANCE_MAX_REMATCH_ATTEMPTS) {
        await expireOpenBooking(
          ctx,
          booking,
          now,
          `No approved ambulance became available within the ${Math.round(
            AMBULANCE_SEARCH_WINDOW_MS / 60_000,
          )}-minute search window.`,
          "Automatic re-matching ended without a confirmed ambulance.",
        );
        expired += 1;
        continue;
      }

      const candidates = await emergencyCandidates(
        ctx,
        booking.pickupLat,
        booking.pickupLng,
        booking._id,
      );
      const selected = candidates[0];
      if (!selected) {
        await ctx.db.patch(booking._id, {
          rematchAttempts: attempts + 1,
          nextRematchAt: Math.min(now + AMBULANCE_REMATCH_INTERVAL_MS, deadline),
          updatedAt: now,
        });
        retried += 1;
        continue;
      }

      // Re-read immediately before assigning: availability can change between
      // the candidate query and this patch.
      const vehicle = await ctx.db.get(selected.ambulance._id);
      if (!vehicle || !vehicle.available) {
        await ctx.db.patch(booking._id, {
          rematchAttempts: attempts + 1,
          nextRematchAt: Math.min(now + AMBULANCE_REMATCH_INTERVAL_MS, deadline),
          updatedAt: now,
        });
        retried += 1;
        continue;
      }

      await ctx.db.patch(booking._id, {
        targetAmbulanceId: vehicle._id,
        ambulanceType: vehicle.type ?? booking.ambulanceType,
        estimatedEtaMinutes: estimateEtaMinutes(selected.distanceKm),
        rematchAttempts: attempts + 1,
        nextRematchAt: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("ambulanceBookingEvents", {
        bookingId: booking._id,
        status: "searching",
        actorUserId: booking.requesterUserId,
        actorRole: "system",
        note: `Ambulance became available ${selected.distanceKm.toFixed(1)} km away. Awaiting provider acceptance.`,
        createdAt: now,
      });
      await notifyUser(ctx, vehicle.guardianUserId, {
        title: "Emergency ambulance request",
        body: `${booking.bookingRef}: live GPS pickup ${selected.distanceKm.toFixed(1)} km away.`,
        kind: "ambulance",
        link: "/guardian/dashboard",
      });
      assigned += 1;
    }

    return { scanned, assigned, retried, expired };
  },
});

/**
 * Release requests that no Guardian accepted. Runs from the cron and is safe to
 * run repeatedly: each booking is cancelled exactly once and the target vehicle
 * is never held by an expired request.
 */
export const expireStaleBookings = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const bookings = await ctx.db.query("ambulanceBookings").collect();
    let expired = 0;
    for (const booking of bookings) {
      if (
        !["requested", "searching"].includes(booking.status) ||
        booking.assignedAmbulanceId != null
      ) {
        continue;
      }
      if (now < ambulanceOpenDeadline(booking)) continue;
      await expireOpenBooking(
        ctx,
        booking,
        now,
        "No ambulance provider accepted the request within the response window.",
        "Request expired with no provider acceptance.",
      );
      expired += 1;
    }
    return { expired };
  },
});
