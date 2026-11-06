import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, SYSTEM_ROLE_CODES } from "../defaultRoles";
import { PERMISSION_CODES, PERMISSIONS, RESERVED_PERMISSION_CODES } from "../permissionRegistry";

describe("permission registry", () => {
  it("has unique resource:action codes, each with a label, description and module", () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    for (const code of PERMISSION_CODES) {
      expect(code).toMatch(/^[a-z]+(-[a-z]+)*:[a-z]+(-[a-z]+)*$/);
      const entry = PERMISSIONS[code];
      expect(entry.label.trim().length, code).toBeGreaterThan(0);
      expect(entry.description.trim().length, code).toBeGreaterThan(0);
      expect(entry.module, code).toMatch(/^[a-z]+$/);
    }
  });

  it("registers the catalogue of project_data.md Section 5.4", () => {
    expect([...PERMISSION_CODES].sort()).toEqual(
      [
        "audit:view",
        "groups:manage",
        "network:manage",
        "network:view",
        "roles:manage",
        "system:diagnostics",
        "users:approve",
        "users:create",
        "users:deactivate",
        "users:edit",
        "users:manage-super-admins",
        "users:reset-password",
        "users:view",
        "workbooks:administer",
        "workbooks:create",
      ].sort(),
    );
  });

  it("reserves exactly roles:manage and users:manage-super-admins", () => {
    expect([...RESERVED_PERMISSION_CODES].sort()).toEqual([
      "roles:manage",
      "users:manage-super-admins",
    ]);
  });
});

describe("default roles", () => {
  it("defines the three system roles", () => {
    expect([...SYSTEM_ROLE_CODES].sort()).toEqual(["ADMIN", "MEMBER", "SUPER_ADMIN"]);
  });

  it("references only registered, non-reserved codes", () => {
    for (const code of SYSTEM_ROLE_CODES) {
      for (const permission of DEFAULT_ROLES[code].permissions) {
        expect(PERMISSION_CODES, `${code} -> ${permission}`).toContain(permission);
        expect(RESERVED_PERMISSION_CODES, `${code} -> ${permission}`).not.toContain(permission);
      }
    }
  });

  it("gives SUPER_ADMIN the bypass and an empty bundle, and nobody else the bypass", () => {
    expect(DEFAULT_ROLES.SUPER_ADMIN.bypassesAccess).toBe(true);
    expect(DEFAULT_ROLES.SUPER_ADMIN.permissions).toEqual([]);
    for (const code of ["ADMIN", "MEMBER"] as const) {
      expect(DEFAULT_ROLES[code].bypassesAccess).toBe(false);
    }
  });

  it("gives MEMBER only workbook creation, and keeps network:manage and diagnostics for the bypass", () => {
    expect(DEFAULT_ROLES.MEMBER.permissions).toEqual(["workbooks:create"]);
    expect(DEFAULT_ROLES.ADMIN.permissions).not.toContain("network:manage");
    expect(DEFAULT_ROLES.ADMIN.permissions).not.toContain("workbooks:administer");
    expect(DEFAULT_ROLES.ADMIN.permissions).not.toContain("system:diagnostics");
  });
});
