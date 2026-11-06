// P1-SEED-03, X-ACCESS-07: the role sync is idempotent, never removes grants, and a change applies
// on the very next request.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listUsers } from "@/app/api/admin/users/route";
import { getPrisma } from "@/shared/db/prisma";
import { DEFAULT_ROLES } from "@/shared/rbac/defaultRoles";
import { call, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles } from "@/tests/setup/users";
import { syncRbac } from "../identity.rbac";

beforeEach(async () => {
  await resetWithRoles();
  installRealResolvers();
});
afterAll(() => getPrisma().$disconnect());

describe("db:sync-rbac", () => {
  it("writes every system role with its default grants, and running it again changes nothing", async () => {
    const roles = await getPrisma().role.findMany({ include: { permissions: true } });
    expect(roles.map((r) => r.key).sort()).toEqual(["ADMIN", "MEMBER", "SUPER_ADMIN"]);
    const admin = roles.find((r) => r.key === "ADMIN")!;
    expect(admin.permissions.map((p) => p.permission).sort()).toEqual(
      [...DEFAULT_ROLES.ADMIN.permissions].sort(),
    );
    expect(await syncRbac()).toEqual({ rolesCreated: [], grantsAdded: 0 });
  });

  it("never removes or overwrites a grant edited in the database", async () => {
    const member = await getPrisma().role.findUniqueOrThrow({ where: { key: "MEMBER" } });
    await getPrisma().rolePermission.create({
      data: { roleId: member.id, permission: "audit:view", source: "EDITED" },
    });
    await syncRbac();
    const grants = await getPrisma().rolePermission.findMany({ where: { roleId: member.id } });
    expect(grants.find((g) => g.permission === "audit:view")?.source).toBe("EDITED");
    expect(grants.some((g) => g.permission === "workbooks:create")).toBe(true);
  });
});

describe("permissions apply on the next request (X-ACCESS-07)", () => {
  it("a grant removed from a role stops working immediately", async () => {
    const admin = await createTestUser({ role: "ADMIN" });
    const cookie = await signIn(admin.email);
    expect((await call(listUsers, { cookie })).status).toBe(200);
    const role = await getPrisma().role.findUniqueOrThrow({ where: { key: "ADMIN" } });
    await getPrisma().rolePermission.delete({
      where: { roleId_permission: { roleId: role.id, permission: "users:view" } },
    });
    const refused = await call(listUsers, { cookie });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).not.toContain("users:view");
  });
});
