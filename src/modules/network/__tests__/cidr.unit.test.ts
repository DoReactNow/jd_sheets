// P1-NET-03, -04, -11: ranges at their edges, IPv6, mapped IPv4, malformed input.
import { describe, expect, it } from "vitest";
import { cidrContains, parseCidr } from "../network.cidr";

const range = (text: string) => parseCidr(text)!;

describe("CIDR ranges", () => {
  it("normalises ranges and single addresses", () => {
    expect(parseCidr("203.0.113.77/24")?.text).toBe("203.0.113.0/24");
    expect(parseCidr("203.0.113.7")?.text).toBe("203.0.113.7/32");
    expect(parseCidr("2001:DB8::1/32")?.text).toBe("2001:db8::/32");
    expect(parseCidr("0.0.0.0/0")?.text).toBe("0.0.0.0/0");
  });

  it("includes the first and last address and excludes the next (P1-NET-03)", () => {
    const r = range("203.0.113.0/24");
    expect(cidrContains(r, "203.0.113.0")).toBe(true);
    expect(cidrContains(r, "203.0.113.255")).toBe(true);
    expect(cidrContains(r, "203.0.114.0")).toBe(false);
    expect(cidrContains(r, "203.0.112.255")).toBe(false);
  });

  it("matches IPv6, and treats IPv4-mapped IPv6 as IPv4 (P1-NET-04)", () => {
    expect(cidrContains(range("2001:db8::/32"), "2001:db8:ffff::1")).toBe(true);
    expect(cidrContains(range("2001:db8::/32"), "2001:db9::1")).toBe(false);
    expect(cidrContains(range("203.0.113.0/24"), "::ffff:203.0.113.9")).toBe(true);
    expect(cidrContains(range("203.0.113.0/24"), "2001:db8::1")).toBe(false);
  });

  it.each([
    "10.0.0.0/33",
    "abc",
    "10.0.0/8",
    "1.2.3.4/x",
    "1.2.3.4/8/9",
    "",
    "2001:db8::/129",
    "999.1.1.1",
  ])("refuses %j (P1-NET-11)", (bad) => {
    expect(parseCidr(bad)).toBeNull();
  });
});
