// Phase 2 journeys: P2-E2E-01 (journey 4: a Viewer cannot change anything, a Commenter can only
// comment), P2-E2E-02 (journey 5: restore an older version), P2-E2E-03 (the edit lease hands over).
// Content is always checked through the saved file, never by reading the canvas (Rule 18).
import { expect, test, type Browser, type FrameLocator, type Page } from "@playwright/test";
import { signInAndWait } from "./support/auth";
import { cellOf, readZipEntry } from "./support/xlsx";

const SAVE = process.platform === "darwin" ? "Meta+s" : "Control+s";
const OWNER = "member.test@jdfusion.in";
const OTHER = "member2.test@jdfusion.in";

async function editorReady(page: Page): Promise<FrameLocator> {
  const frame = page.frameLocator('[data-testid="editor-frame"]');
  await expect(frame.locator("#gridcraft_canvas")).toBeVisible({ timeout: 60_000 });
  await expect(frame.locator("#gridcraft_loading")).toBeHidden({ timeout: 60_000 });
  return frame;
}

async function focusA1(page: Page, frame: FrameLocator) {
  const box = (await frame.locator("#gridcraft_canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press("Escape", { delay: 60 });
  await page.keyboard.press("Control+Home", { delay: 60 });
  await page.keyboard.press("Control+Home", { delay: 60 });
}

async function typeA1(page: Page, frame: FrameLocator, text: string) {
  await focusA1(page, frame);
  await page.keyboard.type(text, { delay: 60 });
  await page.keyboard.press("Enter", { delay: 60 });
}

async function a1(page: Page, id: string): Promise<string | undefined> {
  const response = await page.request.get(`/api/workbooks/${id}/content`);
  const xml = readZipEntry(Buffer.from(await response.body()), "xl/worksheets/sheet1.xml")!;
  return cellOf(xml, "A1").value ?? undefined;
}

/** Ctrl/Cmd+S saves a version (live: the server saves it); waits until A1 shows `value`. */
async function saveNow(page: Page, id: string, value: string) {
  await page.keyboard.press(SAVE);
  await expect.poll(() => a1(page, id), { timeout: 20_000 }).toBe(value);
}

async function cellAt(page: Page, id: string, ref: string): Promise<string | undefined> {
  const response = await page.request.get(`/api/workbooks/${id}/content`);
  const xml = readZipEntry(Buffer.from(await response.body()), "xl/worksheets/sheet1.xml")!;
  return cellOf(xml, ref).value ?? undefined;
}

async function ownerWorkbook(page: Page, value: string): Promise<string> {
  await signInAndWait(page, OWNER);
  await page
    .getByRole("button", { name: /New workbook|Create your first workbook/ })
    .first()
    .click();
  await page.waitForURL(/\/w\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  const frame = await editorReady(page);
  // The live service runs in these journeys: the editor must be live, not on the fallback.
  await expect(page.getByTestId("live-status")).toHaveText("Live", { timeout: 30_000 });
  await typeA1(page, frame, value);
  await saveNow(page, id, value);
  return id;
}

async function asOther(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAndWait(page, OTHER);
  return { context, page };
}

async function otherUserId(page: Page): Promise<string> {
  const found = await page.request.get(
    `/api/share-targets?q=${encodeURIComponent("Test Member Two")}`,
  );
  return (await found.json()).data.users[0].id as string;
}

test("journey 4: a Viewer cannot change anything; a Commenter can only comment", async ({
  page,
  browser,
}) => {
  const id = await ownerWorkbook(page, "111");

  // Share through the dialog.
  await page.getByRole("button", { name: "Share" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name, email or group").fill("Test Member Two");
  await dialog.getByRole("button", { name: /Test Member Two/ }).click();
  await dialog.getByRole("button", { name: "Share", exact: true }).click();
  await expect(dialog.getByText("member2.test@jdfusion.in")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();

  // The Viewer: view mode; typing and saving change nothing, and nothing is sent.
  const other = await asOther(browser);
  await other.page.goto(`/w/${id}`);
  await expect(other.page.getByTestId("editor-mode")).toHaveText("View only");
  const viewerFrame = await editorReady(other.page);
  const puts: string[] = [];
  other.page.on("request", (r) => r.method() === "PUT" && puts.push(r.url()));
  await typeA1(other.page, viewerFrame, "222");
  await other.page.keyboard.press(SAVE);
  await other.page.waitForTimeout(1_500);
  expect(puts).toEqual([]);
  expect(await a1(page, id)).toBe("111");
  // And the API refuses a Viewer's save directly (P2-MODE-03).
  const direct = await other.page.request.put(`/api/workbooks/${id}/content`, {
    headers: {
      "if-match": `"00000000-0000-7000-8000-000000000000"`,
      origin: new URL(page.url()).origin,
    },
    data: Buffer.from("x"),
  });
  expect(direct.status()).toBe(403);

  // Now a Commenter: comment mode; content changes are put back.
  const grants = await (await page.request.get(`/api/workbooks/${id}/shares`)).json();
  await page.request.patch(`/api/workbooks/${id}/shares/${grants.data.grants[0].id}`, {
    data: { role: "COMMENTER" },
    headers: { origin: new URL(page.url()).origin },
  });
  await other.page.reload();
  await expect(other.page.getByTestId("editor-mode")).toHaveText(/Comment only/);
  const commenterFrame = await editorReady(other.page);
  await typeA1(other.page, commenterFrame, "333");
  await other.page.keyboard.press(SAVE);
  await other.page.waitForTimeout(1_500);
  expect(await a1(page, id)).toBe("111");
  await other.context.close();
});

test("journey 5: restore an older version", async ({ page }) => {
  const id = await ownerWorkbook(page, "444");
  const frame = await editorReady(page);
  await typeA1(page, frame, "555");
  await saveNow(page, id, "555");

  await page.getByRole("button", { name: "History" }).click();
  const versions = page.getByRole("dialog").getByRole("listitem");
  await expect(versions).toHaveCount(3);
  // Newest first: 3 (bad), 2 (good), 1 (blank). Restore version 2.
  const restored = page.waitForResponse(
    (r) => r.url().includes("/restore") && r.request().method() === "POST",
  );
  await versions.nth(1).getByRole("button", { name: "Restore" }).click();
  expect((await restored).status()).toBe(200);
  await page.waitForLoadState("load");
  await expect.poll(() => a1(page, id), { timeout: 20_000 }).toBe("444");
  const history = await (await page.request.get(`/api/workbooks/${id}/versions`)).json();
  expect(history.data.items.map((v: { number: number }) => v.number)).toEqual([4, 3, 2, 1]);
  expect(history.data.items[0]).toMatchObject({ source: "RESTORE", restoredFromNumber: 2 });
});

test("journey 7: two people edit the same workbook live and end with the same values", async ({
  page,
  browser,
}) => {
  const id = await ownerWorkbook(page, "100");
  const other = await asOther(browser);
  await page.request.put(`/api/workbooks/${id}/shares`, {
    data: { target: { type: "user", id: await otherUserId(page) }, role: "EDITOR" },
    headers: { origin: new URL(page.url()).origin },
  });
  await other.page.goto(`/w/${id}`);
  const otherFrame = await editorReady(other.page);
  await expect(other.page.getByTestId("live-status")).toHaveText("Live", { timeout: 30_000 });
  // Each sees the other in the workbook (P3-PRES-01).
  await expect(
    page.getByRole("list", { name: "People in this workbook" }).getByRole("listitem"),
  ).toHaveCount(2, { timeout: 15_000 });
  await expect(
    other.page.getByRole("list", { name: "People in this workbook" }).getByRole("listitem"),
  ).toHaveCount(2);

  // Both type at the same time, into different cells.
  const ownerFrame = page.frameLocator('[data-testid="editor-frame"]');
  await Promise.all([
    typeA1(page, ownerFrame, "200"),
    typeCell(other.page, otherFrame, "B1", "300"),
  ]);
  await page.keyboard.press(SAVE);
  await expect
    .poll(async () => [await cellAt(page, id, "A1"), await cellAt(page, id, "B1")], {
      timeout: 20_000,
    })
    .toEqual(["200", "300"]);
  await other.context.close();
});

async function typeCell(page: Page, frame: FrameLocator, ref: "B1", text: string) {
  await focusA1(page, frame);
  if (ref === "B1") await page.keyboard.press("ArrowRight", { delay: 60 });
  await page.keyboard.type(text, { delay: 60 });
  await page.keyboard.press("Enter", { delay: 60 });
}
