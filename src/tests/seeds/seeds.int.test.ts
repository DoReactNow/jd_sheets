// P1-SEED-01, P1-SEED-02: the test seed's people, and the private seed's refusals.
import { afterAll, describe, expect, it } from "vitest";
import { getPrisma } from "@/shared/db/prisma";
import { resetWithRoles } from "@/tests/setup/users";
import { runTestSeed, TEST_USERS } from "../../../prisma/seed-test";
import { checkFirstSuperAdmin } from "../../../prisma/seed-private-lib";

afterAll(() => getPrisma().$disconnect());

describe("test seed (P1-SEED-01)", () => {
  it("creates one user per role and status, all *.test@jdfusion.in, and is repeatable", async () => {
    await resetWithRoles();
    await runTestSeed();
    await runTestSeed();
    const users = await getPrisma().user.findMany({ include: { role: true } });
    expect(users).toHaveLength(TEST_USERS.length);
    for (const user of users) expect(user.email).toMatch(/\.test@jdfusion\.in$/);
    expect(new Set(users.map((u) => u.status))).toEqual(
      new Set(["ACTIVE", "PENDING_APPROVAL", "REJECTED", "DEACTIVATED"]),
    );
    expect(new Set(users.map((u) => u.role?.key).filter(Boolean))).toEqual(
      new Set(["SUPER_ADMIN", "ADMIN", "MEMBER"]),
    );
  }, 30_000);
});

describe("private seed (P1-SEED-02)", () => {
  it("refuses another domain and a weak password", () => {
    expect(() => checkFirstSuperAdmin("owner@gmail.com", "a strong enough password")).toThrow(
      /@jdfusion\.in/,
    );
    expect(() => checkFirstSuperAdmin("owner@jdfusion.in", "short")).toThrow(/characters/);
    expect(checkFirstSuperAdmin(" Owner@JDFusion.in ", "a strong enough password")).toBe(
      "owner@jdfusion.in",
    );
  });
});
