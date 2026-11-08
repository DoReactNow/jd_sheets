// Decision 64: a NETWORK_BLOCKED answer reloads the page once, so the blocked page replaces an
// open sheet (P4-OUT-06).
import { describe, expect, it, vi } from "vitest";
import { createNetworkBlockedReloader } from "../networkBlocked";

describe("createNetworkBlockedReloader", () => {
  it("reloads on NETWORK_BLOCKED, once", () => {
    const reload = vi.fn();
    const react = createNetworkBlockedReloader(() => reload());
    react("NETWORK_BLOCKED");
    react("NETWORK_BLOCKED");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ignores every other answer", () => {
    const reload = vi.fn();
    const react = createNetworkBlockedReloader(() => reload());
    for (const code of ["FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED", "WORKBOOK_CHANGED"])
      react(code);
    expect(reload).not.toHaveBeenCalled();
  });
});
