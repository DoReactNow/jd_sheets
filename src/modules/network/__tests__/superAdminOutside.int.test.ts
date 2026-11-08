// W-301, Decision 57 (amended by Decision 64): Super Admins may sign in from any network and use the
// admin panel there; everyone else needs an
// allowed network (P3-NETSA-01..04).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as networkRoute } from "@/app/api/admin/network/route";
import { POST as signInRoute } from "@/app/api/auth/sign-in/route";
import { GET as meRoute } from "@/app/api/me/route";
import { GET as workbooksRoute } from "@/app/api/workbooks/route";
import { getPrisma } from "@/shared/db/prisma";
import { call, cookieFrom, installRealResolvers } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, TEST_PASSWORD, type TestUser } from "@/tests/setup/users";
import { networkService, setNetworkEnforcementForTests } from "../index";

const INSIDE = "10.1.2.3";
const OUTSIDE = "203.0.113.9";
let superAdmin: TestUser;
let member: TestUser;

beforeEach(async () => {
  await resetWithRoles();
  installRealResolvers();
  await getPrisma().ipRule.create({ data: { cidr: "10.1.0.0/16", label: "Office" } });
  networkService.invalidate();
  setNetworkEnforcementForTests(true);
  superAdmin = await createTestUser({ role: "SUPER_ADMIN", displayName: "Boss" });
  member = await createTestUser({ role: "MEMBER" });
}, 30_000);
afterEach(() => setNetworkEnforcementForTests(null));
afterAll(() => getPrisma().$disconnect());

const signIn = (email: string, ip: string, password = TEST_PASSWORD) =>
  call(signInRoute, { method: "POST", body: { email, password }, ip });
const code = (r: { body: unknown }) => (r.body as { error?: { code: string } } | null)?.error?.code;

describe("Super Admins from any network (Decision 57)", () => {
  it("a Super Admin signs in and works from outside; audited and listed on the Network page (P3-NETSA-01)", async () => {
    const signedIn = await signIn(superAdmin.email, OUTSIDE);
    expect(signedIn.status).toBe(200);
    const cookie = cookieFrom(signedIn)!;
    expect((await call(meRoute, { cookie, ip: OUTSIDE, path: "/api/me" })).status).toBe(200);
    // Decision 64: sheets need an allowed network, even for the Super Admin.
    const sheets = await call(workbooksRoute, { cookie, ip: OUTSIDE, path: "/api/workbooks" });
    expect(code(sheets)).toBe("NETWORK_BLOCKED");
    // Requests are audited at most once per person and address every 10 minutes.
    const events = await getPrisma().auditEvent.findMany({
      where: { action: "network.outsideAccess" },
    });
    expect(events.map((e) => (e.details as { kind: string }).kind).sort()).toEqual([
      "request",
      "sign-in",
    ]);
    const page = await call<{ data: { outsideAccess: Array<{ who: string; ip: string }> } }>(
      networkRoute,
      {
        cookie,
        ip: OUTSIDE,
        path: "/api/admin/network",
      },
    );
    expect(page.body!.data.outsideAccess[0]).toMatchObject({ who: "Boss", ip: OUTSIDE });
  });

  it("anyone else signing in from outside is refused, and no session is kept (P3-NETSA-02)", async () => {
    const refused = await signIn(member.email, OUTSIDE);
    expect(refused.status).toBe(403);
    expect(code(refused)).toBe("NETWORK_BLOCKED");
    expect(cookieFrom(refused)).toBeNull();
    expect(await getPrisma().session.count({ where: { userId: member.id } })).toBe(0);
    expect(
      await getPrisma().auditEvent.count({ where: { action: "auth.sign_in_refused_network" } }),
    ).toBe(1);
    // The same person inside the office signs in as usual.
    expect((await signIn(member.email, INSIDE)).status).toBe(200);
  });

  it("from outside, the API needs a Super Admin session (P3-NETSA-03)", async () => {
    const memberCookie = cookieFrom(await signIn(member.email, INSIDE))!;
    for (const cookie of [undefined, memberCookie]) {
      const result = await call(workbooksRoute, { cookie, ip: OUTSIDE });
      expect(result.status).toBe(403);
      expect(code(result)).toBe("NETWORK_BLOCKED");
    }
  });

  it("sign-in limits and lockout still apply from outside (P3-NETSA-04)", async () => {
    for (let i = 0; i < 5; i++) await signIn(superAdmin.email, OUTSIDE, "wrong-password-1!");
    const locked = await signIn(superAdmin.email, OUTSIDE);
    expect(code(locked)).toBe("RATE_LIMITED");
  });
});
