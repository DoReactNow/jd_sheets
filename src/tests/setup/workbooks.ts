import { plusDuration, systemClock } from "@/shared/time";
// Workbook helpers for integration tests that go through the real routes with a session cookie.
import { POST as createRoute } from "@/app/api/workbooks/route";
import { call } from "./session";

export interface TestWorkbook {
  id: string;
  title: string;
  currentVersionId: string;
  role: string;
}

export async function createWorkbookAs(cookie: string, title = "Book"): Promise<TestWorkbook> {
  const result = await call<{ data: TestWorkbook }>(createRoute, {
    method: "POST",
    cookie,
    body: { title },
  });
  if (result.status !== 201) throw new Error(`create failed: ${result.status}`);
  return result.body!.data;
}

/** A tab id for tests (matches the editor's format). */
export const TEST_TAB = "test-tab-0001";

/**
 * Gives `userId` the edit lease on a workbook for TEST_TAB, with a session row of its own, for
 * tests that call the save route with test principals (Phase 0 style) instead of a sign-in.
 */
export async function holdLease(
  userId: string,
  workbookId: string,
  tabId = TEST_TAB,
): Promise<void> {
  const { getPrisma } = await import("@/shared/db/prisma");
  const { randomBytes } = await import("node:crypto");
  const prisma = getPrisma();
  const far = plusDuration(systemClock.now(), { hours: 1 });
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: randomBytes(32).toString("hex"),
      expiresAt: far,
      absoluteExpiresAt: far,
    },
  });
  await prisma.editLease.upsert({
    where: { workbookId },
    create: { workbookId, userId, sessionId: session.id, tabId, expiresAt: far },
    update: { userId, sessionId: session.id, tabId, expiresAt: far },
  });
}

/** The test user's principal with a real session row (the lease needs one). */
export async function principalWithSession<T extends { id: string; principal: object }>(
  user: T,
): Promise<T["principal"] & { sessionId: string }> {
  const { getPrisma } = await import("@/shared/db/prisma");
  const { randomBytes } = await import("node:crypto");
  const far = plusDuration(systemClock.now(), { hours: 1 });
  const session = await getPrisma().session.create({
    data: {
      userId: user.id,
      tokenHash: randomBytes(32).toString("hex"),
      expiresAt: far,
      absoluteExpiresAt: far,
    },
  });
  return { ...user.principal, sessionId: session.id };
}
