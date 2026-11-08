// Decision 64: what an address outside the allowed networks may reach (P4-OUT-02, -05).
import { describe, expect, it } from "vitest";
import { outsideApiAllowed, outsidePageDecision } from "../outsideAccess";

describe("outsideApiAllowed (the Super Admin outside)", () => {
  it.each([
    "/api/me",
    "/api/diagnostics",
    "/api/auth/sign-out",
    "/api/auth/password",
    "/api/admin/approvals",
    "/api/admin/approvals/0190f5e0-0000-7000-8000-00000000000a/approve",
    "/api/admin/users/0190f5e0-0000-7000-8000-00000000000a/reset-password",
    "/api/admin/network/rules",
    "/api/admin/groups/x/members",
    "/api/admin/audit",
  ])("allows the admin panel: %s", (path) => {
    expect(outsideApiAllowed(path)).toBe(true);
  });

  it.each([
    "/api/workbooks",
    "/api/workbooks/import",
    "/api/workbooks/x/content",
    "/api/workbooks/x/collab-token",
    "/api/share-targets",
    "/api/admin/workbooks",
    "/api/admin/workbooks/x/open",
    "/api/admin/usersX",
    "/api/mex",
    "/api/new-route-nobody-listed",
  ])("refuses everything else: %s", (path) => {
    expect(outsideApiAllowed(path)).toBe(false);
  });
});

describe("outsidePageDecision", () => {
  it("someone not signed in: / goes to sign-in, sign-in shows, the rest is blocked", () => {
    expect(outsidePageDecision("/", "anonymous")).toBe("sign-in");
    expect(outsidePageDecision("/sign-in", "anonymous")).toBe("show");
    expect(outsidePageDecision("/admin", "anonymous")).toBe("blocked");
    expect(outsidePageDecision("/request-access", "anonymous")).toBe("blocked");
    expect(outsidePageDecision("/w/0190f5e0-0000-7000-8000-00000000000a", "anonymous")).toBe(
      "blocked",
    );
  });

  it("anyone signed in who is not the Super Admin is blocked everywhere but sign-in", () => {
    expect(outsidePageDecision("/", "other")).toBe("blocked");
    expect(outsidePageDecision("/admin/users", "other")).toBe("blocked");
    expect(outsidePageDecision("/sign-in", "other")).toBe("show");
  });

  it("the Super Admin: admin pages show, / goes to /admin, sheets are blocked", () => {
    for (const path of [
      "/admin",
      "/admin/approvals",
      "/admin/users",
      "/admin/network",
      "/admin/groups",
      "/admin/audit",
      "/change-password",
      "/forbidden",
      "/sign-in",
    ]) {
      expect({ path, d: outsidePageDecision(path, "super-admin") }).toEqual({ path, d: "show" });
    }
    expect(outsidePageDecision("/", "super-admin")).toBe("admin-home");
    expect(outsidePageDecision("/admin/workbooks", "super-admin")).toBe("blocked");
    expect(outsidePageDecision("/w/0190f5e0-0000-7000-8000-00000000000a", "super-admin")).toBe(
      "blocked",
    );
  });
});
