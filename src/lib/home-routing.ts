import { dashboardPathForRole, hasDashboardRole } from "./roles";

export type HomeRouteDecision =
  | { type: "loading" }
  | { type: "landing" }
  | { type: "redirect"; to: string };

/**
 * Decide what `/` renders without exposing the public landing page while
 * authentication is still being restored.
 *
 * Signed-out visitors get the landing page. Every authenticated account with a
 * finished role is sent to the dashboard resolved by `dashboardPathForRole`.
 * An unfinished account is sent to role setup — never to a default donor
 * dashboard.
 */
export function resolveHomeRoute(input: {
  isLoading: boolean;
  isAuthenticated: boolean;
  role?: string | null;
}): HomeRouteDecision {
  if (input.isLoading) return { type: "loading" };
  if (!input.isAuthenticated) return { type: "landing" };

  return {
    type: "redirect",
    to: hasDashboardRole(input.role)
      ? dashboardPathForRole(input.role)
      : "/signup",
  };
}

/** Shared logo destination: dashboard when signed in, public home otherwise. */
export function resolveLogoHref(input: {
  isAuthenticated: boolean;
  role?: string | null;
}): string {
  return input.isAuthenticated && hasDashboardRole(input.role)
    ? dashboardPathForRole(input.role)
    : "/";
}
