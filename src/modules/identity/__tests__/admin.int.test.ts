// Approvals, user administration, resets, Super Admin protections and the recovery command:
// P1-APPROVE-01..07, -11, P1-USERS-01..07, P1-SA-01..04, P1-RESET-01..06.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as approveRoute } from "@/app/api/admin/approvals/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/admin/approvals/[id]/reject/route";
import { GET as countRoute } from "@/app/api/admin/approvals/count/route";
import { GET as pendingRoute } from "@/app/api/admin/approvals/route";
import { POST as deactivateRoute } from "@/app/api/admin/users/[id]/deactivate/route";
import { POST as reactivateRoute } from "@/app/api/admin/users/[id]/reactivate/route";
import { POST as resetRoute } from "@/app/api/admin/users/[id]/reset-password/route";
import { PATCH as updateRoute } from "@/app/api/admin/users/[id]/route";
import { GET as usersRoute, POST as createRoute } from "@/app/api/admin/users/route";
import { POST as signInRoute } from "@/app/api/auth/sign-in/route";
import { GET as meRoute } from "@/app/api/me/route";
import { getPrisma } from "@/shared/db/prisma";
import { call, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, TEST_PASSWORD, type TestUser } from "@/tests/setup/users";
import { resetSuperAdminPassword } from "../identity.cli";

let superAdmin: TestUser;
let admin: TestUser;
let member: TestUser;
let sa: string;
let ad: string;
let me: string;

beforeEach(async () => {
  await resetWithRoles();
  installRealResolvers();
  superAdmin = await createTestUser({ role: "SUPER_ADMIN" });
  admin = await createTestUser({ role: "ADMIN" });
  member = await createTestUser({ role: "MEMBER" });
  [sa, ad, me] = await Promise.all([
    signIn(superAdmin.email),
    signIn(admin.email),
    signIn(member.email),
  ]);
}, 30_000);
afterAll(() => getPrisma().$disconnect());

const id = (user: { id: string }) => ({ id: user.id });
const statusOf = async (userId: string) =>
  (await getPrisma().user.findUniqueOrThrow({ where: { id: userId } })).status;
const audits = (action: string) => getPrisma().auditEvent.count({ where: { action } });

