// Database access for the sharing module. Writes only sharing_* tables; reads the workbook,
// group and user rows it needs to resolve roles (rule 6 limits writes, not reads).
import { getPrisma } from "@/shared/db/prisma";
import { Prisma, type ShareRole } from "@/generated/prisma/client";

export type Tx = Prisma.TransactionClient;
const db = (tx?: Tx) => tx ?? getPrisma();

export interface AccessFacts {
  ownerId: string | null;
  linkRole: ShareRole | null;
  trashed: boolean;
  direct: ShareRole | null;
  groups: ShareRole[];
}

const grantSelect = {
  id: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, email: true, displayName: true, status: true } },
  group: { select: { id: true, name: true, _count: { select: { members: true } } } },
} as const;

export type GrantRow = Prisma.ShareGrantGetPayload<{ select: typeof grantSelect }>;

export const sharingRepository = {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(fn);
  },

  /** Everything that decides a person's role on a workbook, in one query (null: no workbook). */
  async accessFacts(userId: string, workbookId: string, tx?: Tx): Promise<AccessFacts | null> {
    const rows = await db(tx).$queryRaw<
      Array<{
        owner_id: string | null;
        link_role: ShareRole | null;
        trashed: boolean;
        direct: ShareRole | null;
        groups: ShareRole[] | null;
      }>
    >(Prisma.sql`
      SELECT w.owner_id, w.link_role::text AS link_role, (w.trashed_at IS NOT NULL) AS trashed,
        (SELECT g.role::text FROM sharing_grants g
          WHERE g.workbook_id = w.id AND g.user_id = ${userId}::uuid) AS direct,
        ARRAY(SELECT g.role::text FROM sharing_grants g
          JOIN identity_group_members m ON m.group_id = g.group_id
          JOIN identity_users u ON u.id = m.user_id AND u.status = 'ACTIVE'
          WHERE g.workbook_id = w.id AND m.user_id = ${userId}::uuid) AS groups
      FROM workbooks_workbooks w WHERE w.id = ${workbookId}::uuid`);
    const row = rows[0];
    if (!row) return null;
    return {
      ownerId: row.owner_id,
      linkRole: row.link_role,
      trashed: row.trashed,
      direct: row.direct,
      groups: row.groups ?? [],
    };
  },

  async recordLinkOpen(workbookId: string, userId: string, now: Date): Promise<void> {
    await getPrisma().linkOpen.createMany({
      data: [{ workbookId, userId, firstOpenedAt: now }],
      skipDuplicates: true,
    });
  },

  listGrants(workbookId: string, tx?: Tx) {
    return db(tx).shareGrant.findMany({
      where: { workbookId },
      select: grantSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  },

  findGrant(tx: Tx, workbookId: string, grantId: string) {
    return tx.shareGrant.findFirst({ where: { id: grantId, workbookId }, select: grantSelect });
  },

  findGrantFor(tx: Tx, workbookId: string, target: { userId?: string; groupId?: string }) {
    return tx.shareGrant.findFirst({
      where: { workbookId, userId: target.userId ?? null, groupId: target.groupId ?? null },
      select: { id: true, role: true },
    });
  },

  createGrant(
    tx: Tx,
    data: {
      workbookId: string;
      userId?: string;
      groupId?: string;
      role: ShareRole;
      createdById: string;
    },
  ) {
    return tx.shareGrant.create({ data, select: grantSelect });
  },

  updateGrantRole(tx: Tx, id: string, role: ShareRole) {
    return tx.shareGrant.update({ where: { id }, data: { role }, select: grantSelect });
  },

  async deleteGrant(tx: Tx, id: string): Promise<void> {
    await tx.shareGrant.delete({ where: { id } });
  },

  async workbooksSharedWithGroup(groupId: string, tx?: Tx) {
    return db(tx).shareGrant.findMany({
      where: { groupId },
      select: { workbookId: true, workbook: { select: { title: true } } },
      orderBy: { workbookId: "asc" },
    });
  },

  async deleteGrantsForGroup(tx: Tx, groupId: string): Promise<number> {
    return (await tx.shareGrant.deleteMany({ where: { groupId } })).count;
  },

  /** Upsert of a direct Editor grant (used by ownership transfer). */
  async ensureUserGrant(
    tx: Tx,
    workbookId: string,
    userId: string,
    role: ShareRole,
    createdById: string,
  ): Promise<void> {
    await tx.shareGrant.upsert({
      where: { workbookId_userId: { workbookId, userId } },
      create: { workbookId, userId, role, createdById },
      update: { role },
    });
  },

  async deleteUserGrant(tx: Tx, workbookId: string, userId: string): Promise<void> {
    await tx.shareGrant.deleteMany({ where: { workbookId, userId } });
  },
};
