// W-204: My workbooks, Shared with me, Recent and search (P2-LIST-01..03, P2-SHARE-09, -10,
// P2-LINK-03, X-LIST-01, -02, -05).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as contentRoute } from "@/app/api/workbooks/[id]/content/route";
import { PUT as linkRoute } from "@/app/api/workbooks/[id]/link/route";
import { GET as workbookRoute } from "@/app/api/workbooks/[id]/route";
import { DELETE as removeGrantRoute } from "@/app/api/workbooks/[id]/shares/[grantId]/route";
import { PUT as shareRoute } from "@/app/api/workbooks/[id]/shares/route";
import { GET as listRoute } from "@/app/api/workbooks/route";
import { getPrisma } from "@/shared/db/prisma";
import { call, callRaw, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, type TestUser } from "@/tests/setup/users";
import { createWorkbookAs } from "@/tests/setup/workbooks";
import { resetTestStorage } from "@/tests/setup/testStorage";

let owner: TestUser;
let asha: TestUser;
let oc: string;
let ac: string;

beforeEach(async () => {
  await resetWithRoles();
  resetTestStorage();
  installRealResolvers();
  owner = await createTestUser({ displayName: "Owner" });
  asha = await createTestUser({ displayName: "Asha" });
  [oc, ac] = await Promise.all([signIn(owner.email), signIn(asha.email)]);
}, 30_000);
afterAll(() => getPrisma().$disconnect());

interface Item {
  id: string;
  title: string;
  role: string;
  owner: { displayName: string } | null;
}
type Page = { data: { items: Item[]; nextCursor: string | null } };

const list = (cookie: string, query = "") =>
  call<Page>(listRoute, { cookie, path: `/api/workbooks?${query}` }).then((r) => {
    expect(r.status).toBe(200);
    return r.body!.data;
  });
const titles = async (cookie: string, query = "") =>
  (await list(cookie, query)).items.map((i) => i.title);
const share = (id: string, userId: string, role = "VIEWER") =>
  call<{ data: { id: string } }>(shareRoute, {
    method: "PUT",
    cookie: oc,
    params: { id },
    body: { target: { type: "user", id: userId }, role },
  });
const open = (cookie: string, id: string) => callRaw(contentRoute, { cookie, params: { id } });

describe("Shared with me", () => {
  it("lists exactly the workbooks the person can read and does not own (P2-SHARE-09)", async () => {
    const a = await createWorkbookAs(oc, "Shared A");
    await createWorkbookAs(oc, "Private");
    await createWorkbookAs(ac, "Asha's own");
    await share(a.id, asha.id, "COMMENTER");
    const shared = await list(ac, "scope=shared");
    expect(shared.items).toEqual([
      expect.objectContaining({
        title: "Shared A",
        role: "COMMENTER",
        owner: expect.objectContaining({ displayName: "Owner" }),
      }),
    ]);
    expect(await titles(ac, "scope=mine")).toEqual(["Asha's own"]);
  });

  it("a removed share disappears from the list and the next read is refused (P2-SHARE-10)", async () => {
    const a = await createWorkbookAs(oc, "Shared A");
    const grant = (await share(a.id, asha.id)).body!.data;
    expect(await titles(ac, "scope=shared")).toEqual(["Shared A"]);
    await call(removeGrantRoute, {
      method: "DELETE",
      cookie: oc,
      params: { id: a.id, grantId: grant.id },
    });
    expect(await titles(ac, "scope=shared")).toEqual([]);
    expect((await open(ac, a.id)).status).toBe(404);
  });

  it("a link-only workbook appears after the person opens the link once (P2-LINK-03, Decision 52)", async () => {
    const a = await createWorkbookAs(oc, "Linked");
    await call(linkRoute, {
      method: "PUT",
      cookie: oc,
      params: { id: a.id },
      body: { role: "VIEWER" },
    });
    expect(await titles(ac, "scope=shared")).toEqual([]);
    expect(await titles(ac, "scope=all&q=link")).toEqual([]);
    expect((await call(workbookRoute, { cookie: ac, params: { id: a.id } })).status).toBe(200);
    expect(await titles(ac, "scope=shared")).toEqual(["Linked"]);
    // Turning the link off removes it again (P2-LINK-02).
    await call(linkRoute, {
      method: "PUT",
      cookie: oc,
      params: { id: a.id },
      body: { role: null },
    });
    expect(await titles(ac, "scope=shared")).toEqual([]);
  });
});

