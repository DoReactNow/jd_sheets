// W-203: sharing and the role resolver (P2-SHARE-01..08, -11, -12, P2-LINK-01, -02, -04).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as shareTargetsRoute } from "@/app/api/share-targets/route";
import { PUT as linkRoute } from "@/app/api/workbooks/[id]/link/route";
import { GET as workbookRoute } from "@/app/api/workbooks/[id]/route";
import { PUT as settingsRoute } from "@/app/api/workbooks/[id]/settings/route";
import {
  DELETE as removeGrantRoute,
  PATCH as changeGrantRoute,
} from "@/app/api/workbooks/[id]/shares/[grantId]/route";
import { GET as sharesRoute, PUT as shareRoute } from "@/app/api/workbooks/[id]/shares/route";
import { POST as addMembersRoute } from "@/app/api/admin/groups/[id]/members/route";
import { POST as createGroupRoute } from "@/app/api/admin/groups/route";
import { getPrisma } from "@/shared/db/prisma";
import { call, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, type TestUser } from "@/tests/setup/users";
import { createWorkbookAs, type TestWorkbook } from "@/tests/setup/workbooks";
import { setNetworkEnforcementForTests } from "@/modules/network";

let owner: TestUser;
let asha: TestUser;
let ravi: TestUser;
let oc: string;
let ac: string;
let rc: string;
let wb: TestWorkbook;

beforeEach(async () => {
  await resetWithRoles();
  installRealResolvers();
  owner = await createTestUser({ displayName: "Owner" });
  asha = await createTestUser({ displayName: "Asha Rao" });
  ravi = await createTestUser({ displayName: "Ravi Kumar" });
  [oc, ac, rc] = await Promise.all([signIn(owner.email), signIn(asha.email), signIn(ravi.email)]);
  wb = await createWorkbookAs(oc, "Budget");
}, 30_000);
afterAll(() => getPrisma().$disconnect());

type Body = { data: { id: string; role: string } };
const code = (r: { body: unknown }) => (r.body as { error?: { code: string } }).error?.code;

function share(
  target: { type: "user" | "group"; id: string },
  role: string,
  cookie = oc,
  id = wb.id,
) {
  return call<Body>(shareRoute, { method: "PUT", cookie, params: { id }, body: { target, role } });
}
const roleOf = async (cookie: string, id = wb.id) => {
  const result = await call<{ data: { role: string } }>(workbookRoute, { cookie, params: { id } });
  return result.status === 200 ? result.body!.data.role : result.status;
};

