// Database access for the identity module. Writes only identity_* and rbac_* tables. No rules.
import { getPrisma } from "@/shared/db/prisma";
import { Prisma, type SignupSource, type UserStatus } from "@/generated/prisma/client";
import { instantFromEpochMs } from "@/shared/time";

export type Tx = Prisma.TransactionClient;
const db = (tx?: Tx) => tx ?? getPrisma();

export const principalUserSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  mustChangePassword: true,
  role: {
    select: { key: true, bypassesAccess: true, permissions: { select: { permission: true } } },
  },
} satisfies Prisma.UserSelect;

export type PrincipalUser = Prisma.UserGetPayload<{ select: typeof principalUserSelect }>;

export const authUserSelect = {
  ...principalUserSelect,
  passwordHash: true,
  failedSignInCount: true,
  lockedUntil: true,
} satisfies Prisma.UserSelect;

export type AuthUser = Prisma.UserGetPayload<{ select: typeof authUserSelect }>;

export const adminUserSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  signupSource: true,
  rejectedBefore: true,
  mustChangePassword: true,
  lastSignInAt: true,
  createdAt: true,
  role: { select: { key: true, name: true } },
} satisfies Prisma.UserSelect;

export type AdminUserRow = Prisma.UserGetPayload<{ select: typeof adminUserSelect }>;

export interface UserListFilter {
  status?: UserStatus;
  roleKey?: string;
  search?: string;
}

