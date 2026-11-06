// P0-JOB-04, X-JOB-01, X-JOB-05: the orphan cleanup deletes only unreferenced, old files.
import { utimesSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { getFileStorage, workbookVersionKey } from "@/shared/storage";
import { createTestClock, parseInstant } from "@/shared/time";
import { createWorkbookValidator, minimalXlsx } from "@/shared/validator";
import { testPrincipal } from "@/tests/setup/principals";
import { resetDatabase } from "@/tests/setup/resetDatabase";
import { resetTestStorage } from "@/tests/setup/testStorage";
import { workbooksRepository } from "../workbooks.repository";
import { createWorkbooksService } from "../workbooks.service";

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const clock = createTestClock("2027-01-10T00:00:00Z");
const service = createWorkbooksService({
  repository: workbooksRepository,
  storage: getFileStorage(),
  validator: createWorkbookValidator("fake"),
  clock,
  logger: quiet,
});
const owner = testPrincipal("MEMBER");

const ageFile = (key: string, isoTime: string) => {
  const when = parseInstant(isoTime);
  utimesSync(`${getEnv().STORAGE_LOCAL_DIR}/${key}`, when, when);
};

beforeEach(async () => {
  await resetDatabase();
  resetTestStorage();
});
afterAll(() => getPrisma().$disconnect());

describe("workbooks.purgeOrphanFiles", () => {
  it("deletes old unreferenced files, keeps referenced and recent ones, and is idempotent", async () => {
    const wb = await service.create(owner, { title: "Kept" });
    const versions = await getPrisma().workbookVersion.findMany();
    const referenced = versions[0].storageKey;
    ageFile(referenced, "2026-01-01T00:00:00Z"); // old but referenced: must stay

    const oldOrphan = workbookVersionKey(wb.id, "0190f1e2-0000-7000-8000-000000000001");
    const newOrphan = workbookVersionKey(wb.id, "0190f1e2-0000-7000-8000-000000000002");
    await getFileStorage().put(oldOrphan, minimalXlsx(), "x");
    await getFileStorage().put(newOrphan, minimalXlsx(), "x");
    ageFile(oldOrphan, "2027-01-08T00:00:00Z"); // two days old: past the grace period
    ageFile(newOrphan, "2027-01-09T23:00:00Z"); // one hour old: within it

    expect(await service.purgeOrphanFiles()).toBe(1);
    expect(await getFileStorage().exists(oldOrphan)).toBe(false);
    expect(await getFileStorage().exists(newOrphan)).toBe(true);
    expect(await getFileStorage().exists(referenced)).toBe(true);
    expect(await service.purgeOrphanFiles()).toBe(0);
  });
});
