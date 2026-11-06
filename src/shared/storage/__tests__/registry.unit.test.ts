import { describe, expect, it } from "vitest";
import { createFileStorage } from "../registry";

describe("storage driver registry", () => {
  it("returns the driver named by STORAGE_DRIVER", () => {
    expect(
      createFileStorage({ STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: "./storage/test" }).driver,
    ).toBe("local");
  });

  it("fails clearly for s3 (not built yet), an unknown driver or a missing local folder", () => {
    expect(() => createFileStorage({ STORAGE_DRIVER: "s3" })).toThrow(/not available yet/);
    expect(() => createFileStorage({ STORAGE_DRIVER: "floppy" as never })).toThrow(
      /Unknown STORAGE_DRIVER "floppy"/,
    );
    expect(() => createFileStorage({ STORAGE_DRIVER: "local" })).toThrow(/STORAGE_LOCAL_DIR/);
  });
});
