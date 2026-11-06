// P1-PWD-01..03: argon2id and the one password rule.
import { describe, expect, it } from "vitest";
import {
  generateTemporaryPassword,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "../identity.passwords";

describe("password rule", () => {
  it("needs 12 to 128 characters (P1-PWD-02)", () => {
    expect(passwordProblem("a".repeat(11))).not.toBeNull();
    expect(passwordProblem("a".repeat(12))).toBeNull();
    expect(passwordProblem("a".repeat(128))).toBeNull();
    expect(passwordProblem("a".repeat(129))).not.toBeNull();
  });

  it("refuses only spaces and the email itself (P1-PWD-03)", () => {
    expect(passwordProblem(" ".repeat(20))).not.toBeNull();
    expect(passwordProblem("asha.rao@jdfusion.in", "asha.rao@jdfusion.in")).not.toBeNull();
    expect(passwordProblem("Asha.Rao@JDFUSION.in", "asha.rao@jdfusion.in")).not.toBeNull();
  });

  it("counts characters, not bytes, so Hindi and emoji passwords work", () => {
    expect(passwordProblem("मेराबहुतलंबापासवर्ड")).toBeNull();
  });

  it("makes temporary passwords that pass the rule", () => {
    const temporary = generateTemporaryPassword();
    expect(passwordProblem(temporary)).toBeNull();
    expect(temporary).not.toBe(generateTemporaryPassword());
  });
});

describe("hashing (P1-PWD-01)", () => {
  it("stores argon2id and verifies only the right password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong horse battery", hash)).toBe(false);
  }, 20_000);

  it("treats a missing account and a malformed hash as a failed check", async () => {
    expect(await verifyPassword("anything at all", null)).toBe(false);
    expect(await verifyPassword("anything at all", "not-a-hash")).toBe(false);
  }, 20_000);
});
