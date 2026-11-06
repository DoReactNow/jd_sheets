// P1-DOMAIN-01..06, X-INPUT-10: only @jdfusion.in, strictly.
import { describe, expect, it } from "vitest";
import { emailSchema, isAllowedEmail, normalizeEmail } from "../identity.email";

describe("email domain rule", () => {
  it("accepts the company domain in any case, trimmed (P1-DOMAIN-01, X-INPUT-10)", () => {
    expect(emailSchema.parse("  Asha.Rao@JDFusion.IN ")).toBe("asha.rao@jdfusion.in");
    expect(isAllowedEmail(normalizeEmail("rahul+sheets@jdfusion.in"))).toBe(true);
  });

  it.each([
    ["another domain (P1-DOMAIN-02)", "asha@gmail.com"],
    ["a subdomain (P1-DOMAIN-03)", "asha@sub.jdfusion.in"],
    ["a longer look-alike (P1-DOMAIN-04)", "asha@jdfusion.in.evil.com"],
    ["a hyphen look-alike (P1-DOMAIN-04)", "asha@jdfusion-in.com"],
    ["several @ (P1-DOMAIN-05)", "asha@jdfusion.in@evil.com"],
    ["a Cyrillic look-alike letter (P1-DOMAIN-06)", "asha@jdfusіon.in"],
    ["a quoted local part", '"asha"@jdfusion.in'],
    ["spaces inside", "as ha@jdfusion.in"],
    ["nothing before @", "@jdfusion.in"],
    ["a leading dot", ".asha@jdfusion.in"],
    ["two dots", "as..ha@jdfusion.in"],
    ["empty", "   "],
  ])("refuses %s", (_label, email) => {
    const result = emailSchema.safeParse(email);
    expect(result.success).toBe(false);
  });

  it("names the allowed domain in its message", () => {
    const result = emailSchema.safeParse("asha@gmail.com");
    expect(result.success ? "" : result.error.issues[0].message).toContain("@jdfusion.in");
  });
});
