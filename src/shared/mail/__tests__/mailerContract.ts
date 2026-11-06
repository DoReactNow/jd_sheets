// The mailer contract (Rule 12): every Mailer implementation must pass this suite.
import { describe, expect, it } from "vitest";
import type { Mailer, MailMessage } from "../mailer";

export interface MailerHarness {
  mailer: () => Mailer;
  /** The messages the implementation delivered, oldest first. */
  delivered: (to: string) => Promise<MailMessage[]>;
}

let seq = 0;

export function mailerContract(name: string, harness: MailerHarness) {
  describe(`mailer contract: ${name}`, () => {
    it("delivers the subject and text to the recipient", async () => {
      const to = `contract-${(seq += 1)}@jdfusion.in`;
      await harness.mailer().send({ to, subject: "Your code", text: "Your code is 123456." });
      const got = await harness.delivered(to);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ to, subject: "Your code" });
      expect(got[0]?.text).toContain("Your code is 123456.");
    });

    it("keeps separate messages separate", async () => {
      const to = `contract-two-${(seq += 1)}@jdfusion.in`;
      await harness.mailer().send({ to, subject: "One", text: "first" });
      await harness.mailer().send({ to, subject: "Two", text: "second" });
      expect((await harness.delivered(to)).map((m) => m.subject)).toEqual(["One", "Two"]);
    });

    it("names its driver", () => {
      expect(harness.mailer().driver).toBe(name);
    });
  });
}
