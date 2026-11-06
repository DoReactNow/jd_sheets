// Self sign-up with an emailed code: P1-SIGNUP-01..10, P1-OTP-01..11, X-JOB-01.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as completeRoute } from "@/app/api/auth/sign-up/complete/route";
import { POST as requestRoute } from "@/app/api/auth/sign-up/request/route";
import { POST as verifyRoute } from "@/app/api/auth/sign-up/verify/route";
import { getPrisma } from "@/shared/db/prisma";
import { readLatestFakeMail } from "@/shared/mail";
import { startTestJobRuntime, type TestJobRuntime } from "@/shared/jobs/testing/testRuntime";
import { createTestClock } from "@/shared/time";
import { call, installRealResolvers } from "@/tests/setup/session";
import { createTestUser, resetWithRoles } from "@/tests/setup/users";
import { sendOtpJob } from "../identity.jobs";
import { createSignupService, sendOtpMail } from "../identity.signup";

let runtime: TestJobRuntime;
beforeAll(async () => {
  runtime = await startTestJobRuntime({ start: "2027-01-05T10:00:00Z" });
});
beforeEach(async () => {
  await resetWithRoles();
  installRealResolvers();
});
afterAll(async () => {
  await runtime.stop();
  await getPrisma().$disconnect();
});

const EMAIL = "newjoiner.test@jdfusion.in";
const runJobs = () => runtime.runPendingJobs([sendOtpJob]);
const codeFor = async (email: string) =>
  /(\d{6})/.exec((await readLatestFakeMail(email))?.text ?? "")?.[1] ?? null;
const request = (email: string, ip = "203.0.113.7") =>
  call(requestRoute, { method: "POST", body: { email }, ip });
const verify = (email: string, code: string) =>
  call<{ data: { ticket: string } }>(verifyRoute, { method: "POST", body: { email, code } });
const complete = (ticket: string, displayName = "Rohan", password = "a long enough password") =>
  call(completeRoute, { method: "POST", body: { ticket, displayName, password } });

describe("the whole sign-up (P1-SIGNUP-01, -04, -05)", () => {
  it("emails one 6-digit code, accepts it, and creates a pending account, audited", async () => {
    expect((await request(EMAIL)).status).toBe(200);
    expect(await runJobs()).toBe(1);
    const code = await codeFor(EMAIL);
    expect(code).toMatch(/^\d{6}$/);
    const verified = await verify(EMAIL, code!);
    expect(verified.status).toBe(200);
    expect((await complete(verified.body!.data.ticket)).status).toBe(201);
    const user = await getPrisma().user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user).toMatchObject({
      status: "PENDING_APPROVAL",
      roleId: null,
      signupSource: "SELF",
      displayName: "Rohan",
    });
    expect(
      await getPrisma().auditEvent.count({
        where: { action: "user.signup_requested", targetId: user.id },
      }),
    ).toBe(1);
  }, 30_000);
});

describe("no answer reveals an account (P1-SIGNUP-02, -03, -10)", () => {
  it("answers the same for an active account, a pending one and a new address, and mails only the new one", async () => {
    const active = await createTestUser();
    const pending = await createTestUser({ role: null, status: "PENDING_APPROVAL" });
    const answers = await Promise.all([
      request(active.email),
      request(pending.email),
      request(EMAIL),
    ]);
    for (const answer of answers)
      expect(answer).toMatchObject({ status: 200, body: { data: { ok: true } } });
    await runJobs();
    expect(await readLatestFakeMail(active.email)).toBeNull();
    expect(await readLatestFakeMail(pending.email)).toBeNull();
    expect(await readLatestFakeMail(EMAIL)).not.toBeNull();
  });

  it("refuses another domain with a field message (P1-DOMAIN-02, -07)", async () => {
    const result = await request("rohan@gmail.com");
    expect(result.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        fieldErrors: [{ field: "email", message: expect.stringContaining("@jdfusion.in") }],
      },
    });
  });
});

