// Journeys 1, 2 and 6 (P1-E2E-01..03): signing in as each role, signing up with an emailed code
// and being approved, and being refused from another network.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PASSWORD, signIn, signInAndWait, signOut } from "./support/auth";

test("each role signs in; pending and rejected people see only their status (journey 1)", async ({
  page,
}) => {
  await signInAndWait(page, "member.test@jdfusion.in");
  await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  await signOut(page);

  await signInAndWait(page, "admin.test@jdfusion.in");
  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(page.getByRole("link", { name: /Approvals/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Users" })).toBeVisible();
  await signOut(page);

  await signInAndWait(page, "superadmin.test@jdfusion.in");
  await page.goto("/admin/network");
  await expect(page.getByRole("heading", { name: "Network access" })).toBeVisible();
  await signOut(page);

  await signIn(page, "pending.test@jdfusion.in");
  await expect(page.getByTestId("status-pending")).toBeVisible();
  // Not signed in: the main address is the sign-in form (Decision 65).
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await signIn(page, "rejected.test@jdfusion.in");
  await expect(page.getByTestId("status-rejected")).toBeVisible();
});

test("sign up with an emailed code, get approved, sign in (journey 2)", async ({
  page,
  request,
}) => {
  const email = `new-${randomUUID().slice(0, 8)}.test@jdfusion.in`;
  await page.goto("/request-access");
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();

  // The worker sends the code (identity.sendOtp); the fake mailer keeps it for the test-only route.
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/test-support/mail?to=${encodeURIComponent(email)}`,
        );
        if (!response.ok()) return null;
        code = /(\d{6})/.exec((await response.json()).data.text)?.[1] ?? null;
        return code;
      },
      { timeout: 30_000 },
    )
    .toMatch(/^\d{6}$/);

  await page.getByLabel("Code").fill(code!);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name").fill("Rohan Test");
  await page.getByLabel("Password", { exact: true }).fill("a long enough password");
  await page.getByLabel("Repeat the password").fill("a long enough password");
  await page.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByTestId("request-sent")).toBeVisible();

  await signInAndWait(page, "admin.test@jdfusion.in");
  await page.goto("/admin/approvals");
  const row = page.getByRole("row", { name: new RegExp(email.replace(/[.]/g, "\\.")) });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row).toHaveCount(0);
  await signOut(page);

  await signIn(page, email.toUpperCase(), "a long enough password");
  await expect(page.getByRole("heading", { name: "Your workbooks" })).toBeVisible();
});

test.describe("from another network (journey 6)", () => {
  test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.7" } });

  test("sees the blocked page and cannot call the API", async ({ page, request }) => {
    // Sign-in is the main address and opens from every network (Decision 65); everything else
    // shows the blocked page.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.goto("/admin");
    await expect(page.getByTestId("blocked-page")).toBeVisible();
    // Signing in from outside as anyone but the Super Admin shows the blocked page, not the list.
    await page.goto("/");
    await page.getByLabel("Email").fill("member.test@jdfusion.in");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("blocked-page")).toBeVisible();
    const api = await request.post("/api/auth/sign-in", {
      data: { email: "member.test@jdfusion.in", password: PASSWORD },
    });
    expect(api.status()).toBe(403);
    expect((await api.json()).error.code).toBe("NETWORK_BLOCKED");
  });
});

test("everyone changes their own name on the Profile page (P4-NAME-01, Decision 66)", async ({
  page,
}) => {
  await signInAndWait(page, "member.test@jdfusion.in");
  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
  await page.getByLabel("Name").fill("Ravi Kumar");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await expect(page.getByRole("banner").getByRole("link", { name: "Ravi Kumar" })).toBeVisible();
  // Put the seeded name back for the other journeys.
  const original = "Test Member";
  await page.getByLabel("Name").fill(original);
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("banner").getByRole("link", { name: original })).toBeVisible();
  await signOut(page);
});
