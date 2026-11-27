import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  audit,
  backfillLifeLinkIdsForUser,
  enforceRateLimit,
  findLifeLinkIdByValue,
  getDonorProfile,
  getRequestorProfile,
  getOrCreateLifeLinkId,
  LIFELINK_ID_PATTERN,
  lifeLinkIdKind,
  nextSequentialId,
  normalizeEmail,
  optionalUser,
  requireDateString,
  requireOrganization,
  requirePhone,
  requireRole,
  requireText,
  requireUser,
  roleOf,
  rolesOf,
  LifeLinkIdKind,
} from "./lib/helpers";
import {
  bloodGroupValidator,
  orgTypeValidator,
  requestorTypeValidator,
} from "./validators";
import { logCommunityActivity } from "./lib/community";
import { ageFromDob, citiesInState, stateOfCity } from "../lib/blood";
import { isValidMapCoordinate } from "../lib/organizationMap";

const orgTypeArg = v.union(v.literal("red_cross"), v.literal("hospital"));

/** Everything the app needs to route and personalize a signed-in account. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const donor = await getDonorProfile(ctx, user._id);
    const requestor = await getRequestorProfile(ctx, user._id);
    const organization = user.organizationId
      ? await ctx.db.get(user.organizationId)
      : null;
    const idEntry = await ctx.db
      .query("lifeLinkIds")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    return {
      user: {
        _id: user._id,
        name: user.name ?? null,
        email: user.email ?? null,
        phone: user.phone ?? null,
        city: user.city ?? null,
        role: roleOf(user),
        roles: rolesOf(user),
        isAnonymous: user.isAnonymous ?? false,
      },
      donor,
      requestor,
      organization,
      lifeLinkId: idEntry?.lifeLinkId ?? null,
    };
  },
});

/**
 * Switch the active workspace without signing out. Only roles already granted
 * server-side can be selected, so this can never escalate privileges.
 */
export const switchRole = mutation({
  args: {
    role: v.union(
      v.literal("community"),
      v.literal("donor"),
      v.literal("requestor"),
      v.literal("guardian"),
      v.literal("hospital"),
      v.literal("red_cross"),
      v.literal("drone_ops"),
      v.literal("admin"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const granted = rolesOf(user);
    if (!granted.includes(args.role)) {
      throw new Error("That role has not been granted to this account.");
    }
    if (user.role === args.role) return { role: args.role, roles: granted };
    await ctx.db.patch(user._id, { role: args.role });
    await audit(ctx, {
      actor: user,
      action: "account.role_switched",
      entityType: "user",
      entityId: String(user._id),
      detail: `Active workspace switched from ${roleOf(user)} to ${args.role}. No role was granted.`,
    });
    return { role: args.role, roles: granted };
  },
});

export const myRoles = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return { active: roleOf(user), roles: rolesOf(user) };
  },
});

