export type AppRole =
  | "admin"
  | "community"
  | "donor"
  | "requestor"
  | "red_cross"
  | "hospital"
  | "drone_ops"
  | "user"
  | "member";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  community: "Donor & Blood Requestor",
  // Legacy role values are kept for existing accounts, but both map to the
  // combined self-service role in the interface.
  donor: "Donor & Blood Requestor",
  requestor: "Donor & Blood Requestor",
  red_cross: "Red Cross Society",
  hospital: "Hospital",
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
    role === "drone_ops" ||
    role === "admin"
  );
}

export const ROLE_CARDS = [
  {
    role: "community",
    title: "Donor & Blood Requestor",
    description:
      "Give blood, request blood for a patient, and manage both from one verified account.",
    href: "/signup/community",
    accent: "crimson" as const,
  },
  {
    role: "red_cross",
    title: "Red Cross Society",
    description:
      "Verify requests, manage shared inventory and camps, and keep every stock movement auditable.",
    href: "/signup/red-cross",
    accent: "teal" as const,
  },
  {
    role: "hospital",
    title: "Hospital",
    description:
      "Submit hospital blood requests, track dispatch and confirm receipt against the shared ledger.",
    href: "/signup/hospital",
    accent: "amber" as const,
  },
];
