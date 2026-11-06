// Signing in and out, sessions and password changes (Decisions 14, 48). An unknown email and a
// deactivated account behave alike, so no answer reveals which accounts exist. Pending and
// rejected accounts learn their status only after the right password (P1-APPROVE-08..10).
import { createHash, randomBytes } from "node:crypto";
import { recordAudit } from "@/modules/audit";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { AppError } from "@/shared/errors/AppError";
import { readSessionToken } from "@/shared/http/sessionCookie";
import type { Principal } from "@/shared/rbac/principal";
import type { PrincipalResolver } from "@/shared/rbac/principalResolver";
import { instantFromEpochMs, plusDuration, systemClock, type Clock } from "@/shared/time";
import { normalizeEmail } from "./identity.email";
import { assertPasswordAllowed, hashPassword, verifyPassword } from "./identity.passwords";
import { buildPrincipal } from "./identity.rbac";
import { bucketKey } from "./identity.keys";
import { identityRepository } from "./identity.repository";

const AUTH = APP_CONFIG.auth;

export const newSessionToken = (): string => randomBytes(32).toString("base64url");
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** 12 hours after activity, never later than 7 days after sign-in. */
export function sessionExpiry(signedInAt: Date, activityAt: Date): Date {
  const idle = plusDuration(activityAt, { hours: AUTH.sessionIdleHours });
  const cap = plusDuration(signedInAt, { days: AUTH.sessionMaxDays });
  return idle.getTime() < cap.getTime() ? idle : cap;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  /** The request came from outside the allowed networks (Decision 57). */
  outsideNetwork?: boolean;
}

