import { describe, expect, test } from "bun:test";
import { dashboardPathForRole, hasDashboardRole } from "../src/lib/roles";

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
