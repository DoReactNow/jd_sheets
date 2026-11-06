import { describe, expect, it } from "vitest";
import { fakePrincipal } from "@/tests/setup/fakePrincipal";
import { AppError } from "@/shared/errors/AppError";
import { assertCan } from "../assertCan";
import { can, checkAccess, type Access } from "../guard";
import { PERMISSION_CODES, type PermissionCode } from "../permissionRegistry";
import type { Principal } from "../principal";

function principal(permissions: PermissionCode[], bypassesAccess = false): Principal {
  return fakePrincipal({
    roleCode: bypassesAccess ? "SUPER_ADMIN" : "CUSTOM",
    bypassesAccess,
    permissions: new Set(permissions),
  });
}

const diag = "system:diagnostics" satisfies PermissionCode;
const reserved = "roles:manage" satisfies PermissionCode;

describe("can()", () => {
  it("allows a held permission and denies one that is not held", () => {
    expect(can(principal([diag]), diag)).toBe(true);
    expect(can(principal([]), diag)).toBe(false);
  });

  it("denies when there is no principal", () => {
    expect(can(null, diag)).toBe(false);
  });

  it("lets a bypass principal through every registered code, reserved ones included", () => {
    const superAdmin = principal([], true);
    for (const code of PERMISSION_CODES) expect(can(superAdmin, code), code).toBe(true);
  });
});

describe("checkAccess()", () => {
  const cases: Array<[string, Access | undefined, Principal | null, string]> = [
    ["public, anonymous", "public", null, "allow"],
    ["authenticated, anonymous", "authenticated", null, "unauthenticated"],
    ["authenticated, signed in", "authenticated", principal([]), "allow"],
    ["permission held", { permission: diag }, principal([diag]), "allow"],
    ["permission missing", { permission: diag }, principal([]), "forbidden"],
    ["permission, anonymous", { permission: diag }, null, "unauthenticated"],
    ["anyOf, one held", { anyOf: [reserved, diag] }, principal([diag]), "allow"],
    ["anyOf, none held", { anyOf: [reserved, diag] }, principal([]), "forbidden"],
    ["anyOf, empty list", { anyOf: [] }, principal([diag]), "forbidden"],
    ["reserved, bypass", { permission: reserved }, principal([], true), "allow"],
    ["internal, no token", "internal", principal([], true), "unauthenticated"],
    ["missing access, signed in", undefined, principal([diag]), "forbidden"],
    ["missing access, anonymous", undefined, null, "forbidden"],
    [
      "unknown access shape",
      { nonsense: true } as unknown as Access,
      principal([diag]),
      "forbidden",
    ],
  ];

  it.each(cases)("%s → %s", (_label, access, who, expected) => {
    expect(checkAccess(access, who)).toBe(expected);
  });
});

describe("assertCan()", () => {
  it("returns quietly when allowed and throws FORBIDDEN with the code only in the log context", () => {
    expect(() => assertCan(principal([diag]), diag)).not.toThrow();
    try {
      assertCan(principal([]), diag);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("FORBIDDEN");
      expect((error as AppError).publicMessage).not.toContain(diag);
      expect((error as AppError).logContext).toMatchObject({ permission: diag });
    }
  });

  it("throws UNAUTHENTICATED without a principal", () => {
    expect(() => assertCan(null, diag)).toThrow(
      expect.objectContaining({ code: "UNAUTHENTICATED" }),
    );
  });
});

describe("checkAccess() internal", () => {
  it("allows an internal route only when the service token was verified", () => {
    expect(checkAccess("internal", null, { internalAuthorized: true })).toBe("allow");
    expect(checkAccess("internal", null, { internalAuthorized: false })).toBe("unauthenticated");
  });
});
