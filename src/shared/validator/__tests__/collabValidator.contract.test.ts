// The collab validator against the real Rust service (Decision 11, P0-VAL-01..06, P0-VAL-08).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startCollabService } from "@/tests/setup/collabService";
import { createWorkbookValidator } from "../registry";
import { runValidatorContract } from "./validatorContract";
import { minimalXlsx } from "../zip";

let stop: () => Promise<void>;
beforeAll(async () => {
  stop = await startCollabService();
}, 300_000);
afterAll(() => stop?.());

runValidatorContract("collab", () => createWorkbookValidator("collab"));

describe("collab validator, service specifics", () => {
  it("refuses a password-protected looking file (an OLE compound file) (P0-VAL-06)", async () => {
    const ole = new Uint8Array(4096);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(createWorkbookValidator("collab").validate(ole)).rejects.toMatchObject({
      code: "WORKBOOK_UNREADABLE",
    });
  });

  it("reports SERVICE_UNAVAILABLE when the service does not answer (P0-VAL-08)", async () => {
    vi.stubEnv("COLLAB_URL", "http://127.0.0.1:9");
    vi.resetModules();
    const { createWorkbookValidator: fresh } = await import("../registry");
    await expect(fresh("collab").validate(minimalXlsx())).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    vi.unstubAllEnvs();
  });
});
