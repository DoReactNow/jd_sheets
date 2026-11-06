// Groups (P2-GROUP-01..05): admins with groups:manage create, rename and delete groups and add
// and remove members. Every change is audited in its transaction. Deleting a group that shares use
// is coordinated by the sharing module (Decision 52), which calls deleteInTx inside its own
// transaction after removing the shares.
import { recordAudit } from "@/modules/audit";
import { AppError } from "@/shared/errors/AppError";
import type { Principal } from "@/shared/rbac/principal";
import { toIsoInstant } from "@/shared/time";
import { groupsRepository, type GroupRow, type Tx } from "./identity.groups.repository";

export interface GroupDto {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMemberDto {
  id: string;
  email: string;
  displayName: string;
  status: string;
  addedAt: string;
}

export interface Meta {
  ip: string | null;
}

const toDto = (row: GroupRow): GroupDto => ({
  id: row.id,
  name: row.name,
  memberCount: row._count.members,
  createdAt: toIsoInstant(row.createdAt),
  updatedAt: toIsoInstant(row.updatedAt),
});

function isNameTaken(error: unknown): boolean {
  return error instanceof Error && /identity_groups_name_ci/.test(error.message);
}

async function withNameRule<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isNameTaken(error) || (error as { code?: string }).code === "P2002") {
      throw new AppError("GROUP_NAME_TAKEN");
    }
    throw error;
  }
}

export const groupsService = {
  async list(q?: string): Promise<GroupDto[]> {
    return (await groupsRepository.list(q)).map(toDto);
  },

  async get(id: string): Promise<{
    group: GroupDto;
    members: GroupMemberDto[];
    sharedWorkbooks: Array<{ id: string; title: string; role: string }>;
  }> {
    const group = await groupsRepository.find(id);
    if (!group) throw new AppError("NOT_FOUND");
    const [members, shared] = await Promise.all([
      groupsRepository.members(id),
      groupsRepository.sharedWorkbooks(id),
    ]);
    return {
      group: toDto(group),
      sharedWorkbooks: shared.map((s) => ({ ...s.workbook, role: s.role })),
      members: members.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        displayName: m.user.displayName,
        status: m.user.status,
        addedAt: toIsoInstant(m.createdAt),
      })),
    };
  },

  async create(actor: Principal, name: string, meta: Meta): Promise<GroupDto> {
    return withNameRule(() =>
      groupsRepository.transaction(async (tx) => {
        const row = await groupsRepository.create(tx, { name, createdById: actor.userId });
        await recordAudit(tx, {
          action: "group.created",
          targetType: "group",
          targetId: row.id,
          actorId: actor.userId,
          ip: meta.ip,
          details: { name },
        });
        return toDto(row);
      }),
    );
  },

  async rename(actor: Principal, id: string, name: string, meta: Meta): Promise<GroupDto> {
    return withNameRule(() =>
      groupsRepository.transaction(async (tx) => {
        const before = await groupsRepository.find(id, tx);
        if (!before) throw new AppError("NOT_FOUND");
        const row = await groupsRepository.rename(tx, id, name);
        await recordAudit(tx, {
          action: "group.renamed",
          targetType: "group",
          targetId: id,
          actorId: actor.userId,
          ip: meta.ip,
          details: { from: before.name, to: name },
        });
        return toDto(row);
      }),
    );
  },

  async addMembers(actor: Principal, id: string, userIds: string[], meta: Meta): Promise<number> {
    return groupsRepository.transaction(async (tx) => {
      if (!(await groupsRepository.find(id, tx))) throw new AppError("NOT_FOUND");
      const unique = [...new Set(userIds)];
      const existing = await groupsRepository.existingUserIds(tx, unique);
      if (existing.length !== unique.length) {
        throw new AppError("VALIDATION_FAILED", {
          fieldErrors: [{ field: "userIds", message: "Choose people who have an account." }],
        });
      }
      const added = await groupsRepository.addMembers(tx, id, unique, actor.userId);
      await recordAudit(tx, {
        action: "group.membersAdded",
        targetType: "group",
        targetId: id,
        actorId: actor.userId,
        ip: meta.ip,
        details: { userIds: unique, added },
      });
      return added;
    });
  },

  async removeMember(actor: Principal, id: string, userId: string, meta: Meta): Promise<void> {
    await groupsRepository.transaction(async (tx) => {
      if (!(await groupsRepository.find(id, tx))) throw new AppError("NOT_FOUND");
      const removed = await groupsRepository.removeMember(tx, id, userId);
      if (removed === 0) throw new AppError("NOT_FOUND");
      await recordAudit(tx, {
        action: "group.memberRemoved",
        targetType: "group",
        targetId: id,
        actorId: actor.userId,
        ip: meta.ip,
        details: { userId },
      });
    });
  },

  /** Deletes the group inside the caller's transaction (shares must already be gone). */
  async deleteInTx(
    tx: Tx,
    actor: Principal,
    id: string,
    meta: Meta,
    details: Record<string, unknown>,
  ): Promise<void> {
    const group = await groupsRepository.find(id, tx);
    if (!group) throw new AppError("NOT_FOUND");
    await groupsRepository.delete(tx, id);
    await recordAudit(tx, {
      action: "group.deleted",
      targetType: "group",
      targetId: id,
      actorId: actor.userId,
      ip: meta.ip,
      details: { name: group.name, ...details },
    });
  },

  searchShareTargets: groupsRepository.searchShareTargets,
  findUser: groupsRepository.findUser,
  findGroup: (id: string) => groupsRepository.find(id),
  transaction: groupsRepository.transaction,
};

export type GroupsService = typeof groupsService;