describe("sorting, search and paging", () => {
  it("sorts by last change and by title both ways with a stable tie-breaker (P2-LIST-01, X-LIST-01)", async () => {
    for (const title of ["beta", "Alpha", "gamma"]) await createWorkbookAs(oc, title);
    expect(await titles(oc)).toEqual(["gamma", "Alpha", "beta"]);
    expect(await titles(oc, "dir=asc")).toEqual(["beta", "Alpha", "gamma"]);
    expect(await titles(oc, "sort=title")).toEqual(["Alpha", "beta", "gamma"]);
    expect(await titles(oc, "sort=title&dir=desc")).toEqual(["gamma", "beta", "Alpha"]);
    for (let i = 0; i < 3; i++) await createWorkbookAs(oc, "Same");
    const same = (await list(oc, "sort=title&q=same")).items.map((i) => i.id);
    expect(same).toEqual([...same].sort());
  });

  it("search matches titles case-insensitively and only readable workbooks (P2-LIST-02, X-LIST-02)", async () => {
    const mine = await createWorkbookAs(ac, "Budget 2026");
    const shared = await createWorkbookAs(oc, "budget plan");
    await createWorkbookAs(oc, "Budget secret");
    await share(shared.id, asha.id);
    expect((await list(ac, "scope=all&q=BUDGET&sort=title")).items.map((i) => i.id)).toEqual([
      mine.id,
      shared.id,
    ]);
    expect(await titles(ac, "scope=shared&q=budget")).toEqual(["budget plan"]);
    expect(await titles(ac, "scope=all&q=%25")).toEqual([]); // a literal % matches nothing
  });

  it("pages never skip or repeat a row when data changes between pages (X-LIST-05)", async () => {
    for (let i = 0; i < 5; i++) await createWorkbookAs(oc, `Book ${i}`);
    const first = await list(oc, "limit=2");
    expect(first.items).toHaveLength(2);
    await createWorkbookAs(oc, "New while paging");
    const seen = first.items.map((i) => i.title);
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await list(oc, `limit=2&cursor=${cursor}`);
      seen.push(...page.items.map((i) => i.title));
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(["Book 4", "Book 3", "Book 2", "Book 1", "Book 0"]);
    const bad = await call(listRoute, { cookie: oc, path: "/api/workbooks?cursor=nonsense" });
    expect(bad.status).toBe(400);
  });
});

describe("Recent", () => {
  it("lists the last 20 workbooks the person opened, newest first, readable only (P2-LIST-03)", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) ids.push((await createWorkbookAs(oc, `R${i}`)).id);
    for (const id of ids) await open(oc, id);
    const recent = await titles(oc, "scope=recent");
    expect(recent).toHaveLength(20);
    expect(recent[0]).toBe("R21");
    expect(recent.at(-1)).toBe("R2");
    await open(oc, ids[0]!);
    expect((await titles(oc, "scope=recent"))[0]).toBe("R0");

    const shared = await createWorkbookAs(oc, "Shared then removed");
    const grant = (await share(shared.id, asha.id)).body!.data;
    await open(ac, shared.id);
    expect(await titles(ac, "scope=recent")).toEqual(["Shared then removed"]);
    await call(removeGrantRoute, {
      method: "DELETE",
      cookie: oc,
      params: { id: shared.id, grantId: grant.id },
    });
    expect(await titles(ac, "scope=recent")).toEqual([]);
  });

  it("keeps only the newest 50 per person", async () => {
    for (let i = 0; i < 52; i++) await open(oc, (await createWorkbookAs(oc, `K${i}`)).id);
    expect(await getPrisma().recentOpen.count({ where: { userId: owner.id } })).toBe(50);
  }, 60_000);
});
