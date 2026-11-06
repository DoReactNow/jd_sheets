// Database access for the workbooks module. Writes only workbooks_* tables. No business rules.
import { getPrisma } from "@/shared/db/prisma";
import { Prisma, type ShareRole, type WorkbookVersionSource } from "@/generated/prisma/client";

export type Tx = Prisma.TransactionClient;

export interface WorkbookRow {
  id: string;
  title: string;
  ownerId: string | null;
  owner: { id: string; displayName: string } | null;
  trashedAt: Date | null;
  sizeBytes: bigint;
  createdAt: Date;
  updatedAt: Date;
  currentVersion: { id: string; number: number; storageKey: string; sizeBytes: bigint } | null;
}

export interface NewVersion {
  id: string;
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  source: WorkbookVersionSource;
  createdById: string | null;
}

const workbookSelect = {
  id: true,
  title: true,
  ownerId: true,
  owner: { select: { id: true, displayName: true } },
  trashedAt: true,
  sizeBytes: true,
  createdAt: true,
  updatedAt: true,
  currentVersion: { select: { id: true, number: true, storageKey: true, sizeBytes: true } },
} as const;

export interface ListQuery {
  userId: string;
  scope: "mine" | "shared" | "all" | "trash";
  q?: string;
  sort: "updated" | "title";
  dir: "asc" | "desc";
  /** Keyset position: the sort value and the id of the last row of the previous page. */
  after?: { value: string; id: string };
  limit: number;
}

/** Workbooks a person can read through a grant, a group or a link they opened (not owned). */
const sharedWith = (userId: string) => Prisma.sql`(
  EXISTS (SELECT 1 FROM sharing_grants g WHERE g.workbook_id = w.id AND g.user_id = ${userId}::uuid)
  OR EXISTS (SELECT 1 FROM sharing_grants g JOIN identity_group_members m ON m.group_id = g.group_id
             WHERE g.workbook_id = w.id AND m.user_id = ${userId}::uuid)
  OR (w.link_role IS NOT NULL AND EXISTS (SELECT 1 FROM sharing_link_opens l
             WHERE l.workbook_id = w.id AND l.user_id = ${userId}::uuid)))`;

