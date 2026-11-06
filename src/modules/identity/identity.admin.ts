// Account administration (Decisions 12, 15, 16): the approval queue, user management, password
// resets and the Super Admin protections. Every change is audited in the same transaction.
import { recordAudit } from "@/modules/audit";
import { notifyAccessChanged } from "@/shared/collab/client";
import { AppError } from "@/shared/errors/AppError";
import { can } from "@/shared/rbac/guard";
import type { Principal } from "@/shared/rbac/principal";
import { SYSTEM_ROLE_CODES, type SystemRoleCode } from "@/shared/rbac/defaultRoles";
import { systemClock, toIsoInstant, type Clock } from "@/shared/time";
import { normalizeEmail } from "./identity.email";
import {
  assertPasswordAllowed,
  generateTemporaryPassword,
  hashPassword,
} from "./identity.passwords";
import {
  identityRepository,
  type AdminUserRow,
  type Tx,
  type UserListFilter,
} from "./identity.repository";

export type { AdminUserDto } from "./identity.types";
import type { AdminUserDto } from "./identity.types";

const toDto = (row: AdminUserRow): AdminUserDto => ({
  id: row.id,
  email: row.email,
  displayName: row.displayName,
  status: row.status,
  roleKey: row.role?.key ?? null,
  roleName: row.role?.name ?? null,
  signupSource: row.signupSource,
  rejectedBefore: row.rejectedBefore,
  mustChangePassword: row.mustChangePassword,
  lastSignInAt: row.lastSignInAt ? toIsoInstant(row.lastSignInAt) : null,
  createdAt: toIsoInstant(row.createdAt),
});

/** Only the bypass reaches the reserved code: creating, changing or resetting a Super Admin. */
function assertMayManage(actor: Principal, targetRoleKey: string | null | undefined) {
  if (targetRoleKey === "SUPER_ADMIN" && !can(actor, "users:manage-super-admins")) {
    throw new AppError("FORBIDDEN", {
      logContext: { rule: "manage-super-admin", actor: actor.userId },
    });
  }
}

function isLastSuperAdminError(error: unknown): boolean {
  return error instanceof Error && /last active super admin/.test(error.message);
}

async function roleIdFor(key: string, tx: Tx): Promise<string> {
  if (!(SYSTEM_ROLE_CODES as readonly string[]).includes(key)) {
    throw new AppError("VALIDATION_FAILED", {
      fieldErrors: [{ field: "role", message: "Choose a role." }],
    });
  }
  const role = await identityRepository.findRole(key, tx);
  if (!role)
    throw new AppError("VALIDATION_FAILED", {
      fieldErrors: [{ field: "role", message: "Choose a role." }],
    });
  return role.id;
}

export interface Meta {
  ip: string | null;
}

