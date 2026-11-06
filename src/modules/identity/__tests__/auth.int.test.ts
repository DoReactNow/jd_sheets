// Sign-in, lockout, sessions, sign-out and password changes against the test database:
// P1-SIGNIN-01..06, P1-LOCK-01..06, P1-SESS-01..10, P1-APPROVE-08..10, P1-PWD-04, X-ACCESS-10.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as passwordRoute } from "@/app/api/auth/password/route";
import { POST as signInRoute } from "@/app/api/auth/sign-in/route";
import { POST as signOutRoute } from "@/app/api/auth/sign-out/route";
import { GET as meRoute } from "@/app/api/me/route";
import { GET as listWorkbooks } from "@/app/api/workbooks/route";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { getPrisma } from "@/shared/db/prisma";
import { ERROR_CATALOG } from "@/shared/errors/errorCatalog";
import { createTestClock } from "@/shared/time";
import { call, cookieFrom, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, TEST_PASSWORD } from "@/tests/setup/users";
import { createAuthService, createSessionPrincipalResolver, hashToken } from "../identity.auth";

const signInAs = (email: string, password: string, ip?: string) =>
  call(signInRoute, { method: "POST", body: { email, password }, ip });

beforeEach(async () => {
  await resetWithRoles();
  installRealResolvers();
});
afterAll(() => getPrisma().$disconnect());

describe("signing in (P1-SIGNIN)", () => {
  it("signs an active user in with a secure session cookie, storing only the token's hash (P1-SIGNIN-01, P1-SESS-01, -02)", async () => {
    const user = await createTestUser({ role: "MEMBER" });
    const result = await signInAs(user.email, TEST_PASSWORD);
    expect(result.status).toBe(200);
    const header = result.headers.get("set-cookie")!;
    expect(header).toMatch(/^jds_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax/);
    const token = header.split(";")[0].split("=")[1];
    const sessions = await getPrisma().session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).toBe(hashToken(token));
    expect(sessions[0].tokenHash).not.toContain(token);
    const me = await call(meRoute, { cookie: cookieFrom(result) });
    expect(me.body).toMatchObject({ data: { userId: user.id, email: user.email } });
  });

  it("matches the email case-insensitively (P1-SIGNIN-04)", async () => {
    const user = await createTestUser({ email: "asha.rao.test@jdfusion.in" });
    expect((await signInAs("  Asha.Rao.Test@JDFUSION.in ", TEST_PASSWORD)).status).toBe(200);
    expect(user.email).toBe("asha.rao.test@jdfusion.in");
  });

  it("gives one identical answer for a wrong password, an unknown email and a deactivated account (P1-SIGNIN-02, -03)", async () => {
    const active = await createTestUser();
    const deactivated = await createTestUser({ status: "DEACTIVATED" });
    const answers = await Promise.all([
      signInAs(active.email, "wrong password here"),
      signInAs("nobody.test@jdfusion.in", TEST_PASSWORD),
      signInAs(deactivated.email, TEST_PASSWORD),
    ]);
    for (const answer of answers) {
      expect(answer.status).toBe(401);
      expect(answer.body).toMatchObject({
        error: { code: "INVALID_CREDENTIALS", message: ERROR_CATALOG.INVALID_CREDENTIALS.message },
      });
      expect(answer.headers.get("set-cookie")).toBeNull();
    }
  });

  it("tells pending and rejected people their status only with the right password (P1-APPROVE-08..10, X-ACCESS-10)", async () => {
    const pending = await createTestUser({ role: null, status: "PENDING_APPROVAL" });
    const rejected = await createTestUser({ role: null, status: "REJECTED" });
    const p = await signInAs(pending.email, TEST_PASSWORD);
    expect(p.body).toMatchObject({ error: { code: "ACCOUNT_PENDING" } });
    expect(p.headers.get("set-cookie")).toBeNull();
    expect((await signInAs(rejected.email, TEST_PASSWORD)).body).toMatchObject({
      error: { code: "ACCOUNT_REJECTED" },
    });
    expect((await signInAs(pending.email, "not the password")).body).toMatchObject({
      error: { code: "INVALID_CREDENTIALS" },
    });
  });

  it("refuses malformed input with field messages (X-INPUT-01, -08)", async () => {
    const result = await call(signInRoute, { method: "POST", body: { email: "", password: "" } });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });
});

