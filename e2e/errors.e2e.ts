// Critical journey 8 (P0-E2E-02): friendly 404 pages and the friendly 500 envelope.
import { expect, test } from "@playwright/test";

test("an unknown page shows the friendly 404 page", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to your workbooks" })).toBeVisible();
});

test("an unknown workbook shows a friendly message, not a crash", async ({ page }) => {
  await page.goto("/w/0190f1e2-0000-7000-8000-000000000999");
  await expect(page.getByRole("heading", { name: "Couldn't open this workbook" })).toBeVisible();
  await expect(page.getByText("We couldn't find what you were looking for.")).toBeVisible();
});

test("an unexpected server failure answers the friendly envelope with a reference", async ({
  request,
}) => {
  const response = await request.get("/api/test-support/fail");
  expect(response.status()).toBe(500);
  const body = await response.json();
  expect(body.error.code).toBe("INTERNAL");
  expect(body.error.message).toBe("Something went wrong on our side. Please try again.");
  expect(body.error.requestId).toMatch(/[0-9a-f-]{36}/);
  expect(JSON.stringify(body)).not.toMatch(/deliberate|stack|Error:/);
});