export function createAuthService({ clock = systemClock }: { clock?: Clock } = {}) {
  return {
    async signIn(
      input: { email: string; password: string },
      meta: RequestMeta,
    ): Promise<{ token: string; mustChangePassword: boolean }> {
      const now = clock.now();
      const ipHits = await identityRepository.hit(
        bucketKey("signin-ip", meta.ip ?? "unknown"),
        now,
        AUTH.signInWindowMinutes,
      );
      if (ipHits > AUTH.signInAttemptsPerIp) throw new AppError("RATE_LIMITED");

      const email = normalizeEmail(input.email);
      const user = await identityRepository.findAuthUserByEmail(email);
      // Unknown and deactivated accounts: same work, same answer (P1-SIGNIN-02, -03).
      if (!user || user.status === "DEACTIVATED") {
        await verifyPassword(input.password, null);
        throw new AppError("INVALID_CREDENTIALS");
      }
      if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
        await identityRepository.transaction((tx) =>
          recordAudit(tx, {
            action: "auth.sign_in_refused_locked",
            targetType: "user",
            targetId: user.id,
            actorId: null,
            ip: meta.ip,
          }),
        );
        throw new AppError("RATE_LIMITED");
      }
      if (!(await verifyPassword(input.password, user.passwordHash))) {
        const { locked } = await identityRepository.countFailure(
          user.id,
          now,
          AUTH.lockAfterFailures,
          AUTH.lockMinutes,
        );
        if (locked) {
          await identityRepository.transaction((tx) =>
            recordAudit(tx, {
              action: "auth.locked",
              targetType: "user",
              targetId: user.id,
              actorId: null,
              ip: meta.ip,
            }),
          );
          throw new AppError("RATE_LIMITED");
        }
        throw new AppError("INVALID_CREDENTIALS");
      }
      if (user.status === "PENDING_APPROVAL") throw new AppError("ACCOUNT_PENDING");
      if (user.status === "REJECTED") throw new AppError("ACCOUNT_REJECTED");
      // From outside the allowed networks only a Super Admin gets a session (Decision 57).
      if (meta.outsideNetwork && !user.role?.bypassesAccess) {
        await identityRepository.transaction((tx) =>
          recordAudit(tx, {
            action: "auth.sign_in_refused_network",
            targetType: "user",
            targetId: user.id,
            actorId: null,
            ip: meta.ip,
          }),
        );
        throw new AppError("NETWORK_BLOCKED");
      }

      const token = newSessionToken();
      await identityRepository.transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { failedSignInCount: 0, lockedUntil: null, lastSignInAt: now },
        });
        await identityRepository.createSession(tx, {
          userId: user.id,
          tokenHash: hashToken(token),
          ip: meta.ip,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
          expiresAt: sessionExpiry(now, now),
          absoluteExpiresAt: plusDuration(now, { days: AUTH.sessionMaxDays }),
          now,
        });
        await recordAudit(tx, {
          action: "auth.signed_in",
          targetType: "user",
          targetId: user.id,
          actorId: user.id,
          ip: meta.ip,
        });
        if (meta.outsideNetwork) {
          await recordAudit(tx, {
            action: "network.outsideAccess",
            targetType: "user",
            targetId: user.id,
            actorId: user.id,
            ip: meta.ip,
            details: { kind: "sign-in" },
          });
        }
      });
      return { token, mustChangePassword: user.mustChangePassword };
    },

    /** Ends this session only. Repeating it, or having no session, succeeds quietly. */
    async signOut(token: string | null, meta: RequestMeta): Promise<void> {
      if (!token) return;
      await identityRepository.transaction(async (tx) => {
        const userId = await identityRepository.revokeSession(tx, hashToken(token), clock.now());
        if (userId) {
          await recordAudit(tx, {
            action: "auth.signed_out",
            targetType: "user",
            targetId: userId,
            actorId: userId,
            ip: meta.ip,
          });
        }
      });
    },

    /** Changes the caller's own password; other sessions are signed out (P1-PWD-04, P1-SIGNIN-06). */
    async changePassword(
      principal: Principal,
      input: { currentPassword: string; newPassword: string },
      meta: RequestMeta,
    ): Promise<void> {
      const user = await identityRepository.findAuthUserById(principal.userId);
      if (!user) throw new AppError("UNAUTHENTICATED");
      if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw new AppError("VALIDATION_FAILED", {
          fieldErrors: [{ field: "currentPassword", message: "That isn't your current password." }],
        });
      }
      assertPasswordAllowed(input.newPassword, user.email, "newPassword");
      if (await verifyPassword(input.newPassword, user.passwordHash)) {
        throw new AppError("VALIDATION_FAILED", {
          fieldErrors: [
            { field: "newPassword", message: "Choose a password you haven't used here just now." },
          ],
        });
      }
      const passwordHash = await hashPassword(input.newPassword);
      const now = clock.now();
      await identityRepository.transaction(async (tx) => {
        await identityRepository.updateUser(tx, user.id, {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: now,
        });
        await identityRepository.revokeAllSessions(tx, user.id, now, principal.sessionId);
        await recordAudit(tx, {
          action: "user.password_changed",
          targetType: "user",
          targetId: user.id,
          actorId: user.id,
          ip: meta.ip,
        });
      });
    },
  };
}

/** Resolves each request from its session cookie (Decision 14). Rebuilt every request. */
export function createSessionPrincipalResolver({
  clock = systemClock,
}: { clock?: Clock } = {}): PrincipalResolver {
  const extendEveryMs = AUTH.sessionExtendEveryMinutes * 60_000;
  return async ({ headers }) => {
    const token = readSessionToken(headers);
    if (!token) return null;
    const session = await identityRepository.findSession(hashToken(token));
    if (!session || session.revokedAt || session.user.status !== "ACTIVE") return null;
    const now = clock.now();
    if (
      session.expiresAt.getTime() <= now.getTime() ||
      session.absoluteExpiresAt.getTime() <= now.getTime()
    )
      return null;
    const seenBefore = instantFromEpochMs(now.getTime() - extendEveryMs);
    if (session.lastSeenAt.getTime() <= seenBefore.getTime()) {
      const signedInAt = plusDuration(session.absoluteExpiresAt, { days: -AUTH.sessionMaxDays });
      await identityRepository.extendSession(session.id, {
        seenBefore,
        now,
        expiresAt: sessionExpiry(signedInAt, now),
      });
    }
    return buildPrincipal(session.user, session.id);
  };
}

export const authService = createAuthService();
