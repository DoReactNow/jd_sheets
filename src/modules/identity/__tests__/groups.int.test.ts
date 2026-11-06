// W-202: groups (P2-GROUP-01..05), with the real session, permissions and database.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as removeMemberRoute } from "@/app/api/admin/groups/[id]/members/[userId]/route";
import { POST as addMembersRoute } from "@/app/api/admin/groups/[id]/members/route";
import {
  DELETE as deleteRoute,
  GET as getRoute,
  PATCH as renameRoute,
} from "@/app/api/admin/groups/[id]/route";
import { GET as listRoute, POST as createRoute } from "@/app/api/admin/groups/route";
import { GET as workbookRoute } from "@/app/api/workbooks/[id]/route";
import { PUT as shareRoute } from "@/app/api/workbooks/[id]/shares/route";
import { getPrisma } from "@/shared/db/prisma";
import { call, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, type TestUser } from "@/tests/setup/users";
import { createWorkbookAs } from "@/tests/setup/workbooks";

let admin: TestUser;
let member: TestUser;
let ad: string;
let me: string;

beforeEach(async () => {
  await resetWithRoles();
  installRealResolvers();
  admin = await createTestUser({ role: "ADMIN" });
  member = await createTestUser({ role: "MEMBER", displayName: "Asha" });
  [ad, me] = await Promise.all([signIn(admin.email), signIn(member.email)]);
}, 30_000);
afterAll(() => getPrisma().$disconnect());

interface Group {
  id: string;
  name: string;
  memberCount: number;
}

async function createGroup(name: string, cookie = ad) {
  return call<{ data: Group }>(createRoute, { method: "POST", cookie, body: { name } });
}

const auditActions = async () =>
  (await getPrisma().auditEvent.findMany({ orderBy: { createdAt: "asc" } })).map((e) => e.action);

