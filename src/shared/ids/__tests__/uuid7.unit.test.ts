import { describe, expect, it } from "vitest";
import { createTestClock } from "@/shared/time";
import { uuid7 } from "../uuid7";

describe("uuid7", () => {
  it("is a version 7 UUID", () => {
    expect(uuid7(createTestClock("2027-01-01T00:00:00Z"))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("sorts by time and is unique", () => {
    const clock = createTestClock("2027-01-01T00:00:00Z");
    const first = uuid7(clock);
    clock.advance({ milliseconds: 1 });
    const second = uuid7(clock);
    expect(first < second).toBe(true);
    const many = new Set(Array.from({ length: 1000 }, () => uuid7(clock)));
    expect(many.size).toBe(1000);
  });
});
