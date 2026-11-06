// The test seed (Decision 28): runs against the TEST database only, after the migrations.
// Phase 0 has no users; tests create the workbooks they need through the service, so the seed
// only checks it is pointed at a test database. Phase 1 adds one user per role.
import { getEnv } from "../src/shared/config/env";

export async function runTestSeed(): Promise<void> {
  const env = getEnv();
  if (env.APP_ENV !== "test" || !env.databaseName.endsWith("_test")) {
    throw new Error("The test seed only runs against a _test database with APP_ENV=test");
  }
}

if (require.main === module) {
  runTestSeed().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