function scopeCondition(scope: ListQuery["scope"], userId: string): Prisma.Sql {
  const live = Prisma.sql`w.trashed_at IS NULL AND w.current_version_id IS NOT NULL`;
  switch (scope) {
    case "mine":
      return Prisma.sql`${live} AND w.owner_id = ${userId}::uuid`;
    case "shared":
      return Prisma.sql`${live} AND w.owner_id IS DISTINCT FROM ${userId}::uuid AND ${sharedWith(userId)}`;
    case "all":
      return Prisma.sql`${live} AND (w.owner_id = ${userId}::uuid OR ${sharedWith(userId)})`;
    case "trash":
      return Prisma.sql`w.trashed_at IS NOT NULL AND w.owner_id = ${userId}::uuid`;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Thrown inside the save transaction when the base version is no longer current. */
export class StaleBaseVersionError extends Error {
  constructor() {
    super("the workbook moved on since this save's base version");
    this.name = "StaleBaseVersionError";
  }
}

export const workbooksRepository = {
  async createWithFirstVersion(input: {
    id: string;
    title: string;
    ownerId: string;
    version: NewVersion;
  }): Promise<WorkbookRow> {
    return getPrisma().$transaction(async (tx) => {
      await tx.workbook.create({
        data: { id: input.id, title: input.title, ownerId: input.ownerId },
      });
      await tx.workbookVersion.create({
        data: { ...input.version, workbookId: input.id, number: 1 },
      });
      return tx.workbook.update({
        where: { id: input.id },
        data: { currentVersionId: input.version.id, sizeBytes: input.version.sizeBytes },
        select: workbookSelect,
      });
    });
  },

  findById(id: string): Promise<WorkbookRow | null> {
    return getPrisma().workbook.findUnique({ where: { id }, select: workbookSelect });
  },

  /** The owner of a workbook, or undefined when it does not exist. */
  async ownerOf(id: string): Promise<string | null | undefined> {
    const row = await getPrisma().workbook.findUnique({ where: { id }, select: { ownerId: true } });
    return row === null ? undefined : row.ownerId;
  },

  /**
   * One page of a list, ordered by the sort key and the id as a stable tie-breaker, using keyset
   * positions so rows are never skipped or repeated (X-LIST-01, -05). Title sorting ignores case.
   */
  async listPage(query: ListQuery): Promise<WorkbookRow[]> {
    const key =
      query.sort === "title"
        ? Prisma.sql`lower(w.title)`
        : Prisma.sql`to_char(w.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
    const cmp = query.dir === "asc" ? Prisma.sql`>` : Prisma.sql`<`;
    const order = query.dir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const conditions = [scopeCondition(query.scope, query.userId)];
    if (query.q)
      conditions.push(Prisma.sql`lower(w.title) LIKE ${`%${escapeLike(query.q.toLowerCase())}%`}`);
    if (query.after) {
      conditions.push(
        Prisma.sql`(${key}, w.id) ${cmp} (${query.after.value}, ${query.after.id}::uuid)`,
      );
    }
    const rows = await getPrisma().$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT w.id FROM workbooks_workbooks w
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY ${key} ${order}, w.id ${order}
      LIMIT ${query.limit}`);
    return this.findManyInOrder(rows.map((r) => r.id));
  },

  /** The person's recently opened workbooks they can still read, newest first (P2-LIST-03). */
  async listRecent(userId: string, limit: number, q?: string) {
    const conditions = [Prisma.sql`r.user_id = ${userId}::uuid`, scopeCondition("all", userId)];
    if (q) conditions.push(Prisma.sql`lower(w.title) LIKE ${`%${escapeLike(q.toLowerCase())}%`}`);
    const rows = await getPrisma().$queryRaw<Array<{ id: string; opened_at: Date }>>(Prisma.sql`
      SELECT w.id, r.opened_at FROM workbooks_recent_opens r
      JOIN workbooks_workbooks w ON w.id = r.workbook_id
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY r.opened_at DESC, w.id DESC
      LIMIT ${limit}`);
    const found = await this.findManyInOrder(rows.map((r) => r.id));
    return found.map((row, i) => ({ row, openedAt: rows[i]!.opened_at }));
  },

  async findManyInOrder(ids: string[]): Promise<WorkbookRow[]> {
    if (ids.length === 0) return [];
    const rows = await getPrisma().workbook.findMany({
      where: { id: { in: ids } },
      select: workbookSelect,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row): row is WorkbookRow => row !== undefined);
  },

  /** Notes that the person opened the workbook; keeps only their newest `keep` entries. */
  async recordOpen(userId: string, workbookId: string, now: Date, keep: number): Promise<void> {
    await getPrisma().$transaction([
      getPrisma().recentOpen.upsert({
        where: { userId_workbookId: { userId, workbookId } },
        create: { userId, workbookId, openedAt: now },
        update: { openedAt: now },
      }),
      getPrisma().$executeRaw(Prisma.sql`
        DELETE FROM workbooks_recent_opens WHERE user_id = ${userId}::uuid AND workbook_id NOT IN (
          SELECT workbook_id FROM workbooks_recent_opens WHERE user_id = ${userId}::uuid
          ORDER BY opened_at DESC, workbook_id DESC LIMIT ${keep})`),
    ]);
  },

  listOwnedBy(ownerId: string): Promise<WorkbookRow[]> {
    return getPrisma().workbook.findMany({
      where: { ownerId, currentVersionId: { not: null } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: workbookSelect,
    });
  },

  /**
   * Adds a version on top of `baseVersionId`, in one transaction that locks the workbook row:
   * if the current version is not the base any more, nothing is written (StaleBaseVersionError).
   */
  async addVersion(
    workbookId: string,
    baseVersionId: string,
    version: NewVersion,
    now: Date,
  ): Promise<{ number: number }> {
    return getPrisma().$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ current_version_id: string | null }>>(
        Prisma.sql`SELECT current_version_id FROM workbooks_workbooks WHERE id = ${workbookId}::uuid FOR UPDATE`,
      );
      if (locked.length === 0 || locked[0].current_version_id !== baseVersionId) {
        throw new StaleBaseVersionError();
      }
      const last = await tx.workbookVersion.aggregate({
        where: { workbookId },
        _max: { number: true },
      });
      const number = (last._max.number ?? 0) + 1;
      await tx.workbookVersion.create({ data: { ...version, workbookId, number } });
      await tx.workbook.update({
        where: { id: workbookId },
        data: { currentVersionId: version.id, sizeBytes: version.sizeBytes, updatedAt: now },
      });
      return { number };
    });
  },

  /** Which of these storage keys belong to a version row (for the orphan cleanup). */
  async referencedKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const rows = await getPrisma().workbookVersion.findMany({
      where: { storageKey: { in: keys } },
      select: { storageKey: true },
    });
    return new Set(rows.map((row) => row.storageKey));
  },
};