describe("lockout (P1-LOCK)", () => {
  it("locks after five wrong passwords for 15 minutes, then lets the right one in (P1-LOCK-01..03, -05)", async () => {
    const clock = createTestClock("2027-01-05T10:00:00Z");
    const service = createAuthService({ clock });
    const user = await createTestUser();
    const meta = { ip: "203.0.113.7", userAgent: null };
    for (let i = 0; i < 4; i++) {
      await expect(
        service.signIn({ email: user.email, password: "wrong one here" }, meta),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(
      service.signIn({ email: user.email, password: "wrong one here" }, meta),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(
      service.signIn({ email: user.email, password: TEST_PASSWORD }, meta),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    clock.advance({ minutes: 14, seconds: 59 });
    await expect(
      service.signIn({ email: user.email, password: TEST_PASSWORD }, meta),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    clock.advance({ seconds: 2 });
    await expect(
      service.signIn({ email: user.email, password: TEST_PASSWORD }, meta),
    ).resolves.toMatchObject({ token: expect.any(String) });
    const row = await getPrisma().user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.failedSignInCount).toBe(0);
    const actions = (await getPrisma().auditEvent.findMany({ where: { targetId: user.id } })).map(
      (e) => e.action,
    );
    expect(actions).toContain("auth.locked");
    expect(actions).toContain("auth.signed_in");
  }, 30_000);

  it("a correct sign-in resets the count (P1-LOCK-03)", async () => {
    const user = await createTestUser();
    for (let i = 0; i < 3; i++) await signInAs(user.email, "wrong one here");
    expect((await signInAs(user.email, TEST_PASSWORD)).status).toBe(200);
    for (let i = 0; i < 4; i++)
      expect((await signInAs(user.email, "wrong one here")).status).toBe(401);
  }, 30_000);

  it("limits sign-in attempts per address (P1-LOCK-04)", async () => {
    const clock = createTestClock("2027-01-05T10:00:00Z");
    const service = createAuthService({ clock });
    const meta = { ip: "198.51.100.9", userAgent: null };
    for (let i = 0; i < APP_CONFIG.auth.signInAttemptsPerIp; i++) {
      await expect(
        service.signIn({ email: `n${i}.test@jdfusion.in`, password: "x".repeat(12) }, meta),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(
      service.signIn({ email: "n.test@jdfusion.in", password: "x".repeat(12) }, meta),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  }, 60_000);

  it("simultaneous wrong attempts cannot get past the limit (P1-LOCK-06)", async () => {
    const user = await createTestUser();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => signInAs(user.email, "wrong one here")),
    );
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(1);
    expect((await signInAs(user.email, TEST_PASSWORD)).status).toBe(429);
  }, 30_000);
});

describe("sessions (P1-SESS)", () => {
  it("ends after 12 idle hours and at most 7 days after sign-in (P1-SESS-03, -04, -05)", async () => {
    const clock = createTestClock("2027-01-05T10:00:00Z");
    const user = await createTestUser();
    const { token } = await createAuthService({ clock }).signIn(
      { email: user.email, password: TEST_PASSWORD },
      { ip: null, userAgent: null },
    );
    const resolve = createSessionPrincipalResolver({ clock });
    const headers = new Headers({ cookie: `jds_session=${token}` });
    clock.advance({ hours: 11, minutes: 59 });
    expect(await resolve({ headers })).not.toBeNull(); // activity extends the session
    clock.advance({ hours: 11, minutes: 59 });
    expect(await resolve({ headers })).not.toBeNull();
    clock.advance({ hours: 12, minutes: 1 });
    expect(await resolve({ headers })).toBeNull();

    const fresh = await createAuthService({ clock }).signIn(
      { email: user.email, password: TEST_PASSWORD },
      { ip: null, userAgent: null },
    );
    const freshHeaders = new Headers({ cookie: `jds_session=${fresh.token}` });
    for (let i = 0; i < 16; i++) {
      clock.advance({ hours: 11 });
      if (!(await resolve({ headers: freshHeaders }))) break;
    }
    // 16 × 11 hours is past 7 days: the session must have ended at the 7-day cap.
    expect(await resolve({ headers: freshHeaders })).toBeNull();
  }, 30_000);

  it("extends a session at most once every 5 minutes (P1-SESS-05)", async () => {
    const clock = createTestClock("2027-01-05T10:00:00Z");
    const user = await createTestUser();
    const { token } = await createAuthService({ clock }).signIn(
      { email: user.email, password: TEST_PASSWORD },
      { ip: null, userAgent: null },
    );
    const resolve = createSessionPrincipalResolver({ clock });
    const headers = new Headers({ cookie: `jds_session=${token}` });
    clock.advance({ minutes: 2 });
    await resolve({ headers });
    const first = await getPrisma().session.findFirstOrThrow({ where: { userId: user.id } });
    clock.advance({ minutes: 2 });
    await resolve({ headers });
    const second = await getPrisma().session.findFirstOrThrow({ where: { userId: user.id } });
    expect(second.lastSeenAt.getTime()).toBe(first.lastSeenAt.getTime());
    clock.advance({ minutes: 4 });
    await resolve({ headers });
    const third = await getPrisma().session.findFirstOrThrow({ where: { userId: user.id } });
    expect(third.lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
  });

  it("sign-out ends the session and repeating it is quiet (P1-SESS-06)", async () => {
    const user = await createTestUser();
    const cookie = await signIn(user.email);
    const out = await call(signOutRoute, { method: "POST", cookie });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await call(meRoute, { cookie })).status).toBe(401);
    expect((await call(signOutRoute, { method: "POST", cookie })).status).toBe(200);
  });

  it("a role change applies on the next request (P1-SESS-08)", async () => {
    const user = await createTestUser({ role: "MEMBER" });
    const cookie = await signIn(user.email);
    expect((await call(meRoute, { cookie })).body).toMatchObject({ data: { role: "MEMBER" } });
    const admin = await getPrisma().role.findUniqueOrThrow({ where: { key: "ADMIN" } });
    await getPrisma().user.update({ where: { id: user.id }, data: { roleId: admin.id } });
    expect((await call(meRoute, { cookie })).body).toMatchObject({ data: { role: "ADMIN" } });
  });

  it("refuses a changing request from another site, or without Origin, when it carries the cookie (P1-SESS-09)", async () => {
    const user = await createTestUser();
    const cookie = await signIn(user.email);
    const evil = await call(passwordRoute, {
      method: "POST",
      cookie,
      headers: { origin: "https://evil.example" },
      body: {},
    });
    expect(evil.status).toBe(403);
    const response = await passwordRoute(
      new Request("http://127.0.0.1/api/auth/password", {
        method: "POST",
        headers: { cookie },
        body: "{}",
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(403);
  });

  it("treats a forged or random cookie as signed out (P1-SESS-10)", async () => {
    for (const cookie of [
      "jds_session=forged-token-value-that-is-long-enough",
      "jds_session=<script>",
      "other=1",
    ]) {
      expect((await call(listWorkbooks, { cookie })).status).toBe(401);
    }
  });
});

describe("password changes (P1-SIGNIN-06, P1-PWD-04)", () => {
  it("a must-change user can only change their password; afterwards everything works", async () => {
    const user = await createTestUser({ mustChangePassword: true });
    const result = await signInAs(user.email, TEST_PASSWORD);
    expect(result.body).toMatchObject({ data: { mustChangePassword: true } });
    const cookie = cookieFrom(result);
    expect((await call(listWorkbooks, { cookie })).body).toMatchObject({
      error: { code: "PASSWORD_CHANGE_REQUIRED" },
    });
    expect((await call(meRoute, { cookie })).status).toBe(200);
    const changed = await call(passwordRoute, {
      method: "POST",
      cookie,
      body: { currentPassword: TEST_PASSWORD, newPassword: "a brand new password 2027" },
    });
    expect(changed.status).toBe(200);
    expect((await call(listWorkbooks, { cookie })).status).toBe(200);
  }, 30_000);

  it("needs the current password, applies the rule, and signs out other sessions", async () => {
    const user = await createTestUser();
    const first = await signIn(user.email);
    const second = await signIn(user.email);
    const wrong = await call(passwordRoute, {
      method: "POST",
      cookie: first,
      body: { currentPassword: "not it at all", newPassword: "a brand new password 2027" },
    });
    expect(wrong.body).toMatchObject({
      error: { code: "VALIDATION_FAILED", fieldErrors: [{ field: "currentPassword" }] },
    });
    const weak = await call(passwordRoute, {
      method: "POST",
      cookie: first,
      body: { currentPassword: TEST_PASSWORD, newPassword: "short" },
    });
    expect(weak.body).toMatchObject({ error: { fieldErrors: [{ field: "newPassword" }] } });
    const ok = await call(passwordRoute, {
      method: "POST",
      cookie: first,
      body: { currentPassword: TEST_PASSWORD, newPassword: "a brand new password 2027" },
    });
    expect(ok.status).toBe(200);
    expect((await call(meRoute, { cookie: first })).status).toBe(200);
    expect((await call(meRoute, { cookie: second })).status).toBe(401);
  }, 30_000);
});
