// W-004: the baseline migration creates the Phase 0 tables and is recorded by Prisma.
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEnv } from "@/shared/config/env";

const client = new Client({ connectionString: getEnv().DATABASE_URL });

beforeAll(() => client.connect());
afterAll(() => client.end());

describe("migrations", () => {
  it("creates the application tables in the public schema", async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      "_prisma_migrations",
      "audit_events",
      "identity_rate_limits",
      "identity_sessions",
      "identity_signup_otps",
      "identity_users",
      "mail_outbox",
      "network_blocked_requests",
      "network_ip_rules",
      "rbac_role_permissions",
      "rbac_roles",
      "system_settings",
      "system_worker_heartbeats",
      "workbooks_versions",
      "workbooks_workbooks",
    ]);
  });

  it("records every migration as applied, baseline first", async () => {
    const { rows } = await client.query<{ migration_name: string; finished_at: Date | null }>(
      `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name`,
    );
    expect(rows[0].migration_name).toMatch(/^\d{14}_init_system_settings$/);
    expect(rows.map((row) => row.migration_name.slice(15))).toContain("add_workbooks_and_versions");
    expect(rows.every((row) => row.finished_at !== null)).toBe(true);
  });

  it("stores instants as timestamptz(3)", async () => {
    const { rows } = await client.query<{
      column_name: string;
      data_type: string;
      precision: number;
    }>(
      `SELECT column_name, data_type, datetime_precision AS precision
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'system_worker_heartbeats'
         AND column_name IN ('started_at', 'last_beat_at')
       ORDER BY column_name`,
    );
    expect(rows).toEqual([
      { column_name: "last_beat_at", data_type: "timestamp with time zone", precision: 3 },
      { column_name: "started_at", data_type: "timestamp with time zone", precision: 3 },
    ]);
  });
});
