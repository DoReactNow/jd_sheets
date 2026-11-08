// Signing in through the real form as a seeded test user (prisma/seed-test.ts).
import { expect, type Page } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.test", override: true, quiet: true });
export const PASSWORD = process.env.TEST_USER_PASSWORD ?? "";

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function signInAndWait(page: Page, email: string) {
  await signIn(page, email);
  await expect(page.getByRole("heading", { name: "Your workbooks" })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}
