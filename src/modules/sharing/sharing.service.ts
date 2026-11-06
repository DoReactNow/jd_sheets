// Sharing (Decisions 17, 52; P2-SHARE-*, P2-LINK-*, P2-GROUP-03): grants to people and groups,
// the company link, the download setting, the role resolver and ownership transfer. Every change
// is audited in its transaction. A workbook someone cannot access is NOT_FOUND (route()).
import { recordAudit } from "@/modules/audit";
import { groupsService } from "@/modules/identity";
import { workbookRecords } from "@/modules/workbooks";
import { notifyAccessChanged } from "@/shared/collab/client";
import { AppError } from "@/shared/errors/AppError";
import type { Principal } from "@/shared/rbac/principal";
import { highestRole, type WorkbookRole } from "@/shared/rbac/workbookAccess";
import { systemClock, toIsoInstant, type Clock } from "@/shared/time";
import type { ShareInput } from "./sharing.schemas";
import { sharingRepository, type GrantRow, type Tx } from "./sharing.repository";
import type { GrantDto, ShareRoleCode, SharingDto, ShareTargetsDto } from "./sharing.types";

export interface Meta {
  ip: string | null;
}

const toGrantDto = (row: GrantRow): GrantDto => ({
  id: row.id,
  role: row.role,
  target: row.user
    ? {
        type: "user",
        id: row.user.id,
        email: row.user.email,
        displayName: row.user.displayName,
        active: row.user.status === "ACTIVE",
      }
    : {
        type: "group",
        id: row.group!.id,
        name: row.group!.name,
        memberCount: row.group!._count.members,
      },
  createdAt: toIsoInstant(row.createdAt),
});

const SEARCH_LIMIT = 10;

