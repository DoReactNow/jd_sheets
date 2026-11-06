// Production first run (Decision 28): roles, the first network rules and the first Super Admin,
// from SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD in the server's env file. Holds no
// secrets itself, so it is committed. Usage: npm run db:seed:private
import { getPrisma } from "../src/shared/db/prisma";
import { runPrivateSeed } from "./seed-private-lib";

 
runPrivateSeed(process.env.SEED_SUPER_ADMIN_EMAIL, process.env.SEED_SUPER_ADMIN_PASSWORD)
  .then((message) => console.log(`[seed] ${message}`))
  .catch((error: unknown) => {
    console.error(`[seed] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => getPrisma().$disconnect());
