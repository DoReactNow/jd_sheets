// W-013: workbooks API against the real test database and the test storage folder, with the fake
// validator (P0-WB-01..12, X-ACCESS-01/05/06, X-INPUT-01/04/05/07, X-DATA-01/04).
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as listRoute, POST as createRoute } from "@/app/api/workbooks/route";
import { GET as getRoute } from "@/app/api/workbooks/[id]/route";
import { GET as contentRoute, PUT as saveRoute } from "@/app/api/workbooks/[id]/content/route";
import { resolveWorkbookRoleForOwner } from "@/modules/workbooks";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { ERROR_CATALOG } from "@/shared/errors/errorCatalog";
import { configureWorkbookRoleResolver } from "@/shared/rbac/workbookAccess";
import { getFileStorage } from "@/shared/storage";
import { minimalXlsx } from "@/shared/validator";
import { callRoute } from "@/tests/setup/callRoute";
import { actAs, stopActing, testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { resetTestStorage } from "@/tests/setup/testStorage";

const asha = testPrincipal("MEMBER");
const ravi = testPrincipal("MEMBER");

interface Wb {
  id: string;
  title: string;
  currentVersionId: string;
  currentVersionNumber: number;
  sizeBytes: number;
  role: string;
}

async function create(title?: string): Promise<Wb> {
  const result = await callRoute<{ data: Wb }>(createRoute, {
    method: "POST",
    path: "/api/workbooks",
    body: title === undefined ? {} : { title },
  });
  expect(result.status).toBe(201);
  return result.body!.data;
}

async function save(id: string, bytes: Uint8Array, ifMatch?: string) {
  const headers: Record<string, string> = { "content-type": APP_CONFIG.workbooks.mediaType };
  if (ifMatch !== undefined) headers["if-match"] = ifMatch;
  const response = await saveRoute(
    new Request(`http://127.0.0.1/api/workbooks/${id}/content`, {
      method: "PUT",
      headers,
      body: new Uint8Array(bytes),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: response.status, body: await response.json(), headers: response.headers };
}

async function content(id: string) {
  const response = await contentRoute(new Request(`http://127.0.0.1/api/workbooks/${id}/content`), {
    params: Promise.resolve({ id }),
  });
  return response;
}

beforeAll(() => {
  configureWorkbookRoleResolver(resolveWorkbookRoleForOwner);
});
beforeEach(async () => {
  await resetDatabase();
  resetTestStorage();
  actAs(asha);
});
afterEach(() => stopActing());
afterAll(() => getPrisma().$disconnect());

describe("creating workbooks (P0-WB-01, P0-WB-09)", () => {
  it("stores version 1 from the blank workbook, with rows and a file", async () => {
    const wb = await create("Budget November");
    expect(wb).toMatchObject({ title: "Budget November", currentVersionNumber: 1, role: "OWNER" });
    const versions = await getPrisma().workbookVersion.findMany({ where: { workbookId: wb.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ source: "CREATE", number: 1 });
    expect(versions[0].storageKey).toBe(`workbooks/${wb.id}/${versions[0].id}.xlsx`);
    expect(await getFileStorage().exists(versions[0].storageKey)).toBe(true);
  });

  it("uses the default title when none is given, and trims titles", async () => {
    expect((await create()).title).toBe(APP_CONFIG.workbooks.defaultTitle);
    expect((await create("  Q4 plan  ")).title).toBe("Q4 plan");
  });

  it("keeps any script, emoji and quotes, and stores HTML-looking titles as text (X-INPUT-04/05)", async () => {
    for (const title of ["चाय का हिसाब 📊", 'Asha\'s "plan"', "<script>alert(1)</script>"]) {
      expect((await create(title)).title).toBe(title);
    }
  });

  it.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["too long", "x".repeat(APP_CONFIG.workbooks.titleMaxLength + 1)],
    ["a control character", "Budget\u0007"],
    ["not text", 42],
  ])("refuses a title that is %s with a field message", async (_label, title) => {
    const result = await callRoute(createRoute, {
      method: "POST",
      path: "/api/workbooks",
      body: { title },
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: { code: "VALIDATION_FAILED", fieldErrors: [{ field: "title" }] },
    });
    expect(await getPrisma().workbook.count()).toBe(0);
  });

  it("ignores unknown fields (X-INPUT-02)", async () => {
    const result = await callRoute<{ data: Wb }>(createRoute, {
      method: "POST",
      path: "/api/workbooks",
      body: { title: "A", ownerId: ravi.userId, id: "x" },
    });
    expect(result.status).toBe(201);
    const row = await getPrisma().workbook.findUnique({ where: { id: result.body!.data.id } });
    expect(row?.ownerId).toBe(asha.userId);
  });

  it("refuses a signed-out caller (X-ACCESS-01)", async () => {
    actAs(null);
    expect(
      (await callRoute(createRoute, { method: "POST", path: "/api/workbooks", body: {} })).status,
    ).toBe(401);
    expect((await callRoute(listRoute, { path: "/api/workbooks" })).status).toBe(401);
  });
});

describe("listing (P0-WB-02, X-ACCESS-06)", () => {
  it("lists only the caller's workbooks, last changed first", async () => {
    const first = await create("First");
    const second = await create("Second");
    actAs(ravi);
    await create("Ravi's");
    actAs(asha);
    await save(first.id, minimalXlsx({ A1: "1" }), `"${first.currentVersionId}"`);
    const result = await callRoute<{ data: Wb[] }>(listRoute, { path: "/api/workbooks" });
    expect(result.body!.data.map((w) => w.title)).toEqual(["First", "Second"]);
    expect(result.body!.data.map((w) => w.id)).toEqual([first.id, second.id]);
  });
});

describe("reading (P0-WB-03, P0-WB-10, X-ACCESS-05)", () => {
  it("streams the current version's bytes with its version as ETag", async () => {
    const wb = await create("Read me");
    const response = await content(wb.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(`"${wb.currentVersionId}"`);
    expect(response.headers.get("content-type")).toBe(APP_CONFIG.workbooks.mediaType);
    expect(response.headers.get("content-disposition")).toContain("Read me.xlsx");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(bytes.subarray(0, 2)).toString()).toBe("PK");
    expect(Number(response.headers.get("content-length"))).toBe(bytes.byteLength);
  });

  it("answers 404 for an unknown ID, a malformed ID and someone else's workbook", async () => {
    const wb = await create("Mine");
    const ids = ["0190f1e2-0000-7000-8000-000000000999", "not-an-id"];
    for (const id of ids) {
      expect((await content(id)).status).toBe(404);
      expect((await callRoute(getRoute, { path: "/api/w", params: { id } })).status).toBe(404);
    }
    actAs(ravi);
    const other = await content(wb.id);
    expect(other.status).toBe(404);
    expect(await other.json()).toMatchObject({
      error: { code: "NOT_FOUND", message: ERROR_CATALOG.NOT_FOUND.message },
    });
    expect((await save(wb.id, minimalXlsx(), `"${wb.currentVersionId}"`)).status).toBe(404);
  });

  it("returns the workbook's details with the caller's role", async () => {
    const wb = await create("Details");
    const result = await callRoute(getRoute, { path: "/api/w", params: { id: wb.id } });
    expect(result.body).toMatchObject({ data: { id: wb.id, title: "Details", role: "OWNER" } });
  });
});

describe("saving (P0-WB-04..08, P0-WB-11, P0-WB-12)", () => {
  it("saves on top of the current version and moves the pointer", async () => {
    const wb = await create("Save me");
    const bytes = minimalXlsx({ A1: "42", B1: "Budget" });
    const result = await save(wb.id, bytes, `"${wb.currentVersionId}"`);
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ number: 2, sizeBytes: bytes.byteLength });
    expect(result.headers.get("etag")).toBe(`"${result.body.data.versionId}"`);
    const after = await content(wb.id);
    expect(after.headers.get("etag")).toBe(`"${result.body.data.versionId}"`);
    expect(Buffer.from(await after.arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
    const row = await getPrisma().workbookVersion.findUnique({
      where: { id: result.body.data.versionId },
    });
    expect(row).toMatchObject({ source: "SAVE", number: 2, createdById: asha.userId });
  });

  it("accepts a bare version ID in If-Match and marks autosaves", async () => {
    const wb = await create("Bare");
    const response = await saveRoute(
      new Request(`http://127.0.0.1/api/workbooks/${wb.id}/content?autosave=1`, {
        method: "PUT",
        headers: { "if-match": wb.currentVersionId },
        body: new Uint8Array(minimalXlsx()),
      }),
      { params: Promise.resolve({ id: wb.id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const row = await getPrisma().workbookVersion.findUnique({
      where: { id: body.data.versionId },
    });
    expect(row?.source).toBe("AUTOSAVE");
  });

  it("refuses a save based on an old version; nothing is written", async () => {
    const wb = await create("Conflict");
    const first = await save(wb.id, minimalXlsx({ A1: "1" }), `"${wb.currentVersionId}"`);
    expect(first.status).toBe(200);
    const stale = await save(wb.id, minimalXlsx({ A1: "2" }), `"${wb.currentVersionId}"`);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: "WORKBOOK_CHANGED" } });
    expect(await getPrisma().workbookVersion.count({ where: { workbookId: wb.id } })).toBe(2);
  });

  it("refuses a save without If-Match", async () => {
    const wb = await create("No base");
    const result = await save(wb.id, minimalXlsx());
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("lets exactly one of two simultaneous saves on the same base win", async () => {
    const wb = await create("Race");
    const base = `"${wb.currentVersionId}"`;
    const results = await Promise.all([
      save(wb.id, minimalXlsx({ A1: "a" }), base),
      save(wb.id, minimalXlsx({ A1: "b" }), base),
      save(wb.id, minimalXlsx({ A1: "c" }), base),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await getPrisma().workbookVersion.count({ where: { workbookId: wb.id } })).toBe(2);
  });

  it("refuses an unreadable file; no version is written", async () => {
    const wb = await create("Bad file");
    const result = await save(
      wb.id,
      new TextEncoder().encode("not a workbook"),
      `"${wb.currentVersionId}"`,
    );
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ error: { code: "WORKBOOK_UNREADABLE" } });
    expect(await getPrisma().workbookVersion.count({ where: { workbookId: wb.id } })).toBe(1);
  });

  it("refuses a file over the size limit before reading it all", async () => {
    const wb = await create("Too big");
    const big = new Uint8Array(APP_CONFIG.workbooks.maxBytes + 1);
    const result = await save(wb.id, big, `"${wb.currentVersionId}"`);
    expect(result.status).toBe(413);
    expect(result.body).toMatchObject({ error: { code: "WORKBOOK_TOO_LARGE" } });
  });

  it("keeps no version row when storing the file fails (P0-WB-07)", async () => {
    const wb = await create("Storage fails");
    // Make the workbook's storage folder a file, so writing under it fails.
    const dir = `${getEnv().STORAGE_LOCAL_DIR}/workbooks/${wb.id}`;
    const { rmSync, writeFileSync } = await import("node:fs");
    rmSync(dir, { recursive: true, force: true });
    writeFileSync(dir, "blocker");
    const result = await save(wb.id, minimalXlsx(), `"${wb.currentVersionId}"`);
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toMatch(/ENOTDIR|EEXIST|storage/);
    expect(await getPrisma().workbookVersion.count({ where: { workbookId: wb.id } })).toBe(1);
    rmSync(dir, { force: true });
  });
});

describe("storage keys (X-DATA-01, X-DATA-04)", () => {
  it("contain IDs only, and no bytes are in the database", async () => {
    const wb = await create("Secret plan for Asha");
    const versions = await getPrisma().workbookVersion.findMany();
    for (const version of versions) {
      expect(version.storageKey).not.toMatch(/Secret|Asha/);
      expect(version.storageKey).toMatch(/^workbooks\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.xlsx$/);
    }
    const sample = readFileSync(`${getEnv().STORAGE_LOCAL_DIR}/${versions[0].storageKey}`);
    expect(sample.length).toBe(wb.sizeBytes);
  });
});