export function createSharingService({ clock = systemClock }: { clock?: Clock } = {}) {
  async function settingsOrNotFound(workbookId: string, tx?: Tx) {
    const settings = await workbookRecords.sharingSettings(workbookId, tx);
    if (!settings) throw new AppError("NOT_FOUND");
    return settings;
  }

  async function audit(
    tx: Tx,
    actor: Principal,
    meta: Meta,
    action: string,
    workbookId: string,
    details: Record<string, unknown>,
  ) {
    await recordAudit(tx, {
      action,
      targetType: "workbook",
      targetId: workbookId,
      actorId: actor.userId,
      ip: meta.ip,
      details,
    });
  }

  return {
    /**
     * The person's effective role: owner, direct grant, group grants and the company link; the
     * highest wins (P2-SHARE-08). A trashed workbook exists only for its owner (P2-TRASH-04).
     * The Super Admin bypass never gives a role (P2-SHARE-12). Access through the link counts as
     * opening it, so the workbook then appears in their lists (Decision 52).
     */
    async resolveRole(principal: Principal, workbookId: string): Promise<WorkbookRole | null> {
      const facts = await sharingRepository.accessFacts(principal.userId, workbookId);
      if (!facts) return null;
      if (facts.ownerId !== null && facts.ownerId === principal.userId) return "OWNER";
      if (facts.trashed) return null;
      const granted = highestRole([facts.direct, ...facts.groups]);
      const role = highestRole([granted, facts.linkRole]);
      if (role !== null && role !== granted) {
        await sharingRepository.recordLinkOpen(workbookId, principal.userId, clock.now());
      }
      return role;
    },

    async get(workbookId: string): Promise<SharingDto> {
      const settings = await settingsOrNotFound(workbookId);
      const [grants, owner] = await Promise.all([
        sharingRepository.listGrants(workbookId),
        settings.ownerId ? groupsService.findUser(settings.ownerId) : Promise.resolve(null),
      ]);
      return {
        workbookId,
        owner: owner ? { id: owner.id, email: owner.email, displayName: owner.displayName } : null,
        grants: grants.map(toGrantDto),
        linkRole: settings.linkRole,
        allowDownloadForReaders: settings.allowDownloadForReaders,
      };
    },

    /** Shares with a person or group; sharing again changes the role (P2-SHARE-07). */
    async share(actor: Principal, workbookId: string, input: ShareInput, meta: Meta) {
      const settings = await settingsOrNotFound(workbookId);
      const { type, id } = input.target;
      if (type === "user") {
        const user = await groupsService.findUser(id);
        // Yourself, the owner, unknown, pending, rejected or deactivated (P2-SHARE-06).
        if (!user || user.status !== "ACTIVE" || id === actor.userId || id === settings.ownerId) {
          throw new AppError("SHARE_TARGET_INVALID");
        }
      } else if (!(await groupsService.findGroup(id))) {
        throw new AppError("SHARE_TARGET_INVALID");
      }
      const target = type === "user" ? { userId: id } : { groupId: id };
      return sharingRepository
        .transaction(async (tx) => {
          const existing = await sharingRepository.findGrantFor(tx, workbookId, target);
          let row: GrantRow;
          if (existing) {
            row = await sharingRepository.updateGrantRole(tx, existing.id, input.role);
            await audit(tx, actor, meta, "share.changed", workbookId, {
              grantId: row.id,
              targetType: type,
              targetId: id,
              from: existing.role,
              to: input.role,
            });
          } else {
            row = await sharingRepository.createGrant(tx, {
              workbookId,
              ...target,
              role: input.role,
              createdById: actor.userId,
            });
            await audit(tx, actor, meta, "share.granted", workbookId, {
              grantId: row.id,
              targetType: type,
              targetId: id,
              role: input.role,
            });
          }
          return toGrantDto(row);
        })
        .finally(() => notifyAccessChanged({ workbookId }));
    },

    async changeGrant(
      actor: Principal,
      workbookId: string,
      grantId: string,
      role: ShareRoleCode,
      meta: Meta,
    ): Promise<GrantDto> {
      await settingsOrNotFound(workbookId);
      return sharingRepository
        .transaction(async (tx) => {
          const existing = await sharingRepository.findGrant(tx, workbookId, grantId);
          if (!existing) throw new AppError("NOT_FOUND");
          const row = await sharingRepository.updateGrantRole(tx, grantId, role);
          await audit(tx, actor, meta, "share.changed", workbookId, {
            grantId,
            from: existing.role,
            to: role,
          });
          return toGrantDto(row);
        })
        .finally(() => notifyAccessChanged({ workbookId }));
    },

    async removeGrant(actor: Principal, workbookId: string, grantId: string, meta: Meta) {
      await settingsOrNotFound(workbookId);
      await sharingRepository.transaction(async (tx) => {
        const existing = await sharingRepository.findGrant(tx, workbookId, grantId);
        if (!existing) throw new AppError("NOT_FOUND");
        await sharingRepository.deleteGrant(tx, grantId);
        await audit(tx, actor, meta, "share.removed", workbookId, {
          grantId,
          role: existing.role,
          targetType: existing.user ? "user" : "group",
          targetId: existing.user?.id ?? existing.group?.id,
        });
      });
      notifyAccessChanged({ workbookId });
    },

    /** The company link: a role for any active colleague who opens it, or off (P2-LINK-01/02). */
    async setLink(actor: Principal, workbookId: string, role: ShareRoleCode | null, meta: Meta) {
      const settings = await settingsOrNotFound(workbookId);
      await sharingRepository.transaction(async (tx) => {
        await workbookRecords.updateSharingSettings(tx, workbookId, { linkRole: role });
        await audit(tx, actor, meta, "share.linkChanged", workbookId, {
          from: settings.linkRole,
          to: role,
        });
      });
      notifyAccessChanged({ workbookId });
    },

    async setDownload(actor: Principal, workbookId: string, allow: boolean, meta: Meta) {
      const settings = await settingsOrNotFound(workbookId);
      await sharingRepository.transaction(async (tx) => {
        await workbookRecords.updateSharingSettings(tx, workbookId, {
          allowDownloadForReaders: allow,
        });
        await audit(tx, actor, meta, "share.downloadChanged", workbookId, {
          from: settings.allowDownloadForReaders,
          to: allow,
        });
      });
    },

    /** Active people and groups for the Share dialog (P2-SHARE-11). */
    async targets(q: string): Promise<ShareTargetsDto> {
      const { users, groups } = await groupsService.searchShareTargets(q, SEARCH_LIMIT);
      return {
        users,
        groups: groups.map((g) => ({ id: g.id, name: g.name, memberCount: g._count.members })),
      };
    },

    /**
     * Deletes a group (Decision 52, P2-GROUP-03). When shares use it, the admin must confirm;
     * then the shares and the group go in one transaction.
     */
    async deleteGroup(actor: Principal, groupId: string, confirm: boolean, meta: Meta) {
      if (!(await groupsService.findGroup(groupId))) throw new AppError("NOT_FOUND");
      const shared = await sharingRepository.workbooksSharedWithGroup(groupId);
      if (shared.length > 0 && !confirm) {
        // The warning lists them from GET /api/admin/groups/:id (sharedWorkbooks).
        throw new AppError("GROUP_IN_USE", { logContext: { groupId, shares: shared.length } });
      }
      await sharingRepository.transaction(async (tx) => {
        const removed = await sharingRepository.deleteGrantsForGroup(tx, groupId);
        await groupsService.deleteInTx(tx, actor, groupId, meta, { sharesRemoved: removed });
      });
      for (const { workbookId } of shared) notifyAccessChanged({ workbookId });
    },

    /**
     * Ownership transfer by an administrator (P2-ADMINWB-02, Decision 52): the old owner keeps a
     * direct Editor grant; the new owner's own grant, if any, goes (they own it now).
     */
    async transferOwnership(actor: Principal, workbookId: string, newOwnerId: string, meta: Meta) {
      const user = await groupsService.findUser(newOwnerId);
      if (!user || user.status !== "ACTIVE") throw new AppError("SHARE_TARGET_INVALID");
      await sharingRepository.transaction(async (tx) => {
        const settings = await settingsOrNotFound(workbookId, tx);
        if (settings.ownerId === newOwnerId) return;
        await workbookRecords.setOwner(tx, workbookId, newOwnerId);
        await sharingRepository.deleteUserGrant(tx, workbookId, newOwnerId);
        if (settings.ownerId) {
          await sharingRepository.ensureUserGrant(
            tx,
            workbookId,
            settings.ownerId,
            "EDITOR",
            actor.userId,
          );
        }
        await audit(tx, actor, meta, "workbook.ownershipTransferred", workbookId, {
          from: settings.ownerId,
          to: newOwnerId,
        });
      });
      notifyAccessChanged({ workbookId });
    },
  };
}

export const sharingService = createSharingService();
export type SharingService = ReturnType<typeof createSharingService>;