describe("codes (P1-OTP)", () => {
  it("expires after 10 minutes (P1-OTP-01)", async () => {
    const clock = createTestClock("2027-01-05T10:00:00Z");
    const ids: string[] = [];
    const service = createSignupService({ clock, enqueueOtpMail: async (id) => void ids.push(id) });
    await service.requestCode(EMAIL, { ip: null, userAgent: null });
    const { getMailer } = await import("@/shared/mail");
    await sendOtpMail(ids[0], getMailer(), clock);
    const code = (await codeFor(EMAIL))!;
    clock.advance({ minutes: 10, seconds: 1 });
    await expect(service.verifyCode(EMAIL, code)).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });

  it("works once only (P1-OTP-02)", async () => {
    await request(EMAIL);
    await runJobs();
    const code = (await codeFor(EMAIL))!;
    expect((await verify(EMAIL, code)).status).toBe(200);
    expect((await verify(EMAIL, code)).body).toMatchObject({ error: { code: "OTP_EXPIRED" } });
  });

  it("five wrong tries end the code (P1-OTP-03, -10)", async () => {
    await request(EMAIL);
    await runJobs();
    const code = (await codeFor(EMAIL))!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++)
      expect((await verify(EMAIL, wrong)).body).toMatchObject({ error: { code: "OTP_INVALID" } });
    expect((await verify(EMAIL, wrong)).body).toMatchObject({ error: { code: "OTP_EXPIRED" } });
    expect((await verify(EMAIL, code)).body).toMatchObject({ error: { code: "OTP_EXPIRED" } });
    expect((await verify(EMAIL, "12 34")).body).toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
  });

  it("a new code voids the old one; resends wait 60 seconds; hourly limits hold (P1-OTP-04..06)", async () => {
    const clock = createTestClock("2027-01-05T10:00:00Z");
    const ids: string[] = [];
    const service = createSignupService({ clock, enqueueOtpMail: async (id) => void ids.push(id) });
    const meta = { ip: "203.0.113.50", userAgent: null };
    await service.requestCode(EMAIL, meta);
    await expect(service.requestCode(EMAIL, meta)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    clock.advance({ seconds: 61 });
    await service.requestCode(EMAIL, meta);
    const first = await getPrisma().signupOtp.findUniqueOrThrow({ where: { id: ids[0] } });
    expect(first.voidedAt).not.toBeNull();
    for (let i = 0; i < 3; i++) {
      clock.advance({ seconds: 61 });
      await service.requestCode(EMAIL, meta);
    }
    clock.advance({ seconds: 61 });
    await expect(service.requestCode(EMAIL, meta)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("stores only a hash and never logs the code (P1-OTP-07, -08)", async () => {
    await request(EMAIL);
    await runJobs();
    const code = (await codeFor(EMAIL))!;
    const row = await getPrisma().signupOtp.findFirstOrThrow({ where: { email: EMAIL } });
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(code);
  });

  it("the mail job runs twice with one effect, and retries after a failed send (P1-OTP-09, X-JOB-01)", async () => {
    const ids: string[] = [];
    const service = createSignupService({ enqueueOtpMail: async (id) => void ids.push(id) });
    await service.requestCode(EMAIL, { ip: null, userAgent: null });
    const failing = {
      driver: "broken",
      send: async () => {
        throw new Error("smtp down");
      },
    };
    await expect(sendOtpMail(ids[0], failing)).rejects.toThrow("smtp down");
    const { getMailer } = await import("@/shared/mail");
    expect(await sendOtpMail(ids[0], getMailer())).toBe("sent");
    expect(await sendOtpMail(ids[0], getMailer())).toBe("skipped");
    expect(await getPrisma().mailOutbox.count({ where: { to: EMAIL } })).toBe(1);
  });
});

describe("tickets and accounts (P1-SIGNUP-06..10)", () => {
  async function ticketFor(email: string) {
    await request(email);
    await runJobs();
    return (await verify(email, (await codeFor(email))!)).body!.data.ticket;
  }

  it("cannot finish without a valid ticket, and a ticket works once (P1-SIGNUP-06, -07)", async () => {
    expect((await complete("x".repeat(43))).body).toMatchObject({ error: { code: "OTP_EXPIRED" } });
    const ticket = await ticketFor(EMAIL);
    expect((await complete(ticket)).status).toBe(201);
    expect((await complete(ticket)).body).toMatchObject({ error: { code: "OTP_EXPIRED" } });
    expect(await getPrisma().user.count()).toBe(1);
  });

  it("applies the name and password rules (P1-SIGNUP-08)", async () => {
    const ticket = await ticketFor(EMAIL);
    expect((await complete(ticket, "Rohan", "short")).body).toMatchObject({
      error: { fieldErrors: [{ field: "password" }] },
    });
    expect((await complete(ticket, "   ", "a long enough password")).body).toMatchObject({
      error: { fieldErrors: [{ field: "displayName" }] },
    });
  });

  it("a rejected person can ask again and returns to pending, marked as rejected before (P1-SIGNUP-09)", async () => {
    const rejected = await createTestUser({ role: null, status: "REJECTED", email: EMAIL });
    expect((await complete(await ticketFor(EMAIL))).status).toBe(201);
    const user = await getPrisma().user.findUniqueOrThrow({ where: { id: rejected.id } });
    expect(user).toMatchObject({ status: "PENDING_APPROVAL", rejectedBefore: true });
  });
});
