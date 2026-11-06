// The IP allowlist: P1-NET-01..15, -17, X-ACCESS-11.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as overviewRoute } from "@/app/api/admin/network/route";
import {
  DELETE as deleteRoute,
  PATCH as updateRoute,
} from "@/app/api/admin/network/rules/[id]/route";
import { POST as createRoute } from "@/app/api/admin/network/rules/route";
import { POST as signInRoute } from "@/app/api/auth/sign-in/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { GET as listWorkbooks } from "@/app/api/workbooks/route";
import { getPrisma } from "@/shared/db/prisma";
import { configureNetworkGuard } from "@/shared/http/networkGuard";
import { call, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, TEST_PASSWORD, type TestUser } from "@/tests/setup/users";
import { networkService as service, setNetworkEnforcementForTests } from "../network.service";

// .env.test has TRUSTED_PROXY_HOPS=1: the caller's address is the last X-Forwarded-For entry.
const OFFICE = "203.0.113.7";
const HOME = "198.51.100.20";

let superAdmin: TestUser;
let sa: string;

beforeEach(async () => {
  await resetWithRoles();
  installRealResolvers();
  setNetworkEnforcementForTests(true);
  await getPrisma().ipRule.create({ data: { cidr: "203.0.113.0/24", label: "Head office" } });
  service.invalidate();
  superAdmin = await createTestUser({ role: "SUPER_ADMIN" });
  sa = await signIn(superAdmin.email, TEST_PASSWORD, OFFICE);
});
afterEach(() => {
  setNetworkEnforcementForTests(null);
  configureNetworkGuard(null);
});
afterAll(() => getPrisma().$disconnect());

describe("enforcement (P1-NET-01, -02, -06, -07, -13, X-ACCESS-11)", () => {
  it("serves an allowed address and refuses the rest before anything else, logging the refusal", async () => {
    expect((await call(listWorkbooks, { cookie: sa, ip: OFFICE })).status).toBe(200);
    const refused = await call(listWorkbooks, { cookie: sa, ip: HOME, path: "/api/workbooks" });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: { code: "NETWORK_BLOCKED" } });
    const logged = await getPrisma().blockedRequest.findFirstOrThrow({ where: { ip: HOME } });
    expect(logged).toMatchObject({ method: "GET", path: "/api/workbooks" });
  });

  it("refuses a missing or malformed forwarded address rather than allowing it (P1-NET-06, -07)", async () => {
    expect((await call(listWorkbooks, { cookie: sa })).status).toBe(403);
    expect((await call(listWorkbooks, { cookie: sa, ip: "not-an-ip" })).status).toBe(403);
  });

  it("uses only the address the trusted proxy added (P1-NET-05)", async () => {
    expect((await call(listWorkbooks, { cookie: sa, ip: `${OFFICE}, ${HOME}` })).status).toBe(403);
    expect((await call(listWorkbooks, { cookie: sa, ip: `${HOME}, ${OFFICE}` })).status).toBe(200);
  });

  it("covers sign-in too, but never the health check (P1-NET-13)", async () => {
    const outside = await call(signInRoute, {
      method: "POST",
      ip: HOME,
      body: { email: superAdmin.email, password: TEST_PASSWORD },
    });
    expect(outside.body).toMatchObject({ error: { code: "NETWORK_BLOCKED" } });
    expect((await call(healthRoute, { ip: HOME })).status).toBe(200);
  });

  it("applies a change on the next request (P1-NET-12)", async () => {
    expect((await call(listWorkbooks, { cookie: sa, ip: HOME })).status).toBe(403);
    await call(createRoute, {
      method: "POST",
      cookie: sa,
      ip: OFFICE,
      body: { cidr: `${HOME}/32`, label: "Home office" },
    });
    expect((await call(listWorkbooks, { cookie: sa, ip: HOME })).status).toBe(200);
  });
});

