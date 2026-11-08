// Decision 64: outside the allowed networks the Super Admin reaches the admin panel only; no one
// opens sheets; Admins and everyone else are blocked (P4-OUT-01..04).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as adminWorkbooksRoute } from "@/app/api/admin/workbooks/route";
import { GET as approvalsRoute } from "@/app/api/admin/approvals/route";
import { GET as auditRoute } from "@/app/api/admin/audit/route";
import { GET as groupsRoute } from "@/app/api/admin/groups/route";
import { GET as networkRoute } from "@/app/api/admin/network/route";
import { POST as addRuleRoute } from "@/app/api/admin/network/rules/route";
import { GET as usersRoute } from "@/app/api/admin/users/route";
import { POST as signInRoute } from "@/app/api/auth/sign-in/route";
import { GET as diagnosticsRoute } from "@/app/api/diagnostics/route";
import { GET as meRoute } from "@/app/api/me/route";
import { GET as shareTargetsRoute } from "@/app/api/share-targets/route";
import { POST as collabTokenRoute } from "@/app/api/workbooks/[id]/collab-token/route";
import { GET as contentRoute, PUT as saveRoute } from "@/app/api/workbooks/[id]/content/route";
import { GET as downloadRoute } from "@/app/api/workbooks/[id]/download/route";
import { POST as leaseRoute } from "@/app/api/workbooks/[id]/lease/route";
import { GET as workbookRoute } from "@/app/api/workbooks/[id]/route";
import { GET as versionsRoute } from "@/app/api/workbooks/[id]/versions/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/workbooks/route";
import { getPrisma } from "@/shared/db/prisma";
import { call, cookieFrom, installRealResolvers } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, TEST_PASSWORD, type TestUser } from "@/tests/setup/users";
import { networkService, setNetworkEnforcementForTests } from "../index";

const INSIDE = "10.1.2.3";
const OUTSIDE = "203.0.113.9";
let superAdmin: TestUser;
let admin: TestUser;
let workbookId: string;

beforeEach(async () => {
  await resetWithRoles();
  installRealResolvers();
  await getPrisma().ipRule.create({ data: { cidr: "10.1.0.0/16", label: "Office" } });
  networkService.invalidate();
  setNetworkEnforcementForTests(true);
  superAdmin = await createTestUser({ role: "SUPER_ADMIN", displayName: "Boss" });
  admin = await createTestUser({ role: "ADMIN", displayName: "Office admin" });
  const cookie = await signInAt(superAdmin, INSIDE);
  const created = await call<{ data: { id: string } }>(createRoute, {
    method: "POST",
    path: "/api/workbooks",
    cookie,
    ip: INSIDE,
    body: { title: "Inside only" },
  });
  expect(created.status).toBe(201);
  workbookId = created.body!.data.id;
}, 30_000);
afterEach(() => setNetworkEnforcementForTests(null));
afterAll(() => getPrisma().$disconnect());

async function signInAt(user: TestUser, ip: string) {
  const result = await call(signInRoute, {
    method: "POST",
    path: "/api/auth/sign-in",
    body: { email: user.email, password: TEST_PASSWORD },
    ip,
  });
  return cookieFrom(result)!;
}
const code = (r: { body: unknown }) => (r.body as { error?: { code: string } } | null)?.error?.code;

describe("outside the offices (Decision 64)", () => {
  it("the Super Admin reaches every admin-panel API (P4-OUT-01)", async () => {
    const cookie = await signInAt(superAdmin, OUTSIDE);
    const routes = [
      [meRoute, "/api/me"],
      [approvalsRoute, "/api/admin/approvals"],
      [usersRoute, "/api/admin/users"],
      [networkRoute, "/api/admin/network"],
      [groupsRoute, "/api/admin/groups"],
      [auditRoute, "/api/admin/audit"],
      [diagnosticsRoute, "/api/diagnostics"],
    ] as const;
    for (const [handler, path] of routes) {
      const result = await call(handler, { cookie, ip: OUTSIDE, path });
      expect({ path, status: result.status }).toEqual({ path, status: 200 });
    }
  });

  it("the Super Admin is refused every sheet API (P4-OUT-02)", async () => {
    const cookie = await signInAt(superAdmin, OUTSIDE);
    const params = { id: workbookId };
    const base = `/api/workbooks/${workbookId}`;
    const attempts = [
      call(listRoute, { cookie, ip: OUTSIDE, path: "/api/workbooks" }),
      call(createRoute, {
        method: "POST",
        path: "/api/workbooks",
        cookie,
        ip: OUTSIDE,
        body: { title: "From home" },
      }),
      call(workbookRoute, { cookie, ip: OUTSIDE, path: base, params }),
      call(contentRoute, { cookie, ip: OUTSIDE, path: `${base}/content`, params }),
      call(saveRoute, {
        method: "PUT",
        cookie,
        ip: OUTSIDE,
        path: `${base}/content`,
        params,
      }),
      call(versionsRoute, { cookie, ip: OUTSIDE, path: `${base}/versions`, params }),
      call(downloadRoute, { cookie, ip: OUTSIDE, path: `${base}/download`, params }),
      call(leaseRoute, {
        method: "POST",
        cookie,
        ip: OUTSIDE,
        path: `${base}/lease`,
        params,
        body: { tabId: "t1" },
      }),
      call(collabTokenRoute, {
        method: "POST",
        cookie,
        ip: OUTSIDE,
        path: `${base}/collab-token`,
        params,
      }),
      call(shareTargetsRoute, { cookie, ip: OUTSIDE, path: "/api/share-targets" }),
      call(adminWorkbooksRoute, { cookie, ip: OUTSIDE, path: "/api/admin/workbooks" }),
    ];
    for (const result of await Promise.all(attempts)) {
      expect(result.status).toBe(403);
      expect(code(result)).toBe("NETWORK_BLOCKED");
    }
  });

  it("an Admin is blocked outside: no sign-in, and an office session does not work there (P4-OUT-03)", async () => {
    const refused = await call(signInRoute, {
      method: "POST",
      path: "/api/auth/sign-in",
      body: { email: admin.email, password: TEST_PASSWORD },
      ip: OUTSIDE,
    });
    expect(code(refused)).toBe("NETWORK_BLOCKED");
    expect(cookieFrom(refused)).toBeNull();
    const cookie = await signInAt(admin, INSIDE);
    for (const [handler, path] of [
      [usersRoute, "/api/admin/users"],
      [networkRoute, "/api/admin/network"],
      [meRoute, "/api/me"],
      [listRoute, "/api/workbooks"],
    ] as const) {
      expect(code(await call(handler, { cookie, ip: OUTSIDE, path }))).toBe("NETWORK_BLOCKED");
    }
  });

  it("a Super Admin outside adds their address, and from then on sheets open there (P4-OUT-04)", async () => {
    const cookie = await signInAt(superAdmin, OUTSIDE);
    const added = await call(addRuleRoute, {
      method: "POST",
      path: "/api/admin/network/rules",
      cookie,
      ip: OUTSIDE,
      body: { cidr: `${OUTSIDE}/32`, label: "Home office" },
    });
    expect(added.status).toBe(201);
    networkService.invalidate();
    const list = await call(listRoute, { cookie, ip: OUTSIDE, path: "/api/workbooks" });
    expect(list.status).toBe(200);
  });
});