export const registerDonor = mutation({
  args: {
    fullName: v.string(),
    bloodGroup: bloodGroupValidator,
    dateOfBirth: v.string(),
    gender: v.optional(v.string()),
    phone: v.string(),
    address: v.string(),
    city: v.string(),
    area: v.optional(v.string()),
    preferredCenter: v.optional(v.string()),
    lastDonationDate: v.optional(v.string()),
    available: v.boolean(),
    shareContact: v.boolean(),
    consent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.consent !== true) {
      throw new Error("Please confirm the donor declaration to continue.");
    }
    const existing = await getDonorProfile(ctx, user._id);
    if (existing) throw new Error("A donor profile already exists for this account.");
    if (["red_cross", "hospital", "admin"].includes(roleOf(user))) {
      throw new Error("This account is registered as staff and cannot also register as a donor.");
    }

    const fullName = requireText(args.fullName, "Full name");
    const phone = requirePhone(args.phone);
    const city = requireText(args.city, "City", 2, 80);
    const dob = requireDateString(args.dateOfBirth, "Date of birth");
    const age = ageFromDob(dob);
    if (age == null || age < 18 || age > 65) {
      throw new Error("Donors must be between 18 and 65 years old. Final eligibility is confirmed by medical staff.");
    }
    const address = requireText(args.address, "Address", 5, 300);
    const lastDonationDate = args.lastDonationDate
      ? requireDateString(args.lastDonationDate, "Last donation date")
      : undefined;

    const donorId = await nextSequentialId(ctx, "donor", "LL-D");
    const now = Date.now();
    const lifeLinkId = await getOrCreateLifeLinkId(ctx, user, "LL-D");
    const profileId = await ctx.db.insert("donorProfiles", {
      userId: user._id,
      donorId,
      fullName,
      bloodGroup: args.bloodGroup,
      dateOfBirth: dob,
      gender: args.gender,
      phone,
      email: user.email,
      address,
      city,
      area: args.area,
      preferredCenter: args.preferredCenter,
      lastDonationDate,
      available: args.available,
      shareContact: args.shareContact,
      bloodGroupSource: "self_declared",
      bloodGroupUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(user._id, {
      name: fullName,
      role: "community",
      city,
      phone,
      profileCompleted: true,
      createdAt: user.createdAt ?? now,
    });

    await ctx.db.insert("notifications", {
      userId: user._id,
      title: "Welcome to LifeLink",
      body: `Your LifeLink ID is ${lifeLinkId}. Keep your availability current so verified requests can reach you.`,
      kind: "system",
      read: false,
      createdAt: now,
    });

    await audit(ctx, {
      actor: { ...user, role: "community" },
      action: "donor.registered",
      entityType: "donorProfile",
      entityId: donorId,
      detail: `Donor ${donorId} registered in ${city} with group ${args.bloodGroup}; LifeLink ID ${lifeLinkId}.`,
    });

    return { donorId, profileId };
  },
});

export const registerRequestor = mutation({
  args: {
    fullName: v.string(),
    phone: v.string(),
    requestorType: requestorTypeValidator,
    city: v.string(),
    consent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.consent !== true) {
      throw new Error("Please accept the data-use declaration to continue.");
    }
    const existing = await getRequestorProfile(ctx, user._id);
    if (existing) throw new Error("A requestor profile already exists for this account.");
    if (["red_cross", "hospital", "admin"].includes(roleOf(user))) {
      throw new Error("Staff accounts cannot register as blood requestors.");
    }

    const fullName = requireText(args.fullName, "Full name");
    const phone = requirePhone(args.phone);
    const city = requireText(args.city, "City", 2, 80);
    const requestorId = await nextSequentialId(ctx, "requestor", "LL-P");
    const now = Date.now();
    const lifeLinkId = await getOrCreateLifeLinkId(ctx, user, "LL-P");

    const profileId = await ctx.db.insert("requestorProfiles", {
      userId: user._id,
      requestorId,
      fullName,
      phone,
      email: user.email,
      requestorType: args.requestorType,
      city,
      createdAt: now,
    });

    await ctx.db.patch(user._id, {
      name: fullName,
      role: "community",
      city,
      phone,
      profileCompleted: true,
      createdAt: user.createdAt ?? now,
    });

    await ctx.db.insert("notifications", {
      userId: user._id,
      title: "Requestor account ready",
      body: `Your LifeLink ID is ${lifeLinkId}. You can now submit and track blood requests.`,
      kind: "system",
      read: false,
      createdAt: now,
    });

    await audit(ctx, {
      actor: { ...user, role: "community" },
      action: "requestor.registered",
      entityType: "requestorProfile",
      entityId: requestorId,
      detail: `Requestor ${requestorId} registered in ${city}; LifeLink ID ${lifeLinkId}.`,
    });

    return { requestorId, profileId, lifeLinkId };
  },
});

/**
 * Staff registration is self-service: the signed-in account is linked to a new
 * organization server-side, and the staff role can only be attached here — the
 * browser can never set a role by itself.
 */
