// W-206: the server is the lock for saves (P2-ROLE-02..05, P2-MODE-03, X-ACCESS-09), with the
// fake validator's comment-aware comparison (the Rust diff-kind has its own tests).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as leaseRoute } from "@/app/api/workbooks/[id]/lease/route";
import { PUT as saveRoute } from "@/app/api/workbooks/[id]/content/route";
import { PUT as shareRoute } from "@/app/api/workbooks/[id]/shares/route";
import { getPrisma } from "@/shared/db/prisma";
import { minimalXlsx, type FakeComment } from "@/shared/validator";
import { call, callRaw, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, type TestUser } from "@/tests/setup/users";
import { resetTestStorage } from "@/tests/setup/testStorage";
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
  wb = await createWorkbookAs(oc, "Budget");
}, 30_000);
afterAll(() => getPrisma().$disconnect());

const OWNER_TAB = "owner-tab-1";
const versions = () => getPrisma().workbookVersion.count({ where: { workbookId: wb.id } });
const share = (role: string) =>
  call(shareRoute, {
    method: "PUT",
    cookie: oc,
    params: { id: wb.id },
    body: { target: { type: "user", id: asha.id }, role },
  });

async function save(cookie: string, bytes: Uint8Array, tab?: string) {
  const current = await getPrisma().workbook.findUniqueOrThrow({ where: { id: wb.id } });
  const headers: Record<string, string> = { "if-match": `"${current.currentVersionId}"` };
  if (tab) headers["x-editor-tab"] = tab;
  const response = await callRaw(saveRoute, {
    method: "PUT",
    cookie,
    params: { id: wb.id },
    headers,
    body: new Uint8Array(bytes),
  });
  const body = (await response.json()) as { error?: { code: string } };
  return { status: response.status, code: body.error?.code };
}

const asOwnerWithComments = async (comments: FakeComment[]) => {
  await call(leaseRoute, {
    method: "POST",
    cookie: oc,
    params: { id: wb.id },
    body: { tabId: OWNER_TAB },
  });
  expect((await save(oc, minimalXlsx({}, comments), OWNER_TAB)).status).toBe(200);
  await getPrisma().editLease.deleteMany();
};

describe("Viewers (P2-ROLE-02, P2-MODE-03)", () => {
  it("a Viewer's save is refused and nothing is written", async () => {
    await share("VIEWER");
    const result = await save(ac, minimalXlsx({ A1: "changed" }));
    expect(result).toEqual({ status: 403, code: "FORBIDDEN" });
    const comments = await save(ac, minimalXlsx({}, [{ cell: "A1", author: "Asha", text: "hi" }]));
    expect(comments.status).toBe(403);
    expect(await versions()).toBe(1);
  });
});

describe("Commenters", () => {
  beforeEach(async () => {
    await share("COMMENTER");
  });

  it("a save that changes only comments is accepted (P2-ROLE-03)", async () => {
    const result = await save(
      ac,
      minimalXlsx({}, [{ cell: "B2", author: "Asha", text: "Check this" }]),
    );
    expect(result.status).toBe(200);
    expect(await versions()).toBe(2);
  });

  it("a save with no change writes nothing", async () => {
    expect((await save(ac, minimalXlsx())).status).toBe(200);
    expect(await versions()).toBe(1);
  });

  it("a save that changes any content is refused and nothing is written (P2-ROLE-04)", async () => {
    const result = await save(
      ac,
      minimalXlsx({ A1: "sneaky" }, [{ cell: "B2", author: "Asha", text: "x" }]),
    );
    expect(result).toEqual({ status: 403, code: "COMMENTS_ONLY" });
    expect(await versions()).toBe(1);
  });

  it("cannot change or delete someone else's comment through a save (P2-ROLE-05)", async () => {
    await asOwnerWithComments([{ cell: "A1", author: "Owner", text: "Mine" }]);
    const deleted = await save(ac, minimalXlsx());
    expect(deleted.code).toBe("COMMENTS_ONLY");
    const changed = await save(
      ac,
      minimalXlsx({}, [{ cell: "A1", author: "Owner", text: "Edited" }]),
    );
    expect(changed.code).toBe("COMMENTS_ONLY");
    const added = await save(
      ac,
      minimalXlsx({}, [
        { cell: "A1", author: "Owner", text: "Mine" },
        { cell: "C3", author: "Asha", text: "Reply" },
      ]),
    );
    expect(added.status).toBe(200);
  });

  it("waits while someone is editing (Decision 54)", async () => {
    await call(leaseRoute, {
      method: "POST",
      cookie: oc,
      params: { id: wb.id },
      body: { tabId: OWNER_TAB },
    });
    const result = await save(ac, minimalXlsx({}, [{ cell: "B2", author: "Asha", text: "x" }]));
    expect(result.code).toBe("WORKBOOK_LOCKED");
  });
});