export function createAdminService({ clock = systemClock }: { clock?: Clock } = {}) {
  async function target(id: string, tx?: Tx) {
    const user = await identityRepository.findAdminUser(id, tx);
    if (!user) throw new AppError("NOT_FOUND");
    return user;
  }

  return {
    // --- approvals ---------------------------------------------------------------------------
    async listPending(): Promise<AdminUserDto[]> {
      return (await identityRepository.listPending()).map(toDto);
    },
    countPending: () => identityRepository.countPending(),

    async approve(
      actor: Principal,
      userId: string,
      roleKey: SystemRoleCode,
      meta: Meta,
    ): Promise<void> {
      assertMayManage(actor, roleKey);
      const now = clock.now();
      await identityRepository.transaction(async (tx) => {
        await target(userId, tx);
        const roleId = await roleIdFor(roleKey, tx);
        const changed = await identityRepository.updateUserIfStatus(
          tx,
          userId,
          "PENDING_APPROVAL",
          {
            status: "ACTIVE",
            roleId,
            approvedById: actor.userId,
            approvedAt: now,
          },
        );
        if (changed === 0) throw new AppError("CONFLICT"); // decided already (P1-APPROVE-06, -07)
        await recordAudit(tx, {
          action: "user.approved",
          targetType: "user",
          targetId: userId,
          actorId: actor.userId,
          ip: meta.ip,
          details: { role: roleKey },
        });
      });
    },

    async reject(actor: Principal, userId: string, meta: Meta): Promise<void> {
      const now = clock.now();
      await identityRepository.transaction(async (tx) => {
        await target(userId, tx);
        const changed = await identityRepository.updateUserIfStatus(
          tx,
          userId,
          "PENDING_APPROVAL",
          {
            status: "REJECTED",
            rejectedById: actor.userId,
            rejectedAt: now,
          },
        );
        if (changed === 0) throw new AppError("CONFLICT");
        await recordAudit(tx, {
          action: "user.rejected",
          targetType: "user",
          targetId: userId,
          actorId: actor.userId,
          ip: meta.ip,
        });
      });
    },

    // --- users -------------------------------------------------------------------------------
    async list(filter: UserListFilter): Promise<AdminUserDto[]> {
      return (await identityRepository.listUsers(filter)).map(toDto);
    },

    async get(userId: string): Promise<AdminUserDto> {
      return toDto(await target(userId));
    },

    /** An account made by an admin: active, with a temporary password (P1-USERS-01). */
    async create(
      actor: Principal,
      input: {
        email: string;
        displayName: string;
        roleKey: SystemRoleCode;
        temporaryPassword?: string;
      },
      meta: Meta,
    ): Promise<{ user: AdminUserDto; temporaryPassword: string }> {
      assertMayManage(actor, input.roleKey);
      const email = normalizeEmail(input.email);
      const temporaryPassword = input.temporaryPassword ?? generateTemporaryPassword();
      assertPasswordAllowed(temporaryPassword, email, "temporaryPassword");
      const passwordHash = await hashPassword(temporaryPassword);
      const userId = await identityRepository.transaction(async (tx) => {
        if (await identityRepository.findUserStatusByEmail(email, tx)) {
          throw new AppError("CONFLICT", {
            fieldErrors: [
              { field: "email", message: "Someone already has an account with this email." },
            ],
          });
        }
        const created = await identityRepository.createUser(tx, {
          email,
          displayName: input.displayName,
          passwordHash,
          status: "ACTIVE",
          roleId: await roleIdFor(input.roleKey, tx),
          mustChangePassword: true,
          signupSource: "ADMIN",
        });
        await recordAudit(tx, {
          action: "user.created",
          targetType: "user",
          targetId: created.id,
          actorId: actor.userId,
          ip: meta.ip,
          details: { role: input.roleKey },
        });
        return created.id;
      });
      return { user: await this.get(userId), temporaryPassword };
    },

    async update(
      actor: Principal,
      userId: string,
      input: { displayName?: string; roleKey?: SystemRoleCode },
      meta: Meta,
    ): Promise<AdminUserDto> {
      await identityRepository.transaction(async (tx) => {
        const user = await target(userId, tx);
        assertMayManage(actor, user.role?.key);
        if (input.roleKey) assertMayManage(actor, input.roleKey);
        if (input.roleKey && user.status !== "ACTIVE") {
          throw new AppError("VALIDATION_FAILED", {
            fieldErrors: [{ field: "role", message: "Only active accounts can change role." }],
          });
        }
        const data: Record<string, unknown> = {};
        if (input.displayName !== undefined) data.displayName = input.displayName;
        if (input.roleKey) data.roleId = await roleIdFor(input.roleKey, tx);
        try {
          await identityRepository.updateUser(tx, userId, data);
        } catch (error) {
          if (isLastSuperAdminError(error)) throw new AppError("CONFLICT", { cause: error });
          throw error;
        }
        await recordAudit(tx, {
          action: "user.updated",
          targetType: "user",
          targetId: userId,
          actorId: actor.userId,
          ip: meta.ip,
          details: { fields: Object.keys(data), ...(input.roleKey ? { role: input.roleKey } : {}) },
        });
      });
      return this.get(userId);
    },

    async setActive(
      actor: Principal,
      userId: string,
      active: boolean,
      meta: Meta,
    ): Promise<AdminUserDto> {
      if (userId === actor.userId) {
        throw new AppError("VALIDATION_FAILED", {
          fieldErrors: [{ field: "_root", message: "You can't deactivate your own account." }],
        });
      }
      const now = clock.now();
      await identityRepository.transaction(async (tx) => {
        const user = await target(userId, tx);
        assertMayManage(actor, user.role?.key);
        const from = active ? "DEACTIVATED" : "ACTIVE";
        try {
          const changed = await identityRepository.updateUserIfStatus(tx, userId, from, {
            status: active ? "ACTIVE" : "DEACTIVATED",
            deactivatedAt: active ? null : now,
          });
          if (changed === 0) throw new AppError("CONFLICT");
        } catch (error) {
          if (isLastSuperAdminError(error)) throw new AppError("CONFLICT", { cause: error });
          throw error;
        }
        if (!active) await identityRepository.revokeAllSessions(tx, userId, now);
        await recordAudit(tx, {
          action: active ? "user.reactivated" : "user.deactivated",
          targetType: "user",
          targetId: userId,
          actorId: actor.userId,
          ip: meta.ip,
        });
      });
      // A deactivated person's live connections close within seconds (P3-WS-04).
      if (!active) notifyAccessChanged({ userId });
      return this.get(userId);
    },

    /** A temporary password; the person must change it, and every session ends (P1-RESET-01). */
    async resetPassword(
      actor: Principal,
      userId: string,
      input: { temporaryPassword?: string },
      meta: Meta,
    ): Promise<{ temporaryPassword: string }> {
      const user = await target(userId);
      assertMayManage(actor, user.role?.key);
      if (user.status !== "ACTIVE") {
        throw new AppError("VALIDATION_FAILED", {
          fieldErrors: [
            { field: "_root", message: "Only active accounts can have their password reset." },
          ],
        });
      }
      const temporaryPassword = input.temporaryPassword ?? generateTemporaryPassword();
      assertPasswordAllowed(temporaryPassword, user.email, "temporaryPassword");
      const passwordHash = await hashPassword(temporaryPassword);
      const now = clock.now();
      await identityRepository.transaction(async (tx) => {
        await identityRepository.updateUser(tx, userId, {
          passwordHash,
          mustChangePassword: true,
          failedSignInCount: 0,
          lockedUntil: null,
          passwordChangedAt: now,
        });
        await identityRepository.revokeAllSessions(tx, userId, now);
        await recordAudit(tx, {
          action: "user.password_reset",
          targetType: "user",
          targetId: userId,
          actorId: actor.userId,
          ip: meta.ip,
        });
      });
      return { temporaryPassword };
    },
  };
}

export const adminService = createAdminService();