export const registerOrganization = mutation({
  args: {
    type: orgTypeArg,
    name: v.string(),
    contactPerson: v.string(),
    phone: v.string(),
    email: v.string(),
    address: v.string(),
    city: v.string(),
    area: v.optional(v.string()),
    // Accepted for compatibility with older clients; no longer checked.
    authorizationCode: v.optional(v.string()),
    consent: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await enforceRateLimit(ctx, `org-register:${user._id}`, 5);
    if (args.consent !== true) {
      throw new Error("Please confirm you are authorized to register this organization.");
    }
    if (user.organizationId) {
      throw new Error("This account is already linked to an organization.");
    }
    if (["community", "donor", "requestor"].includes(roleOf(user))) {
      throw new Error("This account already has a personal profile.");
    }

    const name = requireText(args.name, "Organization name", 3, 160);
    const contactPerson = requireText(args.contactPerson, "Contact person");
    const phone = requirePhone(args.phone);
    const email = normalizeEmail(args.email);
    const address = requireText(args.address, "Address", 5, 300);
    const city = requireText(args.city, "City", 2, 80);
    const orgId = await nextSequentialId(
      ctx,
      args.type === "red_cross" ? "red-cross-org" : "hospital-org",
      args.type === "red_cross" ? "RC" : "HOSP",
    );
    const now = Date.now();

    const organizationId = await ctx.db.insert("organizations", {
      orgId,
      type: args.type,
      name,
      contactPerson,
      phone,
      email,
      address,
      city,
      area: args.area,
      status: "verified",
      verifiedAt: now,
      verifiedBy: "Email-verified self-service registration",
      createdByUserId: user._id,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(user._id, {
      name: contactPerson,
      role: args.type,
      organizationId,
      city,
      phone,
      profileCompleted: true,
      createdAt: user.createdAt ?? now,
    });

    const lifeLinkKind: LifeLinkIdKind = args.type === "red_cross" ? "LL-RC" : "LL-HOSP";
    const lifeLinkId = await getOrCreateLifeLinkId(ctx, user, lifeLinkKind);
    const orgOrgId = orgId as string;
    await ctx.db.insert("notifications", {
      userId: user._id,
      title: "Organization registered and verified",
      body: `${name} (${orgOrgId}) is now linked to your account. Your LifeLink ID is ${lifeLinkId}. Inventory and request actions are recorded in the audit log.`,
      kind: "system",
      read: false,
      createdAt: now,
    });

    await audit(ctx, {
      actor: { ...user, role: args.type },
      action: "organization.registered",
      entityType: "organization",
      entityId: orgOrgId,
      detail: `${name} registered as ${args.type} in ${city}; LifeLink ID ${lifeLinkId}.`,
      organizationId,
    });

    return { orgId, organizationId, lifeLinkId };
  },
});

export const updateDonorProfile = mutation({
  args: {
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    area: v.optional(v.string()),
    preferredCenter: v.optional(v.string()),
    shareContact: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["community", "donor"]);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) throw new Error("Donor profile not found.");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.phone !== undefined) patch.phone = requirePhone(args.phone);
    if (args.address !== undefined) patch.address = requireText(args.address, "Address", 5, 300);
    if (args.city !== undefined) {
      const city = requireText(args.city, "City", 2, 80);
      patch.city = city;
      await ctx.db.patch(user._id, { city });
    }
    if (args.area !== undefined) patch.area = args.area;
    if (args.preferredCenter !== undefined) patch.preferredCenter = args.preferredCenter;
    if (args.shareContact !== undefined) patch.shareContact = args.shareContact;

    await ctx.db.patch(donor._id, patch);
    await logCommunityActivity(ctx, user._id, {
      kind: "donor_profile",
      title: "Donor profile updated",
      detail: "Contact, location or sharing preferences changed.",
    });
    return { ok: true };
  },
});

