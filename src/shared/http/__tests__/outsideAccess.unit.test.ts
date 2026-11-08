// Decisions 64, 65: which pages an address outside the allowed networks may open (P4-OUT-05).
import { describe, expect, it } from "vitest";
import { outsidePageDecision } from "../outsideAccess";

describe("outsidePageDecision", () => {
  it("someone not signed in: the main address (sign-in) and /sign-in show, the rest is blocked", () => {
    expect(outsidePageDecision("/", "anonymous")).toBe("show");
    expect(outsidePageDecision("/sign-in", "anonymous")).toBe("show");
    expect(outsidePageDecision("/admin", "anonymous")).toBe("blocked");
    expect(outsidePageDecision("/request-access", "anonymous")).toBe("blocked");
    expect(outsidePageDecision("/w/0190f5e0-0000-7000-8000-00000000000a", "anonymous")).toBe(
      "blocked",
    );
  });

  it("anyone signed in who is not the Super Admin is blocked everywhere but /sign-in", () => {
    expect(outsidePageDecision("/", "other")).toBe("blocked");
    expect(outsidePageDecision("/admin/users", "other")).toBe("blocked");
    expect(outsidePageDecision("/w/0190f5e0-0000-7000-8000-00000000000a", "other")).toBe("blocked");
    expect(outsidePageDecision("/sign-in", "other")).toBe("show");
  });

  it("the Super Admin sees every page (Decision 65)", () => {
    for (const path of [
      "/",
      "/admin",
      "/admin/workbooks",
      "/admin/network",
      "/w/0190f5e0-0000-7000-8000-00000000000a",
      "/change-password",
    ]) {
      expect({ path, d: outsidePageDecision(path, "super-admin") }).toEqual({ path, d: "show" });
    }
  });
});
