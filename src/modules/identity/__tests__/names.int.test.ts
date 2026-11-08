// Decision 66: everyone edits their own name; admins rename the people they may manage
// (P4-NAME-01..03).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as updateRoute } from "@/app/api/admin/users/[id]/route";
import { GET as meRoute, PATCH as renameMeRoute } from "@/app/api/me/route";
import { getPrisma } from "@/shared/db/prisma";
import { call, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, type TestUser } from "@/tests/setup/users";

let superAdmin: TestUser;
let admin: TestUser;
let member: TestUser;
let sa: string;
let ad: string;
let me: string;

beforeEach(async () => {
  await resetWithRoles();
  installRealResolvers();
  superAdmin = await createTestUser({ role: "SUPER_ADMIN", displayName: "Owner" });
  admin = await createTestUser({ role: "ADMIN", displayName: "Office admin" });
  member = await createTestUser({ role: "MEMBER", displayName: "New person" });
  [sa, ad, me] = await Promise.all([
    signIn(superAdmin.email),
    signIn(admin.email),
    signIn(member.email),
  ]);
}, 30_000);
afterAll(() => getPrisma().$disconnect());

type Me = { data: { displayName: string; role: string; email: string } };
const code = (r: { body: unknown }) => (r.body as { error?: { code: string } } | null)?.error?.code;
const rename = (cookie: string | undefined, body: unknown) =>
  call<Me>(renameMeRoute, { method: "PATCH", path: "/api/me", cookie, body });

describe("your own name (Profile page)", () => {
  it("anyone signed in renames themselves; /api/me shows it; audited with old and new (P4-NAME-01)", async () => {
    const result = await rename(me, { displayName: "  Ravi Kumar  " });
    expect(result.status).toBe(200);
    expect(result.body!.data.displayName).toBe("Ravi Kumar");
    const after = await call<Me>(meRoute, { cookie: me, path: "/api/me" });
    expect(after.body!.data.displayName).toBe("Ravi Kumar");
    const event = await getPrisma().auditEvent.findFirstOrThrow({
      where: { action: "user.renamed" },
    });
    expect(event.targetId).toBe(member.id);
    expect(event.actorId).toBe(member.id);
    expect(event.details).toMatchObject({ from: "New person", to: "Ravi Kumar" });
    // The Super Admin seeded as "Owner" fixes their own name the same way.
    expect((await rename(sa, { displayName: "Adam" })).body!.data.displayName).toBe("Adam");
  });

  it("refuses bad names, needs a session, and changes nothing else (P4-NAME-02)", async () => {
    for (const displayName of ["", "   ", "x".repeat(101), "Bad\u0007name"]) {
      const refused = await rename(me, { displayName });
      expect(code(refused)).toBe("VALIDATION_FAILED");
    }
    expect((await rename(undefined, { displayName: "Someone" })).status).toBe(401);
    await rename(me, { displayName: "Ravi", role: "SUPER_ADMIN", email: "boss@jdfusion.in" });
    const row = await getPrisma().user.findUniqueOrThrow({
      where: { id: member.id },
      include: { role: true },
    });
    expect(row.displayName).toBe("Ravi");
    expect(row.role?.key).toBe("MEMBER");
    expect(row.email).toBe(member.email);
  });
});

describe("renaming on the Users page (P4-NAME-03)", () => {
  const renameUser = (cookie: string, user: TestUser, displayName: string) =>
    call(updateRoute, {
      method: "PATCH",
      path: `/api/admin/users/${user.id}`,
      cookie,
      params: { id: user.id },
      body: { displayName },
    });
  const nameOf = async (user: TestUser) =>
    (await getPrisma().user.findUniqueOrThrow({ where: { id: user.id } })).displayName;

  it("an Admin renames a Member but not a Super Admin", async () => {
    expect((await renameUser(ad, member, "Priya Shah")).status).toBe(200);
    expect(await nameOf(member)).toBe("Priya Shah");
    const refused = await renameUser(ad, superAdmin, "Not allowed");
    expect(refused.status).toBe(403);
    expect(await nameOf(superAdmin)).toBe("Owner");
  });

  it("a Super Admin renames anyone, themselves included", async () => {
    expect((await renameUser(sa, admin, "Neha (Admin)")).status).toBe(200);
    expect((await renameUser(sa, superAdmin, "Adam")).status).toBe(200);
    expect(await nameOf(superAdmin)).toBe("Adam");
  });
});