export type WorkbooksRepository = typeof workbooksRepository;

export interface LeaseRow {
  userId: string;
  tabId: string;
  expiresAt: Date;
  holderName: string;
}

/** The edit lease (database_schema.md 3.4, Decision 52). */
export const leaseRepository = {
  /**
   * Takes or renews the lease for this page in one statement, so exactly one of two simultaneous
   * takers wins (P2-LEASE-06). It succeeds when the lease is free or expired, already this
   * page's, or (with takeOver) held by the same person in another tab. Answers whether it holds.
   */
  async take(input: {
    workbookId: string;
    userId: string;
    sessionId: string;
    tabId: string;
    now: Date;
    expiresAt: Date;
    takeOver: boolean;
  }): Promise<boolean> {
    const rows = await getPrisma().$queryRaw<Array<{ tab_id: string }>>(Prisma.sql`
      INSERT INTO workbooks_edit_leases
        (workbook_id, user_id, session_id, tab_id, expires_at, created_at, updated_at)
      VALUES (${input.workbookId}::uuid, ${input.userId}::uuid, ${input.sessionId}::uuid,
        ${input.tabId}, ${input.expiresAt}, ${input.now}, ${input.now})
      ON CONFLICT (workbook_id) DO UPDATE SET
        user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id, tab_id = EXCLUDED.tab_id,
        expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at,
        created_at = CASE WHEN workbooks_edit_leases.tab_id = EXCLUDED.tab_id
          THEN workbooks_edit_leases.created_at ELSE EXCLUDED.created_at END
      WHERE workbooks_edit_leases.expires_at <= ${input.now}
        OR (workbooks_edit_leases.user_id = EXCLUDED.user_id AND workbooks_edit_leases.tab_id = EXCLUDED.tab_id)
        OR (${input.takeOver} AND workbooks_edit_leases.user_id = EXCLUDED.user_id)
      RETURNING tab_id`);
    return rows.length === 1;
  },

  /** The current, unexpired lease, or null. */
  async current(workbookId: string, now: Date): Promise<LeaseRow | null> {
    const row = await getPrisma().editLease.findFirst({
      where: { workbookId, expiresAt: { gt: now } },
      select: {
        userId: true,
        tabId: true,
        expiresAt: true,
        user: { select: { displayName: true } },
      },
    });
    return row
      ? {
          userId: row.userId,
          tabId: row.tabId,
          expiresAt: row.expiresAt,
          holderName: row.user.displayName,
        }
      : null;
  },

  /** Ends the lease if this page holds it. */
  async release(workbookId: string, userId: string, tabId: string): Promise<void> {
    await getPrisma().editLease.deleteMany({ where: { workbookId, userId, tabId } });
  },

  /** Ends any lease this person holds on the workbook (they lost edit rights, P2-LEASE-09). */
  async releaseAllOf(workbookId: string, userId: string): Promise<void> {
    await getPrisma().editLease.deleteMany({ where: { workbookId, userId } });
  },
};

/**
 * Writes other modules make to workbook rows inside their own transaction (the sharing module's
 * company link, download setting and ownership transfer). Only workbook columns.
 */
export const workbookRecords = {
  sharingSettings(id: string, tx?: Tx) {
    return (tx ?? getPrisma()).workbook.findFirst({
      where: { id, trashedAt: null },
      select: {
        id: true,
        title: true,
        ownerId: true,
        linkRole: true,
        allowDownloadForReaders: true,
      },
    });
  },
  async updateSharingSettings(
    tx: Tx,
    id: string,
    data: { linkRole?: ShareRole | null; allowDownloadForReaders?: boolean },
  ): Promise<void> {
    await tx.workbook.update({ where: { id }, data });
  },
  async setOwner(tx: Tx, id: string, ownerId: string): Promise<void> {
    await tx.workbook.update({ where: { id }, data: { ownerId } });
  },
};
