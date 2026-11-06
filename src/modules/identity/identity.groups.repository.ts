// Groups and their members (database_schema.md 3.11). Writes only identity tables.
import { getPrisma } from "@/shared/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type Tx = Prisma.TransactionClient;
const db = (tx?: Tx) => tx ?? getPrisma();

const groupSelect = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: true } },
} as const;

export type GroupRow = Prisma.GroupGetPayload<{ select: typeof groupSelect }>;

export const groupsRepository = {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(fn);
  },
  list(q?: string) {
    return getPrisma().group.findMany({
      where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
      select: groupSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 500,
    });
  },
  find(id: string, tx?: Tx) {
    return db(tx).group.findUnique({ where: { id }, select: groupSelect });
  },
  members(groupId: string) {
    return getPrisma().groupMember.findMany({
      where: { groupId },
      select: {
        createdAt: true,
        user: { select: { id: true, email: true, displayName: true, status: true } },
      },
      orderBy: [{ user: { displayName: "asc" } }, { userId: "asc" }],
    });
  },
  create(tx: Tx, data: { name: string; createdById: string }) {
    return tx.group.create({ data, select: groupSelect });
  },
  rename(tx: Tx, id: string, name: string) {
    return tx.group.update({ where: { id }, data: { name }, select: groupSelect });
  },
  async addMembers(tx: Tx, groupId: string, userIds: string[], addedById: string) {
    const result = await tx.groupMember.createMany({
      data: userIds.map((userId) => ({ groupId, userId, addedById })),
      skipDuplicates: true,
    });
    return result.count;
  },
  async removeMember(tx: Tx, groupId: string, userId: string) {
    const result = await tx.groupMember.deleteMany({ where: { groupId, userId } });
    return result.count;
  },
  async delete(tx: Tx, id: string) {
    const result = await tx.group.deleteMany({ where: { id } });
    return result.count;
  },
  /** Users that exist and may be added to a group (any status but rejected or pending). */
  existingUserIds(tx: Tx, ids: string[]) {
    return tx.user.findMany({
      where: { id: { in: ids }, status: { in: ["ACTIVE", "DEACTIVATED"] } },
      select: { id: true },
    });
  },
  /** Active users and groups whose name or email contains q (the Share dialog, P2-SHARE-11). */
  async searchShareTargets(q: string, limit: number) {
    const [users, groups] = await Promise.all([
      getPrisma().user.findMany({
        where: {
          status: "ACTIVE",
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true, email: true, displayName: true },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
        take: limit,
      }),
      getPrisma().group.findMany({
        where: { name: { contains: q, mode: "insensitive" } },
        select: groupSelect,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: limit,
      }),
    ]);
    return { users, groups };
  },
  /** Workbooks shared with the group (read only; shown before deleting it, Decision 52). */
  sharedWorkbooks(groupId: string) {
    return getPrisma().shareGrant.findMany({
      where: { groupId },
      select: { role: true, workbook: { select: { id: true, title: true } } },
      orderBy: { workbookId: "asc" },
    });
  },
  findUser(id: string) {
    return getPrisma().user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, status: true },
    });
  },
};
