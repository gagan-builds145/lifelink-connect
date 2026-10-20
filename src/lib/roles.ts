export type AppRole =
  | "admin"
  | "donor"
  | "requestor"
  | "red_cross"
  | "hospital"
  | "user"
  | "member";

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrator",
  donor: "Blood donor",
  requestor: "Blood requestor",
  red_cross: "Red Cross Society",
  hospital: "Hospital",
  user: "Visitor",
  member: "Member",
};

export const STAFF_ROLES: AppRole[] = ["red_cross", "hospital", "admin"];

export function dashboardPathForRole(role?: string | null): string {
  switch (role) {
    case "donor":
      return "/donor/dashboard";
    case "requestor":
      return "/requestor/dashboard";
    case "red_cross":
    case "admin":
      return "/red-cross/dashboard";
    case "hospital":
      return "/hospital/dashboard";
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
    role === "donor" ||
    role === "requestor" ||
    role === "red_cross" ||
    role === "hospital" ||
    role === "admin"
  );
}

export const ROLE_CARDS = [
  {
    role: "donor",
    title: "Donor",
    tagline: "Give the gift of life",
    description:
      "Register once, control your availability, see verified nearby requests and track every donation.",
    href: "/signup/donor",
    accent: "crimson" as const,
  },
  {
    role: "requestor",
    title: "Blood Requestor",
    tagline: "Find help, fast",
    description:
      "Patients, families and authorized representatives can raise and track a verified blood request.",
    href: "/signup/requestor",
    accent: "navy" as const,
  },
  {
    role: "red_cross",
    title: "Red Cross Society",
    tagline: "Coordinate the network",
    description:
      "Verify requests, manage shared inventory and camps, and keep every stock movement auditable.",
    href: "/signup/red-cross",
    accent: "teal" as const,
  },
  {
    role: "hospital",
    title: "Hospital",
    tagline: "Run the clinical request",
    description:
      "Submit hospital blood requests, track dispatch and confirm receipt against the shared ledger.",
    href: "/signup/hospital",
    accent: "amber" as const,
  },
];