describe("managing rules (P1-NET-08..11, -17)", () => {
  it("adds, relabels, disables and removes rules, audited, and shows your address", async () => {
    const created = await call<{ data: { id: string; cidr: string } }>(createRoute, {
      method: "POST",
      cookie: sa,
      ip: OFFICE,
      body: { cidr: "2001:db8::1/48", label: "VPN" },
    });
    expect(created.status).toBe(201);
    expect(created.body!.data.cidr).toBe("2001:db8::/48");
    const ruleId = created.body!.data.id;
    expect(
      (
        await call(updateRoute, {
          method: "PATCH",
          cookie: sa,
          ip: OFFICE,
          params: { id: ruleId },
          body: { label: "VPN (Mumbai)", enabled: false },
        })
      ).body,
    ).toMatchObject({ data: { label: "VPN (Mumbai)", enabled: false } });
    expect(
      (
        await call(deleteRoute, {
          method: "DELETE",
          cookie: sa,
          ip: OFFICE,
          params: { id: ruleId },
        })
      ).status,
    ).toBe(200);
    const overview = await call<{ data: { rules: unknown[]; yourIp: string } }>(overviewRoute, {
      cookie: sa,
      ip: OFFICE,
    });
    expect(overview.body!.data).toMatchObject({ yourIp: OFFICE });
    expect(overview.body!.data.rules).toHaveLength(1);
    const actions = (await getPrisma().auditEvent.findMany({ where: { targetType: "ipRule" } }))
      .map((e) => e.action)
      .sort();
    expect(actions).toEqual([
      "network.rule_created",
      "network.rule_deleted",
      "network.rule_updated",
    ]);
  });

  it("refuses a change that would lock you out, or leave no enabled range (P1-NET-09, -10)", async () => {
    const office = await getPrisma().ipRule.findFirstOrThrow();
    const lockout = await call(updateRoute, {
      method: "PATCH",
      cookie: sa,
      ip: OFFICE,
      params: { id: office.id },
      body: { cidr: "192.0.2.0/24" },
    });
    expect(lockout.status).toBe(409);
    expect(JSON.stringify(lockout.body)).toContain(OFFICE);
    expect(
      (
        await call(deleteRoute, {
          method: "DELETE",
          cookie: sa,
          ip: OFFICE,
          params: { id: office.id },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(updateRoute, {
          method: "PATCH",
          cookie: sa,
          ip: OFFICE,
          params: { id: office.id },
          body: { enabled: false },
        })
      ).status,
    ).toBe(409);
    expect(await getPrisma().ipRule.count({ where: { enabled: true } })).toBe(1);
  });

  it("gives friendly field messages for invalid ranges and duplicates (P1-NET-11)", async () => {
    const bad = await call(createRoute, {
      method: "POST",
      cookie: sa,
      ip: OFFICE,
      body: { cidr: "10.0.0.0/33", label: "x" },
    });
    expect(bad.body).toMatchObject({
      error: { code: "VALIDATION_FAILED", fieldErrors: [{ field: "cidr" }] },
    });
    const duplicate = await call(createRoute, {
      method: "POST",
      cookie: sa,
      ip: OFFICE,
      body: { cidr: "203.0.113.99/24", label: "Again" },
    });
    expect(duplicate.status).toBe(409);
  });

  it("only network:manage changes rules; network:view only looks (P1-NET-17)", async () => {
    const admin = await createTestUser({ role: "ADMIN" });
    const ad = await signIn(admin.email, TEST_PASSWORD, OFFICE);
    expect((await call(overviewRoute, { cookie: ad, ip: OFFICE })).status).toBe(200);
    expect(
      (
        await call(createRoute, {
          method: "POST",
          cookie: ad,
          ip: OFFICE,
          body: { cidr: "192.0.2.0/24", label: "x" },
        })
      ).status,
    ).toBe(403);
    const member = await createTestUser({ role: "MEMBER" });
    const me = await signIn(member.email, TEST_PASSWORD, OFFICE);
    expect((await call(overviewRoute, { cookie: me, ip: OFFICE })).status).toBe(403);
  });
});

describe("bootstrap and recovery (P1-NET-14, -15)", () => {
  it("writes the first rules only into an empty table, and the recovery command replaces all rules", async () => {
    expect(await service.bootstrap()).toBe(0); // there is already a rule
    await getPrisma().ipRule.deleteMany();
    expect(await service.bootstrap()).toBeGreaterThan(0); // BOOTSTRAP_ALLOWED_CIDRS from .env.test
    expect(await service.resetTo("192.0.2.5")).toBe("192.0.2.5/32");
    const rules = await getPrisma().ipRule.findMany();
    expect(rules).toHaveLength(1);
    expect(
      await getPrisma().auditEvent.count({
        where: { action: "network.reset", actorKind: "SYSTEM" },
      }),
    ).toBe(1);
  });
});
