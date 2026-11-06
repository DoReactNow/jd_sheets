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

async function saveNow(page: Page, id: string) {
  const saved = page.waitForResponse(
    (r) => r.url().includes(`/api/workbooks/${id}/content`) && r.request().method() === "PUT",
  );
  await page.keyboard.press(SAVE);
  expect((await saved).status()).toBe(200);
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
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 30_000 });
  await typeA1(page, frame, value);
  await saveNow(page, id);
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
  const id = await ownerWorkbook(page, "owner's");

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
  await typeA1(other.page, viewerFrame, "viewer");
  await other.page.keyboard.press(SAVE);
  await other.page.waitForTimeout(1_500);
  expect(puts).toEqual([]);
  expect(await a1(page, id)).toBe("owner's");
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
  await typeA1(other.page, commenterFrame, "commenter");
  await other.page.keyboard.press(SAVE);
  await other.page.waitForTimeout(1_500);
  expect(await a1(page, id)).toBe("owner's");
  await other.context.close();
});

test("journey 5: restore an older version", async ({ page }) => {
  const id = await ownerWorkbook(page, "good");
  const frame = await editorReady(page);
  await typeA1(page, frame, "bad");
  await saveNow(page, id);
  expect(await a1(page, id)).toBe("bad");

  await page.getByRole("button", { name: "History" }).click();
  const versions = page.getByRole("dialog").getByRole("listitem");
  await expect(versions).toHaveCount(3);
  // Newest first: 3 (bad), 2 (good), 1 (blank). Restore version 2.
  await versions.nth(1).getByRole("button", { name: "Restore" }).click();
  await editorReady(page);
  expect(await a1(page, id)).toBe("good");
  const history = await (await page.request.get(`/api/workbooks/${id}/versions`)).json();
  expect(history.data.items.map((v: { number: number }) => v.number)).toEqual([4, 3, 2, 1]);
  expect(history.data.items[0]).toMatchObject({ source: "RESTORE", restoredFromNumber: 2 });
});

test("the edit lease: a second Editor sees who is editing and takes over after they leave", async ({
  page,
  browser,
}) => {
  const id = await ownerWorkbook(page, "mine");
  const other = await asOther(browser);
  await page.request.put(`/api/workbooks/${id}/shares`, {
    data: { target: { type: "user", id: await otherUserId(page) }, role: "EDITOR" },
    headers: { origin: new URL(page.url()).origin },
  });
  await other.page.goto(`/w/${id}`);
  await expect(other.page.getByText("Test Member is editing")).toBeVisible({ timeout: 30_000 });
  await expect(other.page.getByTestId("editor-mode")).toHaveText("View only");

  // The first Editor leaves; the lease is released on the way out.
  await page.getByRole("link", { name: "Back to your workbooks" }).click();
  await expect(page.getByRole("heading", { name: "Your workbooks" })).toBeVisible();
  await expect
    .poll(
      async () => {
        await other.page
          .getByRole("button", { name: "Refresh" })
          .click({ timeout: 2_000 })
          .catch(() => undefined);
        return other.page
          .getByRole("status")
          .filter({ hasText: /^Saved$/ })
          .count();
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  const frame = await editorReady(other.page);
  await typeA1(other.page, frame, "theirs");
  await saveNow(other.page, id);
  expect(await a1(page, id)).toBe("theirs");
  await other.context.close();
});