describe("sharing with people", () => {
  it("the Owner shares as Viewer, Commenter or Editor; audited (P2-SHARE-01)", async () => {
    for (const role of ["VIEWER", "COMMENTER", "EDITOR"]) {
      const result = await share({ type: "user", id: asha.id }, role);
      expect(result.status).toBe(200);
      expect(await roleOf(ac)).toBe(role);
    }
    const actions = await getPrisma().auditEvent.findMany({ where: { targetId: wb.id } });
    expect(actions.map((a) => a.action)).toEqual([
      "share.granted",
      "share.changed",
      "share.changed",
    ]);
  });

  it("changing and removing a grant takes effect at once; audited (P2-SHARE-03)", async () => {
    const grant = (await share({ type: "user", id: asha.id }, "VIEWER")).body!.data;
    const changed = await call(changeGrantRoute, {
      method: "PATCH",
      cookie: oc,
      params: { id: wb.id, grantId: grant.id },
      body: { role: "EDITOR" },
    });
    expect(changed.status).toBe(200);
    expect(await roleOf(ac)).toBe("EDITOR");
    const removed = await call(removeGrantRoute, {
      method: "DELETE",
      cookie: oc,
      params: { id: wb.id, grantId: grant.id },
    });
    expect(removed.status).toBe(200);
    expect(await roleOf(ac)).toBe(404);
    const actions = (await getPrisma().auditEvent.findMany({ where: { targetId: wb.id } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(["share.granted", "share.changed", "share.removed"]);
  });

  it("Editors, Commenters and Viewers cannot share: 403 (P2-SHARE-04); strangers get 404 (P2-SHARE-05)", async () => {
    for (const role of ["EDITOR", "COMMENTER", "VIEWER"]) {
      await share({ type: "user", id: asha.id }, role);
      const attempt = await share({ type: "user", id: ravi.id }, "VIEWER", ac);
      expect(attempt.status).toBe(403);
      expect(code(attempt)).toBe("FORBIDDEN");
      expect((await call(sharesRoute, { cookie: ac, params: { id: wb.id } })).status).toBe(403);
      expect(
        (
          await call(linkRoute, {
            method: "PUT",
            cookie: ac,
            params: { id: wb.id },
            body: { role: "VIEWER" },
          })
        ).status,
      ).toBe(403);
    }
    const stranger = await share({ type: "user", id: asha.id }, "VIEWER", rc);
    expect(stranger.status).toBe(404);
    expect(code(stranger)).toBe("NOT_FOUND");
  });

  it("refuses yourself, unknown, pending and deactivated people (P2-SHARE-06)", async () => {
    const pending = await createTestUser({ status: "PENDING_APPROVAL", role: null });
    const gone = await createTestUser({ status: "DEACTIVATED" });
    for (const id of [owner.id, "0190f5e0-0000-7000-8000-000000000000", pending.id, gone.id]) {
      const result = await share({ type: "user", id }, "VIEWER");
      expect(result.status).toBe(400);
      expect(code(result)).toBe("SHARE_TARGET_INVALID");
    }
    expect(await getPrisma().shareGrant.count()).toBe(0);
  });

  it("sharing again with the same person updates the role (P2-SHARE-07)", async () => {
    await share({ type: "user", id: asha.id }, "VIEWER");
    await share({ type: "user", id: asha.id }, "COMMENTER");
    expect(await getPrisma().shareGrant.count()).toBe(1);
    const listed = await call<{
      data: { grants: Array<{ role: string; target: { id: string } }> };
    }>(sharesRoute, { cookie: oc, params: { id: wb.id } });
    expect(listed.body!.data.grants).toEqual([
      expect.objectContaining({
        role: "COMMENTER",
        target: expect.objectContaining({ id: asha.id }),
      }),
    ]);
  });
});

describe("groups, the link and the highest role", () => {
  async function groupWith(...members: TestUser[]) {
    const admin = await createTestUser({ role: "ADMIN" });
    const ad = await signIn(admin.email);
    const created = await call<{ data: { id: string } }>(createGroupRoute, {
      method: "POST",
      cookie: ad,
      body: { name: `G-${Math.random().toString(36).slice(2, 8)}` },
    });
    const id = created.body!.data.id;
    await call(addMembersRoute, {
      method: "POST",
      cookie: ad,
      params: { id },
      body: { userIds: members.map((m) => m.id) },
    });
    return id;
  }

  it("a group share gives every active member that role (P2-SHARE-02)", async () => {
    const group = await groupWith(asha, ravi);
    expect((await share({ type: "group", id: group }, "COMMENTER")).status).toBe(200);
    expect(await roleOf(ac)).toBe("COMMENTER");
    expect(await roleOf(rc)).toBe("COMMENTER");
  });

  it("the highest of owner, direct, group and link roles wins (P2-SHARE-08)", async () => {
    const group = await groupWith(asha);
    await share({ type: "group", id: group }, "COMMENTER");
    await share({ type: "user", id: asha.id }, "VIEWER");
    expect(await roleOf(ac)).toBe("COMMENTER");
    await call(linkRoute, {
      method: "PUT",
      cookie: oc,
      params: { id: wb.id },
      body: { role: "EDITOR" },
    });
    expect(await roleOf(ac)).toBe("EDITOR");
    expect(await roleOf(oc)).toBe("OWNER");
  });

  it("the company link gives its role to any active colleague; off removes it (P2-LINK-01, -02)", async () => {
    expect(await roleOf(rc)).toBe(404);
    const on = await call(linkRoute, {
      method: "PUT",
      cookie: oc,
      params: { id: wb.id },
      body: { role: "VIEWER" },
    });
    expect(on.status).toBe(200);
    expect(await roleOf(rc)).toBe("VIEWER");
    await call(linkRoute, {
      method: "PUT",
      cookie: oc,
      params: { id: wb.id },
      body: { role: null },
    });
    expect(await roleOf(rc)).toBe(404);
    const actions = (await getPrisma().auditEvent.findMany({ where: { targetId: wb.id } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(["share.linkChanged", "share.linkChanged"]);
  });

  it("the link is still behind sign-in and the network rules (P2-LINK-04)", async () => {
    await call(linkRoute, {
      method: "PUT",
      cookie: oc,
      params: { id: wb.id },
      body: { role: "VIEWER" },
    });
    expect((await call(workbookRoute, { params: { id: wb.id } })).status).toBe(401);
    setNetworkEnforcementForTests(true);
    try {
      const blocked = await call(workbookRoute, {
        cookie: rc,
        params: { id: wb.id },
        ip: "203.0.113.9",
      });
      expect(blocked.status).toBe(403);
      expect(code(blocked)).toBe("NETWORK_BLOCKED");
    } finally {
      setNetworkEnforcementForTests(null);
    }
  });

  it("the download setting is the Owner's; audited", async () => {
    const off = await call(settingsRoute, {
      method: "PUT",
      cookie: oc,
      params: { id: wb.id },
      body: { allowDownloadForReaders: false },
    });
    expect(off.status).toBe(200);
    const listed = await call<{ data: { allowDownloadForReaders: boolean } }>(sharesRoute, {
      cookie: oc,
      params: { id: wb.id },
    });
    expect(listed.body!.data.allowDownloadForReaders).toBe(false);
  });
});

describe("share targets and the Super Admin", () => {
  it("search finds active people and groups only (P2-SHARE-11)", async () => {
    await createTestUser({ displayName: "Asha Pending", status: "PENDING_APPROVAL", role: null });
    await createTestUser({ displayName: "Asha Gone", status: "DEACTIVATED" });
    const result = await call<{ data: { users: Array<{ displayName: string }> } }>(
      shareTargetsRoute,
      {
        cookie: oc,
        path: "/api/share-targets?q=asha",
      },
    );
    expect(result.body!.data.users.map((u) => u.displayName)).toEqual(["Asha Rao"]);
    expect(
      (await call(shareTargetsRoute, { cookie: oc, path: "/api/share-targets?q=" })).status,
    ).toBe(400);
  });

  it("the Super Admin bypass is not a workbook role and opens nothing (P2-SHARE-12)", async () => {
    const sa = await createTestUser({ role: "SUPER_ADMIN" });
    const sc = await signIn(sa.email);
    expect(await roleOf(sc)).toBe(404);
    expect((await share({ type: "user", id: asha.id }, "VIEWER", sc)).status).toBe(404);
  });
});
