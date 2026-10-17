import { v } from "convex/values";

export const bloodGroupValidator = v.union(
  v.literal("A+"),
  v.literal("A-"),
  v.literal("B+"),
  v.literal("B-"),
  v.literal("AB+"),
  v.literal("AB-"),
  v.literal("O+"),
  v.literal("O-"),
);

export const componentValidator = v.union(
  v.literal("whole_blood"),
  v.literal("red_cells"),
  v.literal("platelets"),
  v.literal("plasma"),
);

export const urgencyValidator = v.union(
  v.literal("routine"),
  v.literal("urgent"),
  v.literal("emergency"),
);

export const requestStatusValidator = v.union(
  v.literal("pending"),
  v.literal("under_verification"),
  v.literal("approved"),
  v.literal("dispatched"),
  v.literal("received"),
  v.literal("fulfilled"),
  v.literal("rejected"),
  v.literal("cancelled"),
);

export const requestorTypeValidator = v.union(
  v.literal("patient"),
  v.literal("family"),
  v.literal("representative"),
);

export const orgTypeValidator = v.union(
  v.literal("red_cross"),
  v.literal("hospital"),
  v.literal("blood_bank"),
);

export const orgStatusValidator = v.union(
  v.literal("pending"),
  v.literal("verified"),
  v.literal("suspended"),
);

export const transactionTypeValidator = v.union(
  v.literal("collection"),
  v.literal("issue"),
  v.literal("reserve"),
  v.literal("release"),
  v.literal("dispatch"),
  v.literal("receipt"),
  v.literal("adjustment"),
  v.literal("expiry"),
);

export const campStatusValidator = v.union(
  v.literal("upcoming"),
  v.literal("ongoing"),
  v.literal("completed"),
  v.literal("cancelled"),
);

export const notificationKindValidator = v.union(
  v.literal("request"),
  v.literal("match"),
  v.literal("inventory"),
  v.literal("camp"),
  v.literal("system"),
);

export const userRoleValidator = v.union(
  v.literal("admin"),
  v.literal("donor"),
  v.literal("requestor"),
  v.literal("red_cross"),
  v.literal("hospital"),
  v.literal("user"),
  v.literal("member"),
);
