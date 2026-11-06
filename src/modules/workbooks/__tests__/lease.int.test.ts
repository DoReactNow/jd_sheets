// W-207: the edit lease (P2-LEASE-01..10, Decision 52) and saving with it.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as releaseRoute } from "@/app/api/workbooks/[id]/lease/release/route";
import { POST as leaseRoute } from "@/app/api/workbooks/[id]/lease/route";
import { PUT as saveRoute } from "@/app/api/workbooks/[id]/content/route";
import { PUT as shareRoute } from "@/app/api/workbooks/[id]/shares/route";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { getPrisma } from "@/shared/db/prisma";
import { createTestClock } from "@/shared/time";
import { minimalXlsx } from "@/shared/validator";
import { call, callRaw, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, type TestUser } from "@/tests/setup/users";
import { resetTestStorage } from "@/tests/setup/testStorage";
import { createWorkbookAs, principalWithSession, type TestWorkbook } from "@/tests/setup/workbooks";
import { createLeaseService } from "../workbooks.lease";

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
  wb = await createWorkbookAs(oc, "Leased");
  await share(asha.id, "EDITOR");
}, 30_000);
afterAll(() => getPrisma().$disconnect());

type State = { status: string; holderName?: string; renewSeconds?: number };
const TAB_A = "tab-aaaaaaaa";
const TAB_B = "tab-bbbbbbbb";

function share(userId: string, role: string) {
  return call(shareRoute, {
    method: "PUT",
    cookie: oc,
    params: { id: wb.id },
    body: { target: { type: "user", id: userId }, role },
  });
}
async function lease(cookie: string, tabId: string, takeOver = false) {
  const result = await call<{ data: State }>(leaseRoute, {
    method: "POST",
    cookie,
    params: { id: wb.id },
    body: { tabId, takeOver },
  });
  return result.status === 200 ? result.body!.data : { status: String(result.status) };
}
async function save(cookie: string, tab: string | null, bytes = minimalXlsx({ A1: "x" })) {
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

describe("taking the lease", () => {
  it("the first Editor gets it; a second sees who is editing (P2-LEASE-01, -02)", async () => {
    expect(await lease(oc, TAB_A)).toMatchObject({
      status: "HELD",
      renewSeconds: APP_CONFIG.lease.renewSeconds,
    });
    expect(await lease(ac, TAB_B)).toEqual({ status: "OTHER", holderName: "Owner" });
  });

  it("releasing on close lets the waiting Editor take it (P2-LEASE-04)", async () => {
    await lease(oc, TAB_A);
    const released = await call(releaseRoute, {
      method: "POST",
      cookie: oc,
      params: { id: wb.id },
      body: { tabId: TAB_A },
    });
    expect(released.status).toBe(200);
    expect((await lease(ac, TAB_B)).status).toBe("HELD");
  });

  it("two Editors at the same moment: exactly one gets it (P2-LEASE-06)", async () => {
    const results = await Promise.all([
      lease(oc, TAB_A),
      lease(ac, TAB_B),
      lease(oc, "tab-cccccccc"),
    ]);
    expect(results.filter((r) => r.status === "HELD")).toHaveLength(1);
    expect(await getPrisma().editLease.count()).toBe(1);
  });

  it("the same person in a second tab is told it is open elsewhere, and can move it (P2-LEASE-08)", async () => {
    await lease(oc, TAB_A);
    expect(await lease(oc, TAB_B)).toEqual({ status: "ELSEWHERE" });
    expect((await save(oc, TAB_B)).code).toBe("EDITING_ELSEWHERE");
    expect((await lease(oc, TAB_B, true)).status).toBe("HELD");
    // The first tab finds out on its next renewal.
    expect(await lease(oc, TAB_A)).toEqual({ status: "ELSEWHERE" });
    // Another person can never move it.
    expect((await lease(ac, TAB_A, true)).status).toBe("OTHER");
  });

  it("losing edit rights ends the lease on the next renewal (P2-LEASE-09)", async () => {
    await lease(ac, TAB_B);
    await share(asha.id, "VIEWER");
    expect(await lease(ac, TAB_B)).toEqual({ status: "VIEW_ONLY" });
    expect(await getPrisma().editLease.count()).toBe(0);
    expect((await lease(oc, TAB_A)).status).toBe("HELD");
  });

  it("Viewers and Commenters never take it (P2-LEASE-10)", async () => {
    for (const role of ["VIEWER", "COMMENTER"]) {
      await share(asha.id, role);
      expect(await lease(ac, TAB_B)).toEqual({ status: "VIEW_ONLY" });
    }
    expect(await getPrisma().editLease.count()).toBe(0);
  });

  it("refuses a malformed tab id", async () => {
    const result = await call(leaseRoute, {
      method: "POST",
      cookie: oc,
      params: { id: wb.id },
      body: { tabId: "x" },
    });
    expect(result.status).toBe(400);
  });
});

describe("timing (P2-LEASE-03, -05)", () => {
  it("lasts 90 seconds, renews, and expires just after 90 seconds, not before", async () => {
    const clock = createTestClock("2026-11-06T10:00:00Z");
    const service = createLeaseService({ clock });
    const first = await principalWithSession(owner);
    const second = await principalWithSession(asha);
    const held = await service.acquire(first, "OWNER", wb.id, TAB_A, false);
    expect(held).toMatchObject({ status: "HELD", expiresAt: "2026-11-06T10:01:30.000Z" });
    clock.advance(30_000);
    expect((await service.acquire(first, "OWNER", wb.id, TAB_A, false)).status).toBe("HELD");
    clock.advance(89_000); // 89 s after the renewal
    expect((await service.acquire(second, "EDITOR", wb.id, TAB_B, false)).status).toBe("OTHER");
    clock.advance(2_000); // 91 s
    expect((await service.acquire(second, "EDITOR", wb.id, TAB_B, false)).status).toBe("HELD");
  });
});

describe("saving needs the lease (P2-LEASE-07)", () => {
  it("a save without the lease, or with another page's, is refused and nothing is written", async () => {
    expect((await save(oc, TAB_A)).code).toBe("WORKBOOK_LOCKED");
    await lease(ac, TAB_B);
    expect((await save(oc, TAB_A)).code).toBe("WORKBOOK_LOCKED");
    expect((await save(ac, null)).code).toBe("EDITING_ELSEWHERE");
    expect(await getPrisma().workbookVersion.count({ where: { workbookId: wb.id } })).toBe(1);
    expect((await save(ac, TAB_B)).status).toBe(200);
  });
});
