// Password hashing (argon2id) and the one password rule used by sign-up, admin-created accounts,
// resets, password changes and the seed (Decision 14). Hashes and passwords are never logged.
import { randomBytes, randomInt } from "node:crypto";
import { type Algorithm, hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { AppError } from "@/shared/errors/AppError";

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

// OWASP's minimum for argon2id: 19 MiB, 2 iterations, 1 thread.
const ARGON2_OPTIONS = {
  // The package types this as a const enum, which isolatedModules cannot read.
  algorithm: 2 as Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export const PASSWORD_RULE_MESSAGE = `Use ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`;

/** Null when the password is acceptable, otherwise the friendly reason (P1-PWD-02, P1-PWD-03). */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.trim().length === 0) return "Enter a password.";
  const length = [...password].length;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) return PASSWORD_RULE_MESSAGE;
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return "Your password can't be your email address.";
  }
  return null;
}

export function assertPasswordAllowed(password: string, email?: string, field = "password"): void {
  const problem = passwordProblem(password, email);
  if (problem)
    throw new AppError("VALIDATION_FAILED", { fieldErrors: [{ field, message: problem }] });
}

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password.normalize("NFC"), ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * `stored` is null when there is no account: a dummy hash is still checked, so the time taken
 * does not reveal which accounts exist. A malformed stored hash is a failed check.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if ([...password].length > MAX_PASSWORD_LENGTH * 4) return false;
  const target =
    stored ?? (await (dummyHash ??= argonHash(randomBytes(24).toString("hex"), ARGON2_OPTIONS)));
  try {
    const ok = await argonVerify(target, password.normalize("NFC"), ARGON2_OPTIONS);
    return stored !== null && ok;
  } catch {
    return false;
  }
}

/** A temporary password an admin hands over: 16 characters, easy to read aloud. */
export function generateTemporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]).join("");
}
