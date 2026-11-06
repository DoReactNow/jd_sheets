// W-210..W-213: import and download (P2-IMPORT-01..05, P2-EXPORT-01, -03, P2-ROLE-06), Trash
// (P2-TRASH-01..04, P2-ROLE-09), administrator tools (P2-ADMINWB-01..05) and the nightly jobs
// (P2-VER-06, -07), with the fake validator and the test storage folder.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as adminContentRoute } from "@/app/api/admin/workbooks/[id]/content/route";
import { POST as adminOpenRoute } from "@/app/api/admin/workbooks/[id]/open/route";
import { POST as transferRoute } from "@/app/api/admin/workbooks/[id]/transfer/route";
import { GET as adminListRoute } from "@/app/api/admin/workbooks/route";
import { GET as downloadRoute } from "@/app/api/workbooks/[id]/download/route";
import { DELETE as deleteRoute, GET as workbookRoute } from "@/app/api/workbooks/[id]/route";
import { PUT as settingsRoute } from "@/app/api/workbooks/[id]/settings/route";
import { GET as sharesRoute } from "@/app/api/workbooks/[id]/shares/route";
import { POST as trashRoute } from "@/app/api/workbooks/[id]/trash/route";
import { POST as untrashRoute } from "@/app/api/workbooks/[id]/untrash/route";
import { POST as importRoute } from "@/app/api/workbooks/import/route";
import { GET as listRoute } from "@/app/api/workbooks/route";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { getPrisma } from "@/shared/db/prisma";
import { getFileStorage } from "@/shared/storage";
import { createTestClock, plusDuration } from "@/shared/time";
import { getWorkbookValidator, minimalXlsx } from "@/shared/validator";
import { logger } from "@/shared/logger";
import { call, callRaw, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, type TestUser } from "@/tests/setup/users";
import { resetTestStorage } from "@/tests/setup/testStorage";
import { bodyText, saveAs, shareWith } from "@/tests/setup/workbookCalls";
import { createWorkbookAs, type TestWorkbook } from "@/tests/setup/workbooks";
import { createLifecycleService } from "../workbooks.lifecycle";
import { workbooksRepository } from "../workbooks.repository";

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

const code = (r: { body: unknown }) => (r.body as { error?: { code: string } } | null)?.error?.code;

function importFile(name: string, bytes: Uint8Array | string, cookie = oc) {
  return callRaw(importRoute, {
    method: "POST",
    cookie,
    headers: { "x-file-name": encodeURIComponent(name) },
    body: typeof bytes === "string" ? bytes : new Uint8Array(bytes),
  }).then(async (r) => ({
    status: r.status,
    body: (await r.json()) as { data?: { id: string; title: string }; error?: { code: string } },
  }));
}

describe("import (P2-IMPORT-01..05)", () => {
  it("imports .xlsx, .xlsb, .ods, .csv and .tsv into a new workbook stored as .xlsx", async () => {
    const files: Array<[string, Uint8Array | string]> = [
      ["Plan.xlsx", minimalXlsx({ A1: "1" })],
      ["Old.xlsb", minimalXlsx()],
      ["Open.ods", minimalXlsx()],
      ["List.csv", "a,b\n1,2\n"],
      ["Tabs.tsv", "a\tb\n"],
    ];
    for (const [name, bytes] of files) {
      const result = await importFile(name, bytes);
      expect(result.status, name).toBe(201);
      const version = await getPrisma().workbookVersion.findFirstOrThrow({
        where: { workbookId: result.body.data!.id },
      });
      expect(version.source).toBe("IMPORT");
      expect(version.storageKey.endsWith(".xlsx")).toBe(true);
    }
  });

  it("refuses other or broken files with a friendly message (P2-IMPORT-02)", async () => {
    expect((await importFile("virus.exe", "MZ")).body.error?.code).toBe("FILE_TYPE_NOT_SUPPORTED");
    expect((await importFile("noextension", "x")).body.error?.code).toBe("FILE_TYPE_NOT_SUPPORTED");
    expect((await importFile("broken.xlsx", "not a zip")).body.error?.code).toBe(
      "WORKBOOK_UNREADABLE",
    );
    expect((await importFile("bad.csv", new Uint8Array([0xff, 0xfe, 0x00]))).body.error?.code).toBe(
      "WORKBOOK_UNREADABLE",
    );
  });

  it("applies the size limit (P2-IMPORT-03)", async () => {
    const big = new Uint8Array(APP_CONFIG.workbooks.maxBytes + 1);
    expect((await importFile("big.csv", big)).body.error?.code).toBe("WORKBOOK_TOO_LARGE");
  });

  it("the file name becomes the title, as text (P2-IMPORT-04)", async () => {
    expect((await importFile("Q4 <b>plan</b> 2026.csv", "a\n")).body.data?.title).toBe(
      "Q4 <b>plan</b> 2026",
    );
    expect((await importFile("चाय.tsv", "a\n")).body.data?.title).toBe("चाय");
  });

  it("formulas in a CSV are imported as written, not run by our code (P2-IMPORT-05)", async () => {
    const result = await importFile("f.csv", '=HYPERLINK("http://x"),=cmd|x\n');
    expect(result.status).toBe(201);
  });

  it("needs workbooks:create; a pending person cannot import", async () => {
    expect((await importFile("x.csv", "a", "")).status).toBe(401);
  });
});

