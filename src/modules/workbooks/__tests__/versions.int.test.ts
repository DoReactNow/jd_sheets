// W-209: version history, names, old versions and restore (P2-VER-01..05, P2-ROLE-07, -08).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as leaseRoute } from "@/app/api/workbooks/[id]/lease/route";
import { PATCH as renameRoute } from "@/app/api/workbooks/[id]/route";
import { GET as versionContentRoute } from "@/app/api/workbooks/[id]/versions/[versionId]/content/route";
import { POST as restoreRoute } from "@/app/api/workbooks/[id]/versions/[versionId]/restore/route";
import { PATCH as nameRoute } from "@/app/api/workbooks/[id]/versions/[versionId]/route";
import { GET as versionsRoute } from "@/app/api/workbooks/[id]/versions/route";
import { GET as contentRoute } from "@/app/api/workbooks/[id]/content/route";
import { getPrisma } from "@/shared/db/prisma";
import { call, callRaw, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, type TestUser } from "@/tests/setup/users";
import { resetTestStorage } from "@/tests/setup/testStorage";
import { bodyText, saveAs, shareWith } from "@/tests/setup/workbookCalls";
import { createWorkbookAs, type TestWorkbook } from "@/tests/setup/workbooks";

let owner: TestUser;
let asha: TestUser;
let oc: string;
let ac: string;
let wb: TestWorkbook;

beforeEach(async () => {
  await resetWithRoles();
  resetTestStorage();
  installRealResolvers();
  owner = await createTestUser({ displayName: "Owner" });
  asha = await createTestUser({ displayName: "Asha" });
  [oc, ac] = await Promise.all([signIn(owner.email), signIn(asha.email)]);
  wb = await createWorkbookAs(oc, "History");
}, 30_000);
afterAll(() => getPrisma().$disconnect());

interface Version {
  id: string;
  number: number;
  name: string | null;
  source: string;
  createdBy: { displayName: string } | null;
  current: boolean;
  restoredFromNumber: number | null;
}
const history = async (cookie = oc) => {
  const result = await call<{ data: { items: Version[] } }>(versionsRoute, {
    cookie,
    params: { id: wb.id },
  });
  return result.status === 200 ? result.body!.data.items : result.status;
};

describe("the history", () => {
  it("lists versions newest first with who and when (P2-VER-01)", async () => {
    await saveAs(oc, wb.id, { A1: "1" });
    await shareWith(oc, wb.id, asha.id, "EDITOR");
    await getPrisma().editLease.deleteMany();
    await saveAs(ac, wb.id, { A1: "2" }, "tab-asha-0001");
    const items = (await history()) as Version[];
    expect(items.map((v) => [v.number, v.source, v.createdBy?.displayName, v.current])).toEqual([
      [3, "SAVE", "Asha", true],
      [2, "SAVE", "Owner", false],
      [1, "CREATE", "Owner", false],
    ]);
  });

  it("is visible to Owner, Editor and Commenter, not Viewer (P2-ROLE-07)", async () => {
    for (const [role, expected] of [
      ["EDITOR", 1],
      ["COMMENTER", 1],
      ["VIEWER", 403],
    ] as const) {
      await shareWith(oc, wb.id, asha.id, role);
      const result = await history(ac);
      expect(typeof result === "number" ? result : result.length).toBe(expected);
    }
  });

  it("a version can be named; named versions say so (P2-VER-02)", async () => {
    const [first] = (await history()) as Version[];
    const named = await call(nameRoute, {
      method: "PATCH",
      cookie: oc,
      params: { id: wb.id, versionId: first!.id },
      body: { name: "  Final for audit  " },
    });
    expect(named.status).toBe(200);
    expect(((await history()) as Version[])[0]!.name).toBe("Final for audit");
    await shareWith(oc, wb.id, asha.id, "COMMENTER");
    const refused = await call(nameRoute, {
      method: "PATCH",
      cookie: ac,
      params: { id: wb.id, versionId: first!.id },
      body: { name: "x" },
    });
    expect(refused.status).toBe(403);
  });

  it("an old version can be read as it was (P2-VER-03)", async () => {
    await saveAs(oc, wb.id, { A1: "old" });
    await saveAs(oc, wb.id, { A1: "new" });
    const old = ((await history()) as Version[]).find((v) => v.number === 2)!;
    const response = await callRaw(versionContentRoute, {
      cookie: oc,
      params: { id: wb.id, versionId: old.id },
    });
    expect(response.status).toBe(200);
    expect(await bodyText(response)).toContain(">old<");
    expect(response.headers.get("content-disposition")).toContain("version 2");
  });
});

describe("restoring", () => {
  it("makes a new version equal to the old one; history is kept; audited (P2-VER-04)", async () => {
    await saveAs(oc, wb.id, { A1: "good" });
    await saveAs(oc, wb.id, { A1: "bad" });
    const good = ((await history()) as Version[]).find((v) => v.number === 2)!;
    const restored = await call<{ data: { number: number } }>(restoreRoute, {
      method: "POST",
      cookie: oc,
      params: { id: wb.id, versionId: good.id },
    });
    expect(restored.status).toBe(200);
    expect(restored.body!.data.number).toBe(4);
    const items = (await history()) as Version[];
    expect(items.map((v) => v.number)).toEqual([4, 3, 2, 1]);
    expect(items[0]).toMatchObject({ source: "RESTORE", restoredFromNumber: 2, current: true });
    const current = await callRaw(contentRoute, { cookie: oc, params: { id: wb.id } });
    expect(await bodyText(current)).toContain(">good<");
    const event = await getPrisma().auditEvent.findFirst({
      where: { action: "workbook.versionRestored" },
    });
    expect(event?.details).toMatchObject({ fromVersion: 2, newVersion: 4 });
  });

  it("is refused while someone else holds the lease (P2-VER-05)", async () => {
    await shareWith(oc, wb.id, asha.id, "EDITOR");
    await call(leaseRoute, {
      method: "POST",
      cookie: ac,
      params: { id: wb.id },
      body: { tabId: "tab-asha-0001" },
    });
    const [first] = (await history()) as Version[];
    const result = await call(restoreRoute, {
      method: "POST",
      cookie: oc,
      params: { id: wb.id, versionId: first!.id },
    });
    expect(result.status).toBe(423);
    expect((result.body as { error: { code: string } }).error.code).toBe("WORKBOOK_LOCKED");
  });

  it("only Owner and Editor restore or rename (P2-ROLE-08)", async () => {
    const [first] = (await history()) as Version[];
    for (const [role, status] of [
      ["COMMENTER", 403],
      ["VIEWER", 403],
      ["EDITOR", 200],
    ] as const) {
      await shareWith(oc, wb.id, asha.id, role);
      const restore = await call(restoreRoute, {
        method: "POST",
        cookie: ac,
        params: { id: wb.id, versionId: first!.id },
      });
      expect(restore.status, `${role} restore`).toBe(status);
      const rename = await call(renameRoute, {
        method: "PATCH",
        cookie: ac,
        params: { id: wb.id },
        body: { title: `Renamed by ${role}` },
      });
      expect(rename.status, `${role} rename`).toBe(status);
    }
    expect((await getPrisma().workbook.findUniqueOrThrow({ where: { id: wb.id } })).title).toBe(
      "Renamed by EDITOR",
    );
  });
});