describe("groups", () => {
  it("an admin creates, renames, adds and removes members and deletes a group; all audited (P2-GROUP-01)", async () => {
    const created = await createGroup("Finance");
    expect(created.status).toBe(201);
    const id = created.body!.data.id;

    const renamed = await call<{ data: Group }>(renameRoute, {
      method: "PATCH",
      cookie: ad,
      params: { id },
      body: { name: "Finance team" },
    });
    expect(renamed.body!.data.name).toBe("Finance team");

    const added = await call(addMembersRoute, {
      method: "POST",
      cookie: ad,
      params: { id },
      body: { userIds: [member.id, admin.id] },
    });
    expect(added.status).toBe(200);
    const detail = await call<{ data: { members: Array<{ id: string }> } }>(getRoute, {
      cookie: ad,
      params: { id },
    });
    expect(detail.body!.data.members.map((m) => m.id).sort()).toEqual([admin.id, member.id].sort());

    const removed = await call(removeMemberRoute, {
      method: "DELETE",
      cookie: ad,
      params: { id, userId: admin.id },
    });
    expect(removed.status).toBe(200);
    const list = await call<{ data: { groups: Group[] } }>(listRoute, { cookie: ad });
    expect(list.body!.data.groups[0]).toMatchObject({ name: "Finance team", memberCount: 1 });

    expect((await call(deleteRoute, { method: "DELETE", cookie: ad, params: { id } })).status).toBe(
      200,
    );
    expect(await auditActions()).toEqual(
      expect.arrayContaining([
        "group.created",
        "group.renamed",
        "group.membersAdded",
        "group.memberRemoved",
        "group.deleted",
      ]),
    );
  });

  it("a Member cannot manage groups (403)", async () => {
    expect((await createGroup("Mine", me)).status).toBe(403);
    expect((await call(listRoute, { cookie: me })).status).toBe(403);
  });

  it("names are unique whatever their case and kept as text (P2-GROUP-02)", async () => {
    await createGroup("Finance");
    const again = await createGroup("FINANCE");
    expect(again.status).toBe(409);
    expect((again.body as unknown as { error: { code: string } }).error.code).toBe(
      "GROUP_NAME_TAKEN",
    );
    const html = await createGroup("<b>Ops</b>");
    expect(html.body!.data.name).toBe("<b>Ops</b>");
    expect((await createGroup("   ")).status).toBe(400);
  });

  it("deleting a group used by shares needs confirmation, then removes the shares (P2-GROUP-03)", async () => {
    const id = (await createGroup("Finance")).body!.data.id;
    await call(addMembersRoute, {
      method: "POST",
      cookie: ad,
      params: { id },
      body: { userIds: [member.id] },
    });
    const owner = await createTestUser();
    const oc = await signIn(owner.email);
    const wb = await createWorkbookAs(oc, "Budget");
    await call(shareRoute, {
      method: "PUT",
      cookie: oc,
      params: { id: wb.id },
      body: { target: { type: "group", id }, role: "VIEWER" },
    });

    const detail = await call<{ data: { sharedWorkbooks: Array<{ title: string }> } }>(getRoute, {
      cookie: ad,
      params: { id },
    });
    expect(detail.body!.data.sharedWorkbooks.map((w) => w.title)).toEqual(["Budget"]);

    const refused = await call(deleteRoute, { method: "DELETE", cookie: ad, params: { id } });
    expect(refused.status).toBe(409);
    expect((refused.body as { error: { code: string } }).error.code).toBe("GROUP_IN_USE");
    expect((await call(workbookRoute, { cookie: me, params: { id: wb.id } })).status).toBe(200);

    const confirmed = await call(deleteRoute, {
      method: "DELETE",
      cookie: ad,
      params: { id },
      path: `/api/admin/groups/${id}?confirm=1`,
    });
    expect(confirmed.status).toBe(200);
    expect(await getPrisma().shareGrant.count()).toBe(0);
    expect((await call(workbookRoute, { cookie: me, params: { id: wb.id } })).status).toBe(404);
    const event = await getPrisma().auditEvent.findFirst({ where: { action: "group.deleted" } });
    expect(event?.details).toMatchObject({ sharesRemoved: 1 });
  });

  it("removing a member removes their access through the group on the next request (P2-GROUP-04)", async () => {
    const id = (await createGroup("Finance")).body!.data.id;
    await call(addMembersRoute, {
      method: "POST",
      cookie: ad,
      params: { id },
      body: { userIds: [member.id] },
    });
    const owner = await createTestUser();
    const oc = await signIn(owner.email);
    const wb = await createWorkbookAs(oc);
    await call(shareRoute, {
      method: "PUT",
      cookie: oc,
      params: { id: wb.id },
      body: { target: { type: "group", id }, role: "EDITOR" },
    });
    const before = await call<{ data: { role: string } }>(workbookRoute, {
      cookie: me,
      params: { id: wb.id },
    });
    expect(before.body!.data.role).toBe("EDITOR");
    await call(removeMemberRoute, {
      method: "DELETE",
      cookie: ad,
      params: { id, userId: member.id },
    });
    expect((await call(workbookRoute, { cookie: me, params: { id: wb.id } })).status).toBe(404);
  });

  it("deactivated users stay members but get no access through the group (P2-GROUP-05)", async () => {
    const id = (await createGroup("Finance")).body!.data.id;
    const gone = await createTestUser({ status: "DEACTIVATED" });
    const added = await call(addMembersRoute, {
      method: "POST",
      cookie: ad,
      params: { id },
      body: { userIds: [gone.id] },
    });
    expect(added.status).toBe(200);
    const detail = await call<{ data: { members: Array<{ id: string; status: string }> } }>(
      getRoute,
      {
        cookie: ad,
        params: { id },
      },
    );
    expect(detail.body!.data.members).toEqual([
      expect.objectContaining({ id: gone.id, status: "DEACTIVATED" }),
    ]);
    // The resolver itself never counts an inactive member's group grant.
    const owner = await createTestUser();
    const oc = await signIn(owner.email);
    const wb = await createWorkbookAs(oc);
    await call(shareRoute, {
      method: "PUT",
      cookie: oc,
      params: { id: wb.id },
      body: { target: { type: "group", id }, role: "VIEWER" },
    });
    const { resolveWorkbookRoleWithSharing } = await import("@/modules/sharing");
    expect(await resolveWorkbookRoleWithSharing(gone.principal, wb.id)).toBeNull();
  });

  it("pending and rejected people cannot be added", async () => {
    const id = (await createGroup("Finance")).body!.data.id;
    const pending = await createTestUser({ status: "PENDING_APPROVAL", role: null });
    const result = await call(addMembersRoute, {
      method: "POST",
      cookie: ad,
      params: { id },
      body: { userIds: [pending.id] },
    });
    expect(result.status).toBe(400);
  });
});
