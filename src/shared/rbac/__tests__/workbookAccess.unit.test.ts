// project_data.md Section 5.5: exactly what each workbook role may do.
import { describe, expect, it } from "vitest";
import { highestRole, roleAllows, WORKBOOK_CAPABILITIES, type WorkbookRole } from "../workbookAccess";

const EXPECTED: Record<WorkbookRole, string[]> = {
  OWNER: ["read", "comment", "edit", "history", "share", "own"],
  EDITOR: ["read", "comment", "edit", "history"],
  COMMENTER: ["read", "comment", "history"],
  VIEWER: ["read"],
};

describe("workbook role matrix", () => {
  it.each(Object.entries(EXPECTED))("%s may do exactly %j", (role, allowed) => {
    for (const capability of WORKBOOK_CAPABILITIES) {
      expect(roleAllows(role as WorkbookRole, capability), capability).toBe(
        allowed.includes(capability),
      );
    }
  });

  it("picks the highest role", () => {
    expect(highestRole(["VIEWER", "EDITOR", null, "COMMENTER"])).toBe("EDITOR");
    expect(highestRole(["VIEWER", "OWNER"])).toBe("OWNER");
    expect(highestRole([null, undefined])).toBeNull();
  });
});
