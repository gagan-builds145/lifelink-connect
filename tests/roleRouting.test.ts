import { describe, expect, test } from "bun:test";
import { dashboardPathForRole, hasDashboardRole } from "../src/lib/roles";
import { resolveHomeRoute, resolveLogoHref } from "../src/lib/home-routing";

describe("authenticated role routing", () => {
  test.each([
    ["community", "/community/dashboard"],
    ["donor", "/community/dashboard"],
    ["requestor", "/community/dashboard"],
    ["hospital", "/hospital/dashboard"],
    ["red_cross", "/red-cross/dashboard"],
    ["admin", "/admin/dashboard"],
    ["guardian", "/guardian/dashboard"],
    ["drone_ops", "/drones"],
  ])("role %s resolves to its own dashboard", (role, expected) => {
    expect(hasDashboardRole(role)).toBe(true);
    expect(dashboardPathForRole(role)).toBe(expected);
  });

  test("an unfinished account is sent to role setup, not a donor dashboard", () => {
    for (const role of ["user", "member", undefined, null, ""]) {
      expect(hasDashboardRole(role)).toBe(false);
      expect(dashboardPathForRole(role)).toBe("/signup");
    }
  });
});

describe("home route and logo decisions", () => {
  test("signed-in users are redirected from / to their own dashboard", () => {
    const cases = [
      ["community", "/community/dashboard"],
      ["donor", "/community/dashboard"],
      ["requestor", "/community/dashboard"],
      ["hospital", "/hospital/dashboard"],
      ["red_cross", "/red-cross/dashboard"],
      ["admin", "/admin/dashboard"],
      ["guardian", "/guardian/dashboard"],
      ["drone_ops", "/drones"],
    ] as const;
    for (const [role, destination] of cases) {
      expect(
        resolveHomeRoute({ isLoading: false, isAuthenticated: true, role }),
      ).toEqual({ type: "redirect", to: destination });
      expect(resolveLogoHref({ isAuthenticated: true, role })).toBe(destination);
    }
  });

  test("authentication loading never renders the landing page", () => {
    expect(
      resolveHomeRoute({ isLoading: true, isAuthenticated: false }),
    ).toEqual({ type: "loading" });
    expect(
      resolveHomeRoute({ isLoading: true, isAuthenticated: true, role: "community" }),
    ).toEqual({ type: "loading" });
  });

  test("signed-out visitors and unfinished accounts keep public/setup destinations", () => {
    expect(
      resolveHomeRoute({ isLoading: false, isAuthenticated: false }),
    ).toEqual({ type: "landing" });
    expect(resolveLogoHref({ isAuthenticated: false })).toBe("/");
    expect(
      resolveHomeRoute({ isLoading: false, isAuthenticated: true, role: "user" }),
    ).toEqual({ type: "redirect", to: "/signup" });
  });
});
