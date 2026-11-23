export type AppRole =
  | "admin"
  | "community"
  | "donor"
  | "requestor"
  | "red_cross"
  | "hospital"
  | "guardian"
  | "drone_ops"
  | "user"
  | "member";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  community: "Donor",
  // Legacy role values are kept for existing accounts, but every self-service
  // profile now presents as Donor in the interface.
  donor: "Donor",
  requestor: "Donor",
  red_cross: "Blood Bank",
  hospital: "Hospital",
  guardian: "Guardian ambulance provider",
  drone_ops: "Drone operations",
  user: "Visitor",
  member: "Member",
};

export const STAFF_ROLES: AppRole[] = ["red_cross", "hospital", "admin"];

export function dashboardPathForRole(role?: string | null): string {
  switch (role) {
    case "community":
    case "donor":
    case "requestor":
      return "/community/dashboard";
    case "red_cross":
      return "/red-cross/dashboard";
    case "guardian":
      return "/guardian/dashboard";
    case "admin":
      return "/admin/dashboard";
    case "hospital":
      return "/hospital/dashboard";
    case "drone_ops":
      return "/drones";
    default:
      return "/signup";
  }
}

export function isStaffRole(role?: string | null) {
  return role === "red_cross" || role === "hospital" || role === "admin";
}

/**
 * True only when the account has finished sign-up and owns a dashboard
 * workspace. A session without a role (an abandoned or in-progress sign-up)
 * must keep showing "Log in / Create account", not a Dashboard button that
 * just bounces back to the role picker.
 */
export function hasDashboardRole(role?: string | null): boolean {
  return (
    role === "community" ||
    role === "donor" ||
    role === "requestor" ||
    role === "red_cross" ||
    role === "hospital" ||
    role === "guardian" ||
    role === "drone_ops" ||
    role === "admin"
  );
}

export const ROLE_CARDS = [
  {
    role: "community",
    title: "Donor",
    description:
      "Give blood, request blood for a patient, and add either profile from one verified account.",
    href: "/signup/community",
    accent: "crimson" as const,
  },
  {
    role: "red_cross",
    title: "Blood Bank",
    description:
      "Verify requests, manage blood inventory, expiry and stock movements with an auditable ledger.",
    href: "/signup/red-cross",
    accent: "teal" as const,
  },
  {
    role: "hospital",
    title: "Hospital",
    description:
      "Submit hospital blood requests, track dispatch, confirm receipt and book patient transport.",
    href: "/signup/hospital",
    accent: "amber" as const,
  },
  {
    role: "guardian",
    title: "Guardian ambulance provider",
    description:
      "Register ambulances, manage drivers, accept nearby bookings and share live journey status.",
    href: "/signup/guardian",
    accent: "navy" as const,
  },
];
