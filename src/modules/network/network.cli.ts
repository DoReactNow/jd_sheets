// Recovery command (Decision 46, P1-NET-14):
//   npm run admin:reset-ip-rules -- --cidr <address or range>
// Replaces every rule with one range, so people on that network can reach the app again.
import { getPrisma } from "@/shared/db/prisma";
import { networkService } from "./network.service";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const index = args.indexOf("--cidr");
  const cidr = index >= 0 ? args[index + 1] : undefined;
  try {
    if (args[0] !== "reset-ip-rules" || !cidr) {
      throw new Error("usage: npm run admin:reset-ip-rules -- --cidr <address or range>");
    }
    const applied = await networkService.resetTo(cidr);
    console.log(`[network] the only allowed range is now ${applied}`);
  } catch (error) {
    console.error(`[network] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await getPrisma().$disconnect();
  }
}

if (require.main === module) void main();
