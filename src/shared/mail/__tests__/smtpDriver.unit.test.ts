// P4-MAIL-01, P4-MAIL-02: the smtp driver against a local SMTP test server (never Gmail, Rule 12).
import { createServer, type Server } from "node:net";
import { simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSmtpMailer, type SmtpSettings } from "../drivers/smtp";
import type { MailMessage } from "../mailer";
import { mailerContract } from "./mailerContract";

let seq = 0;
const USER = "sender@example.com";
const PASSWORD = "abcdefghijklmnop";
const received: (MailMessage & { from: string })[] = [];
let server: SMTPServer;
let port = 0;

beforeAll(async () => {
  server = new SMTPServer({
    secure: false,
    allowInsecureAuth: true,
    disabledCommands: ["STARTTLS"],
    onAuth(auth, _session, callback) {
      if (auth.username === USER && auth.password === PASSWORD) callback(null, { user: USER });
      else callback(new Error("Invalid login: 535 Username and Password not accepted"));
    },
    onData(stream, _session, callback) {
      simpleParser(stream)
        .then((mail) => {
          received.push({
            from: mail.from?.text ?? "",
            to: (Array.isArray(mail.to) ? mail.to[0] : mail.to)?.text ?? "",
            subject: mail.subject ?? "",
            text: mail.text ?? "",
          });
          callback();
        })
        .catch(callback);
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const settings = (overrides: Partial<SmtpSettings> = {}): SmtpSettings => ({
  host: "127.0.0.1",
  port,
  user: USER,
  password: PASSWORD,
  from: `JD Sheets <${USER}>`,
  requireTls: false,
  timeoutMs: 2000,
  ...overrides,
});

mailerContract("smtp", {
  mailer: () => createSmtpMailer(settings()),
  delivered: async (to) => received.filter((m) => m.to === to),
});

describe("smtp driver (P4-MAIL-01, -02)", () => {
  it("sends from MAIL_FROM", async () => {
    const to = `from-${(seq += 1)}@jdfusion.in`;
    await createSmtpMailer(settings()).send({ to, subject: "s", text: "t" });
    expect(received.find((m) => m.to === to)?.from).toMatch(new RegExp(`^"?JD Sheets"? <${USER}>$`));
  });

  it("accepts the app password as Google shows it, in groups with spaces", async () => {
    const to = `spaces-${(seq += 1)}@jdfusion.in`;
    await createSmtpMailer(settings({ password: "abcd efgh ijkl mnop" })).send({
      to,
      subject: "s",
      text: "t",
    });
    expect(received.some((m) => m.to === to)).toBe(true);
  });

  it("fails on a wrong password without the password, its encoding or the message in the error", async () => {
    const secret = "wrong-password-123";
    const error = await createSmtpMailer(settings({ password: secret }))
      .send({ to: "a@jdfusion.in", subject: "s", text: "Your code is 654321." })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(Error);
    const everything = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack ?? ""} ${String((error as Error).cause ?? "")}`;
    for (const leak of [
      secret,
      Buffer.from(`\0${USER}\0${secret}`).toString("base64"),
      Buffer.from(secret).toString("base64"),
      "654321",
    ]) {
      expect(everything).not.toContain(leak);
    }
    expect(String(error)).toMatch(/mail server refused the sign-in/i);
  });

  it("fails quickly when the mail server cannot be reached", async () => {
    const closed: Server = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const closedPort = (closed.address() as { port: number }).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const started = performance.now();
    await expect(
      createSmtpMailer(settings({ port: closedPort })).send({
        to: "a@jdfusion.in",
        subject: "s",
        text: "t",
      }),
    ).rejects.toThrow(/could not reach the mail server/i);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
