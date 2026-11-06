// W-201: rules the database enforces for Phase 2 even if the services are bypassed:
// one target per grant, no OWNER grant, unique grants, group names (P2-GROUP-02), trash pair.
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "@/shared/config/env";
import { createTestUser, resetWithRoles, type TestUser } from "@/tests/setup/users";

const client = new Client({ connectionString: getEnv().DATABASE_URL });
beforeAll(() => client.connect());
afterAll(() => client.end());

let owner: TestUser;
let other: TestUser;
let workbookId: string;
let groupId: string;

beforeEach(async () => {
  await resetWithRoles();
  owner = await createTestUser();
  other = await createTestUser();
  const wb = await client.query<{ id: string }>(
    `INSERT INTO workbooks_workbooks (id, title, owner_id, updated_at)
     VALUES (gen_random_uuid(), 'Book', $1, now()) RETURNING id`,
    [owner.id],
  );
  workbookId = wb.rows[0]!.id;
  const group = await client.query<{ id: string }>(
    `INSERT INTO identity_groups (id, name, created_by_id, updated_at)
     VALUES (gen_random_uuid(), 'Finance', $1, now()) RETURNING id`,
    [owner.id],
  );
  groupId = group.rows[0]!.id;
});

const grant = (userId: string | null, gid: string | null, role = "VIEWER") =>
  client.query(
    `INSERT INTO sharing_grants (id, workbook_id, user_id, group_id, role, created_by_id, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())`,
    [workbookId, userId, gid, role, owner.id],
  );

const group = (name: string) =>
  client.query(
    `INSERT INTO identity_groups (id, name, created_by_id, updated_at)
     VALUES (gen_random_uuid(), $1, $2, now())`,
    [name, owner.id],
  );

describe("sharing and group rules in the database", () => {
  it("a grant names exactly one person or one group", async () => {
    await expect(grant(null, null)).rejects.toThrow(/sharing_grants_one_target/);
    await expect(grant(other.id, groupId)).rejects.toThrow(/sharing_grants_one_target/);
    await expect(grant(other.id, null)).resolves.toBeTruthy();
    await expect(grant(null, groupId)).resolves.toBeTruthy();
  });

  it("OWNER is never a grant role", async () => {
    await expect(grant(other.id, null, "OWNER")).rejects.toThrow(/share_role/);
  });

  it("one grant per person and per group on a workbook (P2-SHARE-07)", async () => {
    await grant(other.id, null);
    await expect(grant(other.id, null, "EDITOR")).rejects.toThrow(/unique/i);
    await grant(null, groupId);
    await expect(grant(null, groupId, "EDITOR")).rejects.toThrow(/unique/i);
  });

  it("group names are unique whatever their case, trimmed and not empty (P2-GROUP-02)", async () => {
    await expect(group("finance")).rejects.toThrow(/identity_groups_name_ci/);
    await expect(group(" Sales")).rejects.toThrow(/identity_groups_name_trimmed/);
    await expect(group("")).rejects.toThrow(/identity_groups_name_trimmed/);
    await expect(group("Sales")).resolves.toBeTruthy();
  });

  it("a group used by a share cannot be deleted directly (P2-GROUP-03 is a service rule)", async () => {
    await grant(null, groupId);
    await expect(
      client.query(`DELETE FROM identity_groups WHERE id = $1`, [groupId]),
    ).rejects.toThrow(/foreign key/i);
  });

  it("who trashed a workbook is only set while it is in the Trash", async () => {
    await expect(
      client.query(`UPDATE workbooks_workbooks SET trashed_by_id = $2 WHERE id = $1`, [
        workbookId,
        owner.id,
      ]),
    ).rejects.toThrow(/workbooks_workbooks_trashed_pair/);
    await expect(
      client.query(
        `UPDATE workbooks_workbooks SET trashed_at = now(), trashed_by_id = $2 WHERE id = $1`,
        [workbookId, owner.id],
      ),
    ).resolves.toBeTruthy();
  });

  it("one edit lease per workbook; it dies with its session", async () => {
    const session = await client.query<{ id: string }>(
      `INSERT INTO identity_sessions (id, user_id, token_hash, expires_at, absolute_expires_at)
       VALUES (gen_random_uuid(), $1, repeat('a', 64), now() + interval '1 hour', now() + interval '1 day')
       RETURNING id`,
      [owner.id],
    );
    const sid = session.rows[0]!.id;
    const lease = () =>
      client.query(
        `INSERT INTO workbooks_edit_leases (workbook_id, user_id, session_id, tab_id, expires_at, updated_at)
         VALUES ($1, $2, $3, 't1', now() + interval '90 seconds', now())`,
        [workbookId, owner.id, sid],
      );
    await lease();
    await expect(lease()).rejects.toThrow(/unique|duplicate/i);
    await client.query(`DELETE FROM identity_sessions WHERE id = $1`, [sid]);
    const left = await client.query(`SELECT 1 FROM workbooks_edit_leases WHERE workbook_id = $1`, [
      workbookId,
    ]);
    expect(left.rowCount).toBe(0);
  });
});
