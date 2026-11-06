// Test-only: always fails, so E2E can check the friendly 500 page and envelope (journey 8).
// Answers 404 unless APP_ENV=test.
import { assertTestEnvironment } from "@/shared/http/testOnly";
import { route } from "@/shared/http/route";

export const GET = route({
  access: "public",
  handler: async () => {
    assertTestEnvironment();
    throw new Error("test-support: deliberate failure");
  },
});
