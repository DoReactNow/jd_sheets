// The "fake" mailer (Decision 47): messages go to the mail_outbox table, shared by the app, the
// worker and the tests. In development the message is also logged, so sign-up can be tried
// locally. Never used in production (the env loader refuses it).
import { getPrisma } from "@/shared/db/prisma";
import type { Logger } from "@/shared/logger";
import type { Mailer } from "../mailer";

export function createFakeMailer({
  logToConsole,
  logger,
}: {
  logToConsole: boolean;
  logger: Pick<Logger, "info">;
}): Mailer {
  return {
    driver: "fake",
    async send(message) {
      await getPrisma().mailOutbox.create({ data: message });
      if (logToConsole) {
        logger.info("fake mailer: message not sent, shown here instead", {
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
      }
    },
  };
}

/** Test-only: the newest message to an address. */
export async function latestFakeMail(to: string) {
  return getPrisma().mailOutbox.findFirst({ where: { to }, orderBy: { createdAt: "desc" } });
}
