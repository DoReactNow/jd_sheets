// Development seed (Decision 28): a few sample workbooks owned by the development principal, so the
// local app has something to show. Uses the golden workbooks (made-up data). Development only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { getEnv } from "../src/shared/config/env";
import { getPrisma } from "../src/shared/db/prisma";
import { DEV_PRINCIPAL } from "../src/shared/rbac/devPrincipal";
import { workbooksService } from "../src/modules/workbooks/workbooks.instance";

const SAMPLES = [
  { title: "Sample: formulas", file: "formulas.xlsx" },
  { title: "Sample: several sheets", file: "sheets.xlsx" },
];

async function main(): Promise<void> {
  const env = getEnv();
  if (env.APP_ENV !== "development") throw new Error("db:seed:dev only runs in development");
  const existing = await workbooksService().list(DEV_PRINCIPAL);
  for (const sample of SAMPLES) {
    if (existing.some((workbook) => workbook.title === sample.title)) continue;
    const bytes = new Uint8Array(readFileSync(path.join(process.cwd(), "golden", sample.file)));
    await workbooksService().createFromBytes(DEV_PRINCIPAL, sample.title, bytes);
    console.log(`[seed-dev] created "${sample.title}"`);
  }
  await getPrisma().$disconnect();
}

main().catch((error: unknown) => {
  console.error(`[seed-dev] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