describe("approval queue (P1-APPROVE)", () => {
  it("lists pending people oldest first with the rejected-before mark, and counts them (P1-APPROVE-01, -11)", async () => {
    const older = await createTestUser({
      role: null,
      status: "PENDING_APPROVAL",
      displayName: "Older",
    });
    await createTestUser({ role: null, status: "PENDING_APPROVAL", displayName: "Newer" });
    await getPrisma().user.update({ where: { id: older.id }, data: { rejectedBefore: true } });
    const list = await call<{
      data: { users: Array<{ displayName: string; rejectedBefore: boolean }> };
    }>(pendingRoute, { cookie: ad });
    expect(list.body!.data.users.map((u) => u.displayName)).toEqual(["Older", "Newer"]);
    expect(list.body!.data.users[0].rejectedBefore).toBe(true);
    expect((await call(countRoute, { cookie: ad })).body).toEqual({ data: { count: 2 } });
  });

  it("approves with a role, once; a second decision is a conflict (P1-APPROVE-02, -06, -07)", async () => {
    const pending = await createTestUser({ role: null, status: "PENDING_APPROVAL" });
    const first = await call(approveRoute, {
      method: "POST",
      cookie: ad,
      params: id(pending),
      body: { role: "MEMBER" },
    });
    expect(first.status).toBe(200);
    expect(await statusOf(pending.id)).toBe("ACTIVE");
    expect(
      (
        await call(approveRoute, {
          method: "POST",
          cookie: ad,
          params: id(pending),
          body: { role: "MEMBER" },
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(rejectRoute, { method: "POST", cookie: ad, params: id(pending) })).status,
    ).toBe(409);
    expect(await audits("user.approved")).toBe(1);
    expect(
      (
        await call(signInRoute, {
          method: "POST",
          body: { email: pending.email, password: TEST_PASSWORD },
        })
      ).status,
    ).toBe(200);
  });

  it("rejects; simultaneous decisions leave exactly one (P1-APPROVE-03, -06)", async () => {
    const pending = await createTestUser({ role: null, status: "PENDING_APPROVAL" });
    const results = await Promise.all([
      call(approveRoute, {
        method: "POST",
        cookie: ad,
        params: id(pending),
        body: { role: "MEMBER" },
      }),
      call(rejectRoute, { method: "POST", cookie: sa, params: id(pending) }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(["ACTIVE", "REJECTED"]).toContain(await statusOf(pending.id));
  });

  it("a Member cannot see or decide; an Admin cannot approve as Super Admin (P1-APPROVE-04, -05)", async () => {
    const pending = await createTestUser({ role: null, status: "PENDING_APPROVAL" });
    expect((await call(pendingRoute, { cookie: me })).status).toBe(403);
    expect(
      (
        await call(approveRoute, {
          method: "POST",
          cookie: me,
          params: id(pending),
          body: { role: "MEMBER" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(approveRoute, {
          method: "POST",
          cookie: ad,
          params: id(pending),
          body: { role: "SUPER_ADMIN" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(approveRoute, {
          method: "POST",
          cookie: sa,
          params: id(pending),
          body: { role: "SUPER_ADMIN" },
        })
      ).status,
    ).toBe(200);
  });
});

describe("users (P1-USERS)", () => {
  it("an admin creates an account with a temporary password the person must change (P1-USERS-01)", async () => {
    const result = await call<{
      data: {
        user: { id: string; status: string; mustChangePassword: boolean };
        temporaryPassword: string;
      };
    }>(createRoute, {
      method: "POST",
      cookie: ad,
      body: { email: "Meera.Test@JDFusion.in", displayName: "Meera", role: "MEMBER" },
    });
    expect(result.status).toBe(201);
    expect(result.body!.data.user).toMatchObject({ status: "ACTIVE", mustChangePassword: true });
    const signedIn = await call(signInRoute, {
      method: "POST",
      body: { email: "meera.test@jdfusion.in", password: result.body!.data.temporaryPassword },
    });
    expect(signedIn.body).toMatchObject({ data: { mustChangePassword: true } });
  });

  it("refuses an existing email, another domain and a Super Admin made by an Admin (P1-USERS-02, P1-DOMAIN-07, P1-SA-02)", async () => {
    expect(
      (
        await call(createRoute, {
          method: "POST",
          cookie: ad,
          body: { email: member.email, displayName: "X", role: "MEMBER" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(createRoute, {
          method: "POST",
          cookie: ad,
          body: { email: "x@gmail.com", displayName: "X", role: "MEMBER" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(createRoute, {
          method: "POST",
          cookie: ad,
          body: { email: "boss.test@jdfusion.in", displayName: "X", role: "SUPER_ADMIN" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(createRoute, {
          method: "POST",
          cookie: sa,
          body: { email: "boss.test@jdfusion.in", displayName: "X", role: "SUPER_ADMIN" },
        })
      ).status,
    ).toBe(201);
  });

  it("lists with status and role filters and search (P1-USERS-03)", async () => {
    await createTestUser({ role: "MEMBER", displayName: "Priya Kumar" });
    await createTestUser({ role: null, status: "PENDING_APPROVAL", displayName: "Pending Person" });
    const byName = await call<{ data: { users: Array<{ displayName: string }> } }>(usersRoute, {
      cookie: ad,
      path: "/api/admin/users?q=priya",
    });
    expect(byName.body!.data.users.map((u) => u.displayName)).toEqual(["Priya Kumar"]);
    const pending = await call<{ data: { users: unknown[] } }>(usersRoute, {
      cookie: ad,
      path: "/api/admin/users?status=PENDING_APPROVAL",
    });
    expect(pending.body!.data.users).toHaveLength(1);
    const admins = await call<{ data: { users: Array<{ id: string }> } }>(usersRoute, {
      cookie: ad,
      path: "/api/admin/users?role=ADMIN",
    });
    expect(admins.body!.data.users.map((u) => u.id)).toEqual([admin.id]);
    expect((await call(usersRoute, { cookie: me })).status).toBe(403);
  });

  it("edits name and role, audited; an Admin cannot touch a Super Admin (P1-USERS-04, P1-SA-02)", async () => {
    const updated = await call(updateRoute, {
      method: "PATCH",
      cookie: ad,
      params: id(member),
      body: { displayName: "Renamed", role: "ADMIN" },
    });
    expect(updated.body).toMatchObject({ data: { displayName: "Renamed", roleKey: "ADMIN" } });
    expect(await audits("user.updated")).toBe(1);
    expect(
      (
        await call(updateRoute, {
          method: "PATCH",
          cookie: ad,
          params: id(superAdmin),
          body: { displayName: "No" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(updateRoute, {
          method: "PATCH",
          cookie: ad,
          params: id(member),
          body: { role: "SUPER_ADMIN" },
        })
      ).status,
    ).toBe(403);
  });

  it("deactivates (signing them out everywhere) and reactivates; not oneself (P1-USERS-05, -06, P1-SESS-07)", async () => {
    expect(
      (await call(deactivateRoute, { method: "POST", cookie: ad, params: id(member) })).status,
    ).toBe(200);
    expect((await call(meRoute, { cookie: me })).status).toBe(401);
    expect(
      (await call(reactivateRoute, { method: "POST", cookie: ad, params: id(member) })).status,
    ).toBe(200);
    expect(await statusOf(member.id)).toBe("ACTIVE");
    expect(
      (await call(deactivateRoute, { method: "POST", cookie: ad, params: id(admin) })).status,
    ).toBe(400);
  });

  it("protects the last active Super Admin (P1-SA-01)", async () => {
    const result = await call(updateRoute, {
      method: "PATCH",
      cookie: sa,
      params: id(superAdmin),
      body: { role: "MEMBER" },
    });
    expect(result.status).toBe(409);
    const second = await createTestUser({ role: "SUPER_ADMIN" });
    expect(
      (await call(deactivateRoute, { method: "POST", cookie: sa, params: id(second) })).status,
    ).toBe(200);
  });

  it("users cannot be deleted: there is no route (P1-USERS-07)", async () => {
    const routes = await import("@/app/api/admin/users/[id]/route");
    expect("DELETE" in routes).toBe(false);
  });
});

describe("password resets (P1-RESET)", () => {
  it("an admin sets a temporary password; the person must change it and is signed out everywhere (P1-RESET-01)", async () => {
    const result = await call<{ data: { temporaryPassword: string } }, { id: string }>(resetRoute, {
      method: "POST",
      cookie: ad,
      params: id(member),
      body: {},
    });
    expect(result.status).toBe(200);
    expect((await call(meRoute, { cookie: me })).status).toBe(401);
    const signedIn = await call(signInRoute, {
      method: "POST",
      body: { email: member.email, password: result.body!.data.temporaryPassword },
    });
    expect(signedIn.body).toMatchObject({ data: { mustChangePassword: true } });
    expect(await audits("user.password_reset")).toBe(1);
  });

  it("Members cannot reset; Admins cannot reset a Super Admin; Super Admins can (P1-RESET-02..04)", async () => {
    expect(
      (await call(resetRoute, { method: "POST", cookie: me, params: id(admin), body: {} })).status,
    ).toBe(403);
    expect(
      (await call(resetRoute, { method: "POST", cookie: ad, params: id(superAdmin), body: {} }))
        .status,
    ).toBe(403);
    const other = await createTestUser({ role: "SUPER_ADMIN" });
    expect(
      (await call(resetRoute, { method: "POST", cookie: sa, params: id(other), body: {} })).status,
    ).toBe(200);
  });

  it("the recovery command resets an active Super Admin only, audited as system (P1-RESET-05, -06)", async () => {
    await resetSuperAdminPassword(superAdmin.email, "recovered password 2027");
    const row = await getPrisma().user.findUniqueOrThrow({ where: { id: superAdmin.id } });
    expect(row.mustChangePassword).toBe(true);
    expect((await call(meRoute, { cookie: sa })).status).toBe(401);
    const event = await getPrisma().auditEvent.findFirstOrThrow({
      where: { action: "user.password_reset", targetId: superAdmin.id },
    });
    expect(event).toMatchObject({ actorId: null, actorKind: "SYSTEM" });
    await expect(resetSuperAdminPassword(admin.email, "recovered password 2027")).rejects.toThrow(
      /not an active Super Admin/,
    );
    await expect(
      resetSuperAdminPassword("nobody.test@jdfusion.in", "recovered password 2027"),
    ).rejects.toThrow();
  });

  it("the bypass does not skip business rules (P1-SA-04)", async () => {
    expect(
      (await call(deactivateRoute, { method: "POST", cookie: sa, params: id(superAdmin) })).status,
    ).toBe(400);
  });
});
