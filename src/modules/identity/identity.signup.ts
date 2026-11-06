// Self sign-up (Decisions 12, 13): email → emailed code → name and password → pending approval.
// No answer reveals whether an address already has an account (P1-SIGNUP-02, -03). The code is
// made by the identity.sendOtp job, so only its keyed hash is ever stored (P1-OTP-07).
import { randomBytes, randomInt } from "node:crypto";
import { recordAudit } from "@/modules/audit";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { AppError } from "@/shared/errors/AppError";
import type { Mailer } from "@/shared/mail";
import { plusDuration, systemClock, type Clock } from "@/shared/time";
import { normalizeEmail } from "./identity.email";
import { bucketKey, keyedHash, sameHash } from "./identity.keys";
import { assertPasswordAllowed, hashPassword } from "./identity.passwords";
import { identityRepository } from "./identity.repository";
import type { RequestMeta } from "./identity.auth";

const OTP = APP_CONFIG.otp;

export interface SignupDeps {
  clock?: Clock;
  /** Enqueues identity.sendOtp; injected so the service does not import the job module. */
  enqueueOtpMail: (otpId: string) => Promise<void>;
}

export function createSignupService({ clock = systemClock, enqueueOtpMail }: SignupDeps) {
  return {
    /** Step 1. Always answers the same way; sends a code only when sign-up is possible. */
    async requestCode(rawEmail: string, meta: RequestMeta): Promise<void> {
      const email = normalizeEmail(rawEmail);
      const now = clock.now();
      if (
        (await identityRepository.hit(bucketKey("otp-ip", meta.ip ?? "unknown"), now, 60)) >
        OTP.perIpPerHour
      ) {
        throw new AppError("RATE_LIMITED");
      }
      const existing = await identityRepository.findUserStatusByEmail(email);
      if (existing && existing.status !== "REJECTED") return; // nothing to sign up for (P1-SIGNUP-03, -10)

      const latest = await identityRepository.latestOtp(email);
      if (latest && latest.createdAt.getTime() > now.getTime() - OTP.resendAfterSeconds * 1000) {
        throw new AppError("RATE_LIMITED"); // P1-OTP-05
      }
      if (
        (await identityRepository.hit(bucketKey("otp-email", email), now, 60)) > OTP.perEmailPerHour
      ) {
        throw new AppError("RATE_LIMITED"); // P1-OTP-06
      }
      const otp = await identityRepository.transaction(async (tx) => {
        await identityRepository.voidOpenOtps(tx, email, now); // P1-OTP-04
        return identityRepository.createOtp(tx, {
          email,
          expiresAt: plusDuration(now, { minutes: OTP.validMinutes }),
          requestIp: meta.ip,
          now,
        });
      });
      await enqueueOtpMail(otp.id);
    },

    /** Step 2. A correct code returns a one-time ticket for step 3. */
    async verifyCode(rawEmail: string, code: string): Promise<{ ticket: string }> {
      const email = normalizeEmail(rawEmail);
      const now = clock.now();
      const otp = await identityRepository.latestOtp(email);
      if (!otp || otp.voidedAt || otp.consumedAt || !otp.codeHash)
        throw new AppError("OTP_EXPIRED");
      if (otp.expiresAt.getTime() <= now.getTime() || otp.attempts >= OTP.maxAttempts) {
        throw new AppError("OTP_EXPIRED"); // P1-OTP-01, -03
      }
      const given = keyedHash("otp", `${otp.id}:${code}`);
      if (!/^\d+$/.test(code) || code.length !== OTP.digits || !sameHash(given, otp.codeHash)) {
        const attempts = await identityRepository.countOtpAttempt(otp.id);
        throw new AppError(attempts >= OTP.maxAttempts ? "OTP_EXPIRED" : "OTP_INVALID");
      }
      const ticket = randomBytes(32).toString("base64url");
      const consumed = await identityRepository.consumeOtp(otp.id, {
        now,
        ticketHash: keyedHash("ticket", ticket),
        ticketExpiresAt: plusDuration(now, { minutes: OTP.ticketMinutes }),
      });
      if (!consumed) throw new AppError("OTP_EXPIRED"); // used at the same moment elsewhere (P1-OTP-02)
      return { ticket };
    },

    /** Step 3. Creates the account as PENDING_APPROVAL (P1-SIGNUP-05). */
    async complete(
      input: { ticket: string; displayName: string; password: string },
      meta: RequestMeta,
    ): Promise<void> {
      const now = clock.now();
      const ticketHash = keyedHash("ticket", input.ticket);
      const otp = await identityRepository.findOtpByTicket(ticketHash);
      if (!otp || !otp.ticketExpiresAt || otp.ticketExpiresAt.getTime() <= now.getTime()) {
        throw new AppError("OTP_EXPIRED"); // P1-SIGNUP-06, -07: no ticket, no account
      }
      assertPasswordAllowed(input.password, otp.email);
      const passwordHash = await hashPassword(input.password);
      await identityRepository.transaction(async (tx) => {
        if (!(await identityRepository.useTicket(tx, otp.id, ticketHash)))
          throw new AppError("OTP_EXPIRED");
        const existing = await identityRepository.findUserStatusByEmail(otp.email, tx);
        let userId: string;
        if (existing?.status === "REJECTED") {
          // A rejected person may ask again; admins see that they were rejected before (P1-SIGNUP-09).
          const changed = await identityRepository.updateUserIfStatus(tx, existing.id, "REJECTED", {
            status: "PENDING_APPROVAL",
            displayName: input.displayName,
            passwordHash,
            rejectedBefore: true,
            roleId: null,
          });
          if (changed === 0) throw new AppError("CONFLICT");
          userId = existing.id;
        } else if (existing) {
          throw new AppError("CONFLICT");
        } else {
          userId = (
            await identityRepository.createUser(tx, {
              email: otp.email,
              displayName: input.displayName,
              passwordHash,
              status: "PENDING_APPROVAL",
              roleId: null,
              mustChangePassword: false,
              signupSource: "SELF",
            })
          ).id;
        }
        await recordAudit(tx, {
          action: "user.signup_requested",
          targetType: "user",
          targetId: userId,
          actorId: userId,
          ip: meta.ip,
        });
      });
    },
  };
}

/** The identity.sendOtp job's work: make the code, email it, keep only its hash. Idempotent. */
export async function sendOtpMail(
  otpId: string,
  mailer: Mailer,
  clock: Clock = systemClock,
): Promise<"sent" | "skipped"> {
  const otp = await identityRepository.findOtp(otpId);
  if (!otp || otp.codeHash || otp.voidedAt || otp.consumedAt) return "skipped";
  if (otp.expiresAt.getTime() <= clock.now().getTime()) return "skipped";
  const code = String(randomInt(0, 10 ** OTP.digits)).padStart(OTP.digits, "0");
  // The hash is claimed before the mail goes out, so running the job twice never sends twice.
  if (!(await identityRepository.setOtpCode(otp.id, keyedHash("otp", `${otp.id}:${code}`))))
    return "skipped";
  const codeHash = keyedHash("otp", `${otp.id}:${code}`);
  try {
    await mailer.send({
      to: otp.email,
      subject: `Your ${APP_CONFIG.product.name} sign-up code`,
      text: `Your code is ${code}. It works for ${OTP.validMinutes} minutes. If you didn't ask for it, ignore this email.`,
    });
  } catch (error) {
    // Unclaim, so the retry makes and sends a fresh code (P1-OTP-09).
    await identityRepository.clearOtpCode(otp.id, codeHash);
    throw error;
  }
  return "sent";
}

export type SignupService = ReturnType<typeof createSignupService>;
