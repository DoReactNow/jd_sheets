// The audit trail screen: P1-AUDIT-01..05, X-DATA-02.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as auditRoute } from "@/app/api/admin/audit/route";
import { POST as passwordRoute } from "@/app/api/auth/password/route";
import { getPrisma } from "@/shared/db/prisma";
import { parseInstant } from "@/shared/time";
import { call, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, TEST_PASSWORD } from "@/tests/setup/users";

beforeEach(async () => {
  await resetWithRoles();
  installRealResolvers();
});
afterAll(() => getPrisma().$disconnect());

type AuditPage = {
  data: {
    events: Array<{ action: string; actor: { id: string } | null; details: object; at: string }>;
    actions: string[];
  };
};

describe("audit trail (P1-AUDIT)", () => {
  it("records sign-ins and password changes, without secrets (P1-AUDIT-01, -02)", async () => {
    const admin = await createTestUser({ role: "ADMIN" });
    const cookie = await signIn(admin.email);
    await call(passwordRoute, {
      method: "POST",
      cookie,
      body: { currentPassword: TEST_PASSWORD, newPassword: "another fine password" },
    });
    const page = await call<AuditPage>(auditRoute, { cookie });
    const actions = page.body!.data.events.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["auth.signed_in", "user.password_changed"]));
    const raw = JSON.stringify(await getPrisma().auditEvent.findMany());
    expect(raw).not.toContain(TEST_PASSWORD);
    expect(raw).not.toContain("another fine password");
    expect(raw).not.toMatch(/jds_session|\$argon2/);
  });

  it("filters by actor, action and Kolkata days, with the day boundary right (P1-AUDIT-03, -04)", async () => {
    const admin = await createTestUser({ role: "ADMIN" });
    const other = await createTestUser({ role: "MEMBER" });
    const at = (iso: string, action: string, actorId: string) =>
      getPrisma().auditEvent.create({
        data: { action, targetType: "x", actorId, actorKind: "USER", createdAt: parseInstant(iso) },
      });
    // 23:59 and 00:01 Kolkata time (UTC+5:30) on either side of 2027-01-06.
    await at("2027-01-05T18:29:00Z", "probe.before", other.id);
    await at("2027-01-05T18:31:00Z", "probe.after", other.id);
    const cookie = await signIn(admin.email);
    const day6 = await call<AuditPage>(auditRoute, {
      cookie,
      path: "/api/admin/audit?from=2027-01-06&to=2027-01-06",
    });
    expect(day6.body!.data.events.map((e) => e.action)).toEqual(["probe.after"]);
    const day5 = await call<AuditPage>(auditRoute, {
      cookie,
      path: "/api/admin/audit?from=2027-01-05&to=2027-01-05",
    });
    expect(day5.body!.data.events.map((e) => e.action)).toEqual(["probe.before"]);
    const byActor = await call<AuditPage>(auditRoute, {
      cookie,
      path: `/api/admin/audit?actorId=${other.id}`,
    });
    expect(byActor.body!.data.events.every((e) => e.actor?.id === other.id)).toBe(true);
    const byAction = await call<AuditPage>(auditRoute, {
      cookie,
      path: "/api/admin/audit?action=probe.after",
    });
    expect(byAction.body!.data.events).toHaveLength(1);
    expect(
      (await call(auditRoute, { cookie, path: "/api/admin/audit?from=06-01-2027" })).status,
    ).toBe(400);
  });

  it("only audit:view may look (P1-AUDIT-05)", async () => {
    const member = await createTestUser({ role: "MEMBER" });
    expect((await call(auditRoute, { cookie: await signIn(member.email) })).status).toBe(403);
  });
});
