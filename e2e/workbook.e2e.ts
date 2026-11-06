// Critical journey 3 (P0-E2E-01): create a workbook, type values and a formula, save, reload; the
// values are there. Checked through the saved file, never by reading the canvas (Rule 18).
import { expect, test, type Page } from "@playwright/test";
import { signInAndWait } from "./support/auth";
import { cellOf, readZipEntry } from "./support/xlsx";

const SAVE = process.platform === "darwin" ? "Meta+s" : "Control+s";

async function waitForEditor(page: Page) {
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 60_000 });
  const frame = page.frameLocator('[data-testid="editor-frame"]');
  await expect(frame.locator("#gridcraft_canvas")).toBeVisible();
  // GridCraft hides its loading text once the first frame is drawn.
  await expect(frame.locator("#gridcraft_loading")).toBeHidden({ timeout: 30_000 });
  return frame;
}

async function savedSheet(page: Page, workbookId: string): Promise<string> {
  const response = await page.request.get(`/api/workbooks/${workbookId}/content`);
  expect(response.ok()).toBe(true);
  const xml = readZipEntry(Buffer.from(await response.body()), "xl/worksheets/sheet1.xml");
  expect(xml).not.toBeNull();
  return xml!;
}

test("create, type values and a formula, save, reload", async ({ page }) => {
  await signInAndWait(page, "member.test@jdfusion.in");
  await page
    .getByRole("button", { name: /New workbook|Create your first workbook/ })
    .first()
    .click();
  await page.waitForURL(/\/w\/[0-9a-f-]{36}$/);
  const workbookId = page.url().split("/").pop()!;
  const frame = await waitForEditor(page);

  // Focus the grid and start from A1.
  const canvas = frame.locator("#gridcraft_canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // The first key after the canvas takes focus can be used to settle it, so harmless keys go
  // first: Escape (nothing to cancel) and Control+Home (go to A1).
  await page.keyboard.press("Escape", { delay: 60 });
  await page.keyboard.press("Control+Home", { delay: 60 });
  await page.keyboard.press("Control+Home", { delay: 60 });
  // The canvas editor reads keys frame by frame; type at a human pace and confirm each entry by
  // watching the status change (no fixed sleeps).
  for (const input of ["10", "20", "=SUM(A1:A2)"]) {
    await page.keyboard.type(input, { delay: 60 });
    await page.keyboard.press("Enter", { delay: 60 });
  }
  await expect(page.getByRole("status")).toHaveText("Unsaved changes");

  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/workbooks/${workbookId}/content`) && r.request().method() === "PUT",
  );
  await page.keyboard.press(SAVE);
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole("status")).toHaveText("Saved");

  const xml = await savedSheet(page, workbookId);
  expect(cellOf(xml, "A1").value).toBe("10");
  expect(cellOf(xml, "A2").value).toBe("20");
  expect(cellOf(xml, "A3")).toEqual({ formula: "SUM(A1:A2)", value: "30" });

  // Reload: the editor opens the saved version.
  await page.reload();
  await waitForEditor(page);
  const meta = await page.request.get(`/api/workbooks/${workbookId}`);
  expect((await meta.json()).data.currentVersionNumber).toBe(2);

  // Back on the home screen, the workbook is listed.
  await page.getByRole("link", { name: "Back to your workbooks" }).click();
  await expect(page.getByRole("link", { name: /Untitled workbook/ }).first()).toBeVisible();
});