export const setAvailability = mutation({
  args: { available: v.boolean() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["community", "donor"]);
    const donor = await getDonorProfile(ctx, user._id);
    if (!donor) throw new Error("Donor profile not found.");
    await ctx.db.patch(donor._id, {
      available: args.available,
      updatedAt: Date.now(),
    });
    await logCommunityActivity(ctx, user._id, {
      kind: "availability",
      title: args.available ? "Availability turned on" : "Availability paused",
      detail: args.available
        ? "Compatible verified requests in your city can notify you."
        : "New donor match notifications are paused.",
    });
    return { available: args.available };
  },
});

export const updateRequestorProfile = mutation({
  args: {
    phone: v.optional(v.string()),
    city: v.optional(v.string()),
    requestorType: v.optional(requestorTypeValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["community", "requestor"]);
    const requestor = await getRequestorProfile(ctx, user._id);
    if (!requestor) throw new Error("Requestor profile not found.");
    const patch: Record<string, unknown> = {};
    if (args.phone !== undefined) patch.phone = requirePhone(args.phone);
    if (args.city !== undefined) patch.city = requireText(args.city, "City", 2, 80);
    if (args.requestorType !== undefined) patch.requestorType = args.requestorType;
    await ctx.db.patch(requestor._id, patch);
    if (patch.city) await ctx.db.patch(user._id, { city: patch.city as string });
    await logCommunityActivity(ctx, user._id, {
      kind: "requestor_profile",
      title: "Requestor profile updated",
      detail: "Contact, city or relationship changed.",
    });
    return { ok: true };
  },
});

/**
 * Map-safe organization locations. Only verified hospitals and Red Cross
 * societies with real, in-range coordinates are returned as markers. The
 * viewer's own organization association is resolved from the authenticated
 * user record on the server and never from client input.
 */
export const mapLocations = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await optionalUser(ctx);
    const activeViewer =
      viewer && !viewer.isAnonymous && !viewer.suspended ? viewer : null;
    const viewerOrg = activeViewer?.organizationId
      ? await ctx.db.get(activeViewer.organizationId)
      : null;

    const rows = await ctx.db.query("organizations").collect();
    const eligible = rows.filter(
      (o) =>
        o.status === "verified" &&
        (o.type === "hospital" || o.type === "red_cross"),
    );
    const isOwnBase = (org: (typeof eligible)[number]) =>
      viewerOrg != null &&
      viewerOrg.status === "verified" &&
      (org._id === viewerOrg._id ||
        (viewerOrg.orgId.length > 0 && org.orgId === viewerOrg.orgId));

    const locations = eligible
      .filter((o) => isValidMapCoordinate(o.latitude, o.longitude))
      .map((o) => ({
        id: String(o._id),
        orgId: o.orgId,
        name: o.name,
        type: o.type,
        latitude: o.latitude as number,
        longitude: o.longitude as number,
        address: o.address,
        city: o.city,
        area: o.area ?? null,
        phone: o.phone,
        status: o.status,
        baseId: String(o._id),
        isOwnBase: isOwnBase(o),
        isDemo: o.isDemo ?? false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const missingLocations = eligible
      .filter((o) => !isValidMapCoordinate(o.latitude, o.longitude))
      .map((o) => ({
        id: String(o._id),
        orgId: o.orgId,
        name: o.name,
        type: o.type,
        city: o.city,
        address: o.address,
        reason:
          o.latitude == null || o.longitude == null
            ? ("Missing registered coordinates" as const)
            : ("Invalid registered coordinates" as const),
        isOwnBase: isOwnBase(o),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      viewerOrganizationId: viewerOrg ? String(viewerOrg._id) : null,
      viewerOrganizationName: viewerOrg?.name ?? null,
      locations,
      missingLocations,
    };
  },
});

export const myOrganization = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!user.organizationId) return null;
    const org = await ctx.db.get(user.organizationId);
    if (!org) return null;
    return org;
  },
});