export const identityRepository = {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return getPrisma().$transaction(fn);
  },

  // --- roles ---------------------------------------------------------------------------------
  findRole(key: string, tx?: Tx) {
    return db(tx).role.findUnique({
      where: { key },
      select: { id: true, key: true, bypassesAccess: true },
    });
  },
  createRole(data: { key: string; name: string; bypassesAccess: boolean }) {
    return getPrisma().role.create({ data: { ...data, isSystem: true } });
  },
  async addGrantIfMissing(roleId: string, permission: string): Promise<boolean> {
    const result = await getPrisma().rolePermission.createMany({
      data: [{ roleId, permission, source: "DEFAULT" }],
      skipDuplicates: true,
    });
    return result.count > 0;
  },

  // --- users ---------------------------------------------------------------------------------
  findAuthUserByEmail(email: string) {
    return getPrisma().user.findUnique({
      where: { email },
      select: { ...authUserSelect, status: true },
    });
  },
  findAuthUserById(id: string, tx?: Tx) {
    return db(tx).user.findUnique({ where: { id }, select: authUserSelect });
  },
  findUserStatusByEmail(email: string, tx?: Tx) {
    return db(tx).user.findUnique({ where: { email }, select: { id: true, status: true } });
  },
  findAdminUser(id: string, tx?: Tx) {
    return db(tx).user.findUnique({ where: { id }, select: { ...adminUserSelect, roleId: true } });
  },
  listUsers(filter: UserListFilter) {
    const search = filter.search?.trim();
    return getPrisma().user.findMany({
      where: {
        status: filter.status,
        role: filter.roleKey ? { key: filter.roleKey } : undefined,
        OR: search
          ? [
              { displayName: { contains: search, mode: "insensitive" } },
              { email: { contains: search.toLowerCase() } },
            ]
          : undefined,
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: 500,
      select: adminUserSelect,
    });
  },
  listPending() {
    return getPrisma().user.findMany({
      where: { status: "PENDING_APPROVAL" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: adminUserSelect,
    });
  },
  countPending() {
    return getPrisma().user.count({ where: { status: "PENDING_APPROVAL" } });
  },
  createUser(
    tx: Tx,
    data: {
      email: string;
      displayName: string;
      passwordHash: string;
      status: UserStatus;
      roleId: string | null;
      mustChangePassword: boolean;
      signupSource: SignupSource;
    },
  ) {
    return tx.user.create({ data, select: { id: true } });
  },
  /** Updates only when the user is still in `fromStatus`; returns how many rows changed (0 or 1). */
  async updateUserIfStatus(
    tx: Tx,
    id: string,
    fromStatus: UserStatus,
    data: Prisma.UserUncheckedUpdateInput,
  ) {
    return (await tx.user.updateMany({ where: { id, status: fromStatus }, data })).count;
  },
  updateUser(tx: Tx, id: string, data: Prisma.UserUncheckedUpdateInput) {
    return tx.user.update({ where: { id }, data, select: { id: true } });
  },

  // --- sign-in counters ----------------------------------------------------------------------
  /** Adds a failure; locks the account when it reaches `lockAfter`. Atomic. Returns the new state. */
  async countFailure(id: string, now: Date, lockAfter: number, lockMinutes: number) {
    const lockUntil = instantFromEpochMs(now.getTime() + lockMinutes * 60_000);
    const rows = await getPrisma().$queryRaw<
      Array<{ failed: number; locked_until: Date | null }>
    >(Prisma.sql`
      UPDATE identity_users SET
        failed_sign_in_count = CASE WHEN failed_sign_in_count + 1 >= ${lockAfter} THEN 0 ELSE failed_sign_in_count + 1 END,
        locked_until = CASE WHEN failed_sign_in_count + 1 >= ${lockAfter} THEN ${lockUntil} ELSE locked_until END,
        updated_at = ${now}
      WHERE id = ${id}::uuid
      RETURNING failed_sign_in_count AS failed, locked_until`);
    const lockedUntil = rows[0]?.locked_until ?? null;
    return { locked: lockedUntil !== null && lockedUntil.getTime() > now.getTime() };
  },

  // --- sessions ------------------------------------------------------------------------------
  createSession(
    tx: Tx,
    data: {
      userId: string;
      tokenHash: string;
      ip: string | null;
      userAgent: string | null;
      expiresAt: Date;
      absoluteExpiresAt: Date;
      now: Date;
    },
  ) {
    const { now, ...rest } = data;
    return tx.session.create({
      data: { ...rest, createdAt: now, lastSeenAt: now },
      select: { id: true },
    });
  },
  findSession(tokenHash: string) {
    return getPrisma().session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        expiresAt: true,
        absoluteExpiresAt: true,
        revokedAt: true,
        lastSeenAt: true,
        user: { select: principalUserSelect },
      },
    });
  },
  extendSession(id: string, data: { seenBefore: Date; now: Date; expiresAt: Date }) {
    return getPrisma().session.updateMany({
      where: { id, lastSeenAt: { lte: data.seenBefore }, revokedAt: null },
      data: { lastSeenAt: data.now, expiresAt: data.expiresAt },
    });
  },
  async revokeSession(tx: Tx, tokenHash: string, now: Date) {
    const session = await tx.session.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (!session || session.revokedAt) return null;
    await tx.session.update({ where: { id: session.id }, data: { revokedAt: now } });
    return session.userId;
  },
  async revokeAllSessions(tx: Tx, userId: string, now: Date, exceptSessionId?: string | null) {
    return (
      await tx.session.updateMany({
        where: {
          userId,
          revokedAt: null,
          id: exceptSessionId ? { not: exceptSessionId } : undefined,
        },
        data: { revokedAt: now },
      })
    ).count;
  },

  // --- sign-up codes -------------------------------------------------------------------------
  latestOtp(email: string) {
    return getPrisma().signupOtp.findFirst({
      where: { email },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  },
  findOtp(id: string) {
    return getPrisma().signupOtp.findUnique({ where: { id } });
  },
  async voidOpenOtps(tx: Tx, email: string, now: Date) {
    await tx.signupOtp.updateMany({
      where: { email, consumedAt: null, voidedAt: null },
      data: { voidedAt: now },
    });
  },
  createOtp(tx: Tx, data: { email: string; expiresAt: Date; requestIp: string | null; now: Date }) {
    const { now, ...rest } = data;
    return tx.signupOtp.create({ data: { ...rest, createdAt: now }, select: { id: true } });
  },
  /** Sets the code hash once; false when it was already set or the code was voided. */
  async setOtpCode(id: string, codeHash: string): Promise<boolean> {
    return (
      (
        await getPrisma().signupOtp.updateMany({
          where: { id, codeHash: null, voidedAt: null },
          data: { codeHash },
        })
      ).count === 1
    );
  },
  async clearOtpCode(id: string, codeHash: string): Promise<void> {
    await getPrisma().signupOtp.updateMany({ where: { id, codeHash }, data: { codeHash: null } });
  },
  async countOtpAttempt(id: string): Promise<number> {
    const row = await getPrisma().signupOtp.update({
      where: { id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return row.attempts;
  },
  async consumeOtp(
    id: string,
    data: { now: Date; ticketHash: string; ticketExpiresAt: Date },
  ): Promise<boolean> {
    return (
      (
        await getPrisma().signupOtp.updateMany({
          where: { id, consumedAt: null, voidedAt: null },
          data: {
            consumedAt: data.now,
            ticketHash: data.ticketHash,
            ticketExpiresAt: data.ticketExpiresAt,
          },
        })
      ).count === 1
    );
  },
  findOtpByTicket(ticketHash: string, tx?: Tx) {
    return db(tx).signupOtp.findUnique({ where: { ticketHash } });
  },
  async useTicket(tx: Tx, id: string, ticketHash: string): Promise<boolean> {
    return (
      (
        await tx.signupOtp.updateMany({
          where: { id, ticketHash },
          data: { ticketHash: null, ticketExpiresAt: null },
        })
      ).count === 1
    );
  },

  // --- rate limits ---------------------------------------------------------------------------
  /** Counts one hit in the fixed window that contains `now`; returns the count including it. */
  async hit(bucket: string, now: Date, windowMinutes: number): Promise<number> {
    const windowMs = windowMinutes * 60_000;
    const windowStart = instantFromEpochMs(Math.floor(now.getTime() / windowMs) * windowMs);
    const rows = await getPrisma().$queryRaw<Array<{ count: number }>>(Prisma.sql`
      INSERT INTO identity_rate_limits (bucket, window_start, count)
      VALUES (${bucket}, ${windowStart}, 1)
      ON CONFLICT (bucket, window_start) DO UPDATE SET count = identity_rate_limits.count + 1
      RETURNING count`);
    return Number(rows[0]?.count ?? 0);
  },

  // --- cleanup -------------------------------------------------------------------------------
  async cleanup(now: Date) {
    const dayAgo = instantFromEpochMs(now.getTime() - 24 * 3_600_000);
    const prisma = getPrisma();
    const [limits, otps, sessions] = await Promise.all([
      prisma.rateLimit.deleteMany({ where: { windowStart: { lt: dayAgo } } }),
      prisma.signupOtp.deleteMany({ where: { expiresAt: { lt: dayAgo } } }),
      prisma.session.deleteMany({
        where: { OR: [{ expiresAt: { lt: dayAgo } }, { revokedAt: { lt: dayAgo } }] },
      }),
    ]);
    return { limits: limits.count, otps: otps.count, sessions: sessions.count };
  },
};

export type IdentityRepository = typeof identityRepository;