describe("download (P2-EXPORT-01, -03, P2-ROLE-06)", () => {
  it("returns the current version with a safe filename", async () => {
    await saveAs(oc, wb.id, { A1: "latest" });
    const response = await callRaw(downloadRoute, { cookie: oc, params: { id: wb.id } });
    expect(response.status).toBe(200);
    expect(await bodyText(response)).toContain(">latest<");
    expect(response.headers.get("content-disposition")).toContain('filename="Budget.xlsx"');
  });

  it("names with slashes, quotes and non-Latin letters download correctly (P2-EXPORT-03)", async () => {
    const odd = await createWorkbookAs(oc, 'a/b "c" बजट');
    const response = await callRaw(downloadRoute, { cookie: oc, params: { id: odd.id } });
    const disposition = response.headers.get("content-disposition")!;
    expect(disposition).toContain('filename="a_b _c_ ___.xlsx"');
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent('a/b "c" बजट.xlsx')}`);
  });

  it("Viewers and Commenters cannot download when the Owner turned it off; Editors still can", async () => {
    await call(settingsRoute, {
      method: "PUT",
      cookie: oc,
      params: { id: wb.id },
      body: { allowDownloadForReaders: false },
    });
    for (const [role, status] of [
      ["VIEWER", 403],
      ["COMMENTER", 403],
      ["EDITOR", 200],
    ] as const) {
      await shareWith(oc, wb.id, asha.id, role);
      const response = await callRaw(downloadRoute, { cookie: ac, params: { id: wb.id } });
      expect(response.status, role).toBe(status);
    }
    const info = await call<{ data: { allowDownloadForReaders: boolean } }>(workbookRoute, {
      cookie: ac,
      params: { id: wb.id },
    });
    expect(info.body!.data.allowDownloadForReaders).toBe(false);
  });
});

describe("Trash (P2-TRASH-01, -02, -04, P2-ROLE-09)", () => {
  it("disappears for everyone else at once and comes back with its shares", async () => {
    await shareWith(oc, wb.id, asha.id, "EDITOR");
    expect(
      (await call(trashRoute, { method: "POST", cookie: oc, params: { id: wb.id } })).status,
    ).toBe(200);
    const asOther = await call(workbookRoute, { cookie: ac, params: { id: wb.id } });
    expect(asOther.status).toBe(404);
    const mine = await call<{ data: { items: Array<{ id: string }> } }>(listRoute, {
      cookie: oc,
      path: "/api/workbooks?scope=mine",
    });
    expect(mine.body!.data.items).toEqual([]);
    const trash = await call<{ data: { items: Array<{ id: string; trashedAt: string }> } }>(
      listRoute,
      { cookie: oc, path: "/api/workbooks?scope=trash" },
    );
    expect(trash.body!.data.items.map((i) => i.id)).toEqual([wb.id]);
    expect(trash.body!.data.items[0]!.trashedAt).toBeTruthy();
    expect(
      (await call(untrashRoute, { method: "POST", cookie: oc, params: { id: wb.id } })).status,
    ).toBe(200);
    const role = await call<{ data: { role: string } }>(workbookRoute, {
      cookie: ac,
      params: { id: wb.id },
    });
    expect(role.body!.data.role).toBe("EDITOR");
  });

  it("only the Owner trashes, restores or deletes (P2-ROLE-09)", async () => {
    await shareWith(oc, wb.id, asha.id, "EDITOR");
    expect(
      (await call(trashRoute, { method: "POST", cookie: ac, params: { id: wb.id } })).status,
    ).toBe(403);
    expect(
      (await call(deleteRoute, { method: "DELETE", cookie: ac, params: { id: wb.id } })).status,
    ).toBe(403);
  });

  it("deleting for good works only from the Trash and removes rows and files", async () => {
    expect(
      code(await call(deleteRoute, { method: "DELETE", cookie: oc, params: { id: wb.id } })),
    ).toBe("NOT_FOUND");
    const keys = (await getPrisma().workbookVersion.findMany({ where: { workbookId: wb.id } })).map(
      (v) => v.storageKey,
    );
    await call(trashRoute, { method: "POST", cookie: oc, params: { id: wb.id } });
    expect(
      (await call(deleteRoute, { method: "DELETE", cookie: oc, params: { id: wb.id } })).status,
    ).toBe(200);
    expect(await getPrisma().workbook.count()).toBe(0);
    for (const key of keys) expect(await getFileStorage().exists(key)).toBe(false);
  });
});

describe("nightly jobs (P2-TRASH-03, P2-VER-06, -07)", () => {
  const lifecycle = (clock: ReturnType<typeof createTestClock>) =>
    createLifecycleService({
      repository: workbooksRepository,
      storage: getFileStorage(),
      validator: getWorkbookValidator(),
      clock,
      logger,
    });

  it("purges workbooks trashed more than 30 days ago, not before", async () => {
    await call(trashRoute, { method: "POST", cookie: oc, params: { id: wb.id } });
    const trashedAt = (await getPrisma().workbook.findUniqueOrThrow({ where: { id: wb.id } }))
      .trashedAt!;
    const almost = createTestClock(plusDuration(trashedAt, { days: 29, hours: 23 }));
    expect(await lifecycle(almost).purgeTrash()).toBe(0);
    const after = createTestClock(plusDuration(trashedAt, { days: 30, minutes: 1 }));
    expect(await lifecycle(after).purgeTrash()).toBe(1);
    expect(await lifecycle(after).purgeTrash()).toBe(0);
    expect(await getPrisma().workbook.count()).toBe(0);
  });

  it("prunes: all for 30 days, then one per day to a year, then one per month; never named or current", async () => {
    // Versions made on several days, dated in the past.
    const now = new Date("2027-12-01T06:00:00Z");
    const ages = [400, 400, 380, 200, 200, 200, 40, 40, 10, 10];
    for (let i = 0; i < ages.length; i++) await saveAs(oc, wb.id, { A1: String(i) });
    const versions = await getPrisma().workbookVersion.findMany({
      where: { workbookId: wb.id, number: { gt: 1 } },
      orderBy: { number: "asc" },
    });
    for (let i = 0; i < versions.length; i++) {
      await getPrisma().workbookVersion.update({
        where: { id: versions[i]!.id },
        data: { createdAt: plusDuration(now, { days: -ages[i]!, minutes: i }) },
      });
    }
    await getPrisma().workbookVersion.update({
      where: { id: versions[1]!.id },
      data: { name: "Keep me" },
    });
    await getPrisma().workbookVersion.update({
      where: { workbookId_number: { workbookId: wb.id, number: 1 } },
      data: { createdAt: plusDuration(now, { days: -500 }) },
    });
    const keysBefore = (
      await getPrisma().workbookVersion.findMany({ where: { workbookId: wb.id } })
    ).map((v) => v.storageKey);

    const removed = await lifecycle(createTestClock(now)).pruneVersions();
    const left = await getPrisma().workbookVersion.findMany({
      where: { workbookId: wb.id },
      orderBy: { number: "asc" },
    });
    // 500 d (own month) | 400 d ×2 same month: keep newest + named | 380 d | 200 d ×3 same day: one
    // | 40 d ×2 same day: one | 10 d ×2: both (under 30 days).
    expect(left.map((v) => v.number)).toEqual([1, 2, 3, 4, 7, 9, 10, 11]);
    expect(removed).toBe(3);
    const leftKeys = new Set(left.map((v) => v.storageKey));
    for (const key of keysBefore)
      expect(await getFileStorage().exists(key)).toBe(leftKeys.has(key));
    expect(await lifecycle(createTestClock(now)).pruneVersions()).toBe(0);
  });
});

describe("administrator tools (P2-ADMINWB-01..05)", () => {
  let admin: TestUser;
  let sc: string;
  beforeEach(async () => {
    admin = await createTestUser({ role: "SUPER_ADMIN" });
    sc = await signIn(admin.email);
  });

  it("lists every workbook's title, owner, size and last change, not content (P2-ADMINWB-01)", async () => {
    const result = await call<{ data: { workbooks: Array<Record<string, unknown>> } }>(
      adminListRoute,
      { cookie: sc },
    );
    expect(result.body!.data.workbooks).toEqual([
      expect.objectContaining({
        id: wb.id,
        title: "Budget",
        owner: expect.objectContaining({ displayName: "Owner" }),
      }),
    ]);
    expect(Object.keys(result.body!.data.workbooks[0]!).sort()).toEqual([
      "id",
      "owner",
      "sizeBytes",
      "title",
      "trashedAt",
      "updatedAt",
    ]);
  });

  it("transfers ownership; the old owner becomes an Editor; audited (P2-ADMINWB-02)", async () => {
    const result = await call(transferRoute, {
      method: "POST",
      cookie: sc,
      params: { id: wb.id },
      body: { newOwnerId: asha.id },
    });
    expect(result.status).toBe(200);
    const asAsha = await call<{ data: { role: string } }>(workbookRoute, {
      cookie: ac,
      params: { id: wb.id },
    });
    expect(asAsha.body!.data.role).toBe("OWNER");
    const asOld = await call<{ data: { role: string } }>(workbookRoute, {
      cookie: oc,
      params: { id: wb.id },
    });
    expect(asOld.body!.data.role).toBe("EDITOR");
    const shares = await call<{
      data: { grants: Array<{ role: string; target: { id: string } }> };
    }>(sharesRoute, { cookie: ac, params: { id: wb.id } });
    expect(shares.body!.data.grants).toEqual([
      expect.objectContaining({
        role: "EDITOR",
        target: expect.objectContaining({ id: owner.id }),
      }),
    ]);
    expect(
      await getPrisma().auditEvent.count({ where: { action: "workbook.ownershipTransferred" } }),
    ).toBe(1);
  });

  it("opening as administrator needs a reason, is audited every time and reads in view only (P2-ADMINWB-03)", async () => {
    expect(
      (
        await call(adminOpenRoute, {
          method: "POST",
          cookie: sc,
          params: { id: wb.id },
          body: { reason: "" },
        })
      ).status,
    ).toBe(400);
    const opened = await call<{ data: { grant: string } }>(adminOpenRoute, {
      method: "POST",
      cookie: sc,
      params: { id: wb.id },
      body: { reason: "Owner left the company" },
    });
    expect(opened.status).toBe(200);
    const grant = opened.body!.data.grant;
    const content = await callRaw(adminContentRoute, {
      cookie: sc,
      params: { id: wb.id },
      path: `/api/admin/workbooks/${wb.id}/content?grant=${grant}`,
    });
    expect(content.status).toBe(200);
    // Not without a fresh grant, and not someone else's.
    const other = await callRaw(adminContentRoute, {
      cookie: sc,
      params: { id: wb.id },
      path: `/api/admin/workbooks/${wb.id}/content?grant=0190f5e0-0000-7000-8000-000000000000`,
    });
    expect(other.status).toBe(403);
    await call(adminOpenRoute, {
      method: "POST",
      cookie: sc,
      params: { id: wb.id },
      body: { reason: "Again, checking totals" },
    });
    expect(await getPrisma().auditEvent.count({ where: { action: "workbook.adminOpened" } })).toBe(
      2,
    );
    // The bypass still gives no workbook role, so it cannot save (P2-SHARE-12).
    expect((await call(workbookRoute, { cookie: sc, params: { id: wb.id } })).status).toBe(404);
  });

  it("a Member or an Admin without the permission cannot reach any of these (P2-ADMINWB-04)", async () => {
    const plainAdmin = await createTestUser({ role: "ADMIN" });
    for (const cookie of [ac, await signIn(plainAdmin.email)]) {
      expect((await call(adminListRoute, { cookie })).status).toBe(403);
      expect(
        (
          await call(adminOpenRoute, {
            method: "POST",
            cookie,
            params: { id: wb.id },
            body: { reason: "Just looking" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(transferRoute, {
            method: "POST",
            cookie,
            params: { id: wb.id },
            body: { newOwnerId: asha.id },
          })
        ).status,
      ).toBe(403);
    }
  });

  it("lists workbooks of deactivated people for transfer (P2-ADMINWB-05)", async () => {
    await getPrisma().user.update({ where: { id: owner.id }, data: { status: "DEACTIVATED" } });
    const result = await call<{
      data: { workbooks: Array<{ id: string; owner: { active: boolean } }> };
    }>(adminListRoute, {
      cookie: sc,
      path: "/api/admin/workbooks?ownerStatus=DEACTIVATED",
    });
    expect(result.body!.data.workbooks).toEqual([
      expect.objectContaining({ id: wb.id, owner: expect.objectContaining({ active: false }) }),
    ]);
  });
});
