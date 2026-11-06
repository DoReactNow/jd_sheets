// Rules the database enforces even if the services are bypassed:
// P1-DOMAIN-08, P1-SA-01 (trigger), P1-SA-03 (trigger), P1-AUDIT-06 / X-DATA-03.
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "@/shared/config/env";
import { createTestUser, resetWithRoles } from "@/tests/setup/users";

const client = new Client({ connectionString: getEnv().DATABASE_URL });
beforeAll(() => client.connect());
afterAll(() => client.end());
beforeEach(() => resetWithRoles());

const insertUser = (email: string) =>
  client.query(
    `INSERT INTO identity_users (id, email, display_name, password_hash, status, signup_source, updated_at)
     VALUES (gen_random_uuid(), $1, 'X', 'h', 'PENDING_APPROVAL', 'SEED', now())`,
    [email],
  );

describe("database rules", () => {
  it("refuses an email outside the company domain (P1-DOMAIN-08)", async () => {
    await expect(insertUser("asha@gmail.com")).rejects.toThrow(/identity_users_email_domain/);
    await expect(insertUser("Asha@jdfusion.in")).rejects.toThrow(/identity_users_email_domain/);
    await expect(insertUser("asha@jdfusion.in")).resolves.toBeTruthy();
  });

  it("refuses an active user without a role", async () => {
    const user = await createTestUser({ role: "MEMBER" });
    await expect(
      client.query(`UPDATE identity_users SET role_id = NULL WHERE id = $1`, [user.id]),
    ).rejects.toThrow(/identity_users_active_has_role/);
  });

  it("protects the last active Super Admin from deactivation, demotion and deletion (P1-SA-01)", async () => {
    const only = await createTestUser({ role: "SUPER_ADMIN" });
    await expect(
      client.query(`UPDATE identity_users SET status = 'DEACTIVATED' WHERE id = $1`, [only.id]),
    ).rejects.toThrow(/last active super admin/);
    await expect(
      client.query(
        `UPDATE identity_users SET role_id = (SELECT id FROM rbac_roles WHERE key = 'MEMBER') WHERE id = $1`,
        [only.id],
      ),
    ).rejects.toThrow(/last active super admin/);
    await expect(
      client.query(`DELETE FROM identity_users WHERE id = $1`, [only.id]),
    ).rejects.toThrow(/last active super admin/);
    // With a second Super Admin, the first may be deactivated.
    await createTestUser({ role: "SUPER_ADMIN" });
    await expect(
      client.query(`UPDATE identity_users SET status = 'DEACTIVATED' WHERE id = $1`, [only.id]),
    ).resolves.toBeTruthy();
  });

  it("refuses reserved permissions on any role (P1-SA-03)", async () => {
    for (const code of ["roles:manage", "users:manage-super-admins"]) {
      await expect(
        client.query(
          `INSERT INTO rbac_role_permissions (role_id, permission, source)
           SELECT id, $1, 'EDITED' FROM rbac_roles WHERE key = 'ADMIN'`,
          [code],
        ),
      ).rejects.toThrow(/reserved permission/);
    }
  });

  it("keeps the audit trail append-only (P1-AUDIT-06)", async () => {
    await client.query(
      `INSERT INTO audit_events (id, actor_kind, action, target_type) VALUES (gen_random_uuid(), 'SYSTEM', 'probe', 'x')`,
    );
    await expect(client.query(`UPDATE audit_events SET action = 'changed'`)).rejects.toThrow(
      /cannot be changed/,
    );
    await expect(client.query(`DELETE FROM audit_events`)).rejects.toThrow(/cannot be changed/);
  });
});