export const updateMyOrganization = mutation({
  args: {
    contactPerson: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    area: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["red_cross", "hospital"]);
    const org = await requireOrganization(ctx, user, ["red_cross", "hospital"]);
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.contactPerson !== undefined) patch.contactPerson = requireText(args.contactPerson, "Contact person");
    if (args.phone !== undefined) patch.phone = requirePhone(args.phone);
    if (args.address !== undefined) patch.address = requireText(args.address, "Address", 5, 300);
    if (args.city !== undefined) patch.city = requireText(args.city, "City", 2, 80);
    if (args.area !== undefined) patch.area = args.area;
    await ctx.db.patch(org._id, patch);
    await audit(ctx, {
      actor: user,
      action: "organization.updated",
      entityType: "organization",
      entityId: org.orgId,
      detail: `Profile details updated for ${org.name}.`,
      organizationId: org._id,
    });
    return { ok: true };
  },
});

/**
 * Verified, public-safe organization directory. Never returns staff emails.
 * `scope` mirrors the blood search: a single city unless an emergency widens
 * the search to the state or the whole country.
 */
export const lifeLinkIdByValue = query({
  args: { lifeLinkId: v.string() },
  handler: async (ctx, args) => {
    const entry = await findLifeLinkIdByValue(ctx, args.lifeLinkId);
    if (!entry) return null;
    const user = await ctx.db.get(entry.userId);
    if (!user) return null;
    return {
      lifeLinkId: entry.lifeLinkId,
      userId: entry.userId,
      role: roleOf(user),
      name: user.name ?? null,
      email: user.email ?? null,
      organizationId: user.organizationId ?? null,
      createdAt: entry.createdAt,
    };
  },
});

export const myLifeLinkId = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const entry = await ctx.db
      .query("lifeLinkIds")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!entry) return null;
    if (!LIFELINK_ID_PATTERN.test(entry.lifeLinkId)) {
      // Defensive: never surface an internally-corrupted identifier.
      throw new Error("Your LifeLink ID is invalid. Contact support.");
    }
    const kind = lifeLinkIdKind(entry.lifeLinkId);
    return {
      lifeLinkId: entry.lifeLinkId,
      kind,
      roleAtCreation: entry.roleAtCreation,
      createdAt: entry.createdAt,
    };
  },
});

export const backfillLifeLinkId = mutation({
  args: {
    kind: v.union(
      v.literal("LL-D"),
      v.literal("LL-P"),
      v.literal("LL-HOSP"),
      v.literal("LL-RC"),
      v.literal("LL-GUA"),
      v.literal("LL-ADM"),
    ),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const kind = args.kind as LifeLinkIdKind;
    const lifeLinkId = await backfillLifeLinkIdsForUser(ctx, user._id, kind);
    await audit(ctx, {
      actor: user,
      action: "account.lifelink_id_backfilled",
      entityType: "user",
      entityId: String(user._id),
      detail: `LifeLink ID ${lifeLinkId} assigned (${kind}) for account that did not have one.`,
    });
    return { lifeLinkId };
  },
});

export const publicOrganizations = query({
  args: {
    type: v.optional(orgTypeValidator),
    city: v.optional(v.string()),
    scope: v.optional(
      v.union(v.literal("city"), v.literal("state"), v.literal("country")),
    ),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("organizations").collect();
    const scope = args.scope ?? "city";
    const allowedCities = (() => {
      if (scope === "country" || !args.city) return null;
      if (scope === "state") {
        const cities = citiesInState(stateOfCity(args.city));
        return new Set(cities.length > 0 ? cities : [args.city]);
      }
      return new Set([args.city]);
    })();
    return rows
      .filter((o) => o.status === "verified")
      .filter((o) => (args.type ? o.type === args.type : true))
      .filter((o) => (allowedCities ? allowedCities.has(o.city) : true))
      .map((o) => ({
        _id: o._id,
        orgId: o.orgId,
        type: o.type,
        name: o.name,
        city: o.city,
        area: o.area ?? null,
        phone: o.phone,
        email: o.email,
        verified: o.status === "verified",
        isDemo: o.isDemo ?? false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});
