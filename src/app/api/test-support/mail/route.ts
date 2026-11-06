// Test-only: the newest fake email to an address, so E2E can read sign-up codes (Decision 47).
// Answers 404 unless APP_ENV=test.
import { z } from "zod";
import { AppError } from "@/shared/errors/AppError";
import { route } from "@/shared/http/route";
import { assertTestEnvironment } from "@/shared/http/testOnly";
import { readLatestFakeMail } from "@/shared/mail";

export const GET = route({
  access: "public",
  input: z.object({ to: z.string().max(254) }),
  handler: async ({ input }) => {
    assertTestEnvironment();
    const mail = await readLatestFakeMail(input.to.toLowerCase());
    if (!mail) throw new AppError("NOT_FOUND");
    return { data: { subject: mail.subject, text: mail.text } };
  },
});
