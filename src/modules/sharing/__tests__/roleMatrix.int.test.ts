// P2-ROLE-01: each role can do exactly what project_data.md 5.5 allows, on every workbook route,
// called directly. A role without the capability gets 403; a stranger gets 404 (X-ACCESS-05).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as content from "@/app/api/workbooks/[id]/content/route";
import * as download from "@/app/api/workbooks/[id]/download/route";
import * as lease from "@/app/api/workbooks/[id]/lease/route";
import * as release from "@/app/api/workbooks/[id]/lease/release/route";
import * as link from "@/app/api/workbooks/[id]/link/route";
import * as workbook from "@/app/api/workbooks/[id]/route";
import * as settings from "@/app/api/workbooks/[id]/settings/route";
import * as grant from "@/app/api/workbooks/[id]/shares/[grantId]/route";
import * as shares from "@/app/api/workbooks/[id]/shares/route";
import * as trash from "@/app/api/workbooks/[id]/trash/route";
import * as untrash from "@/app/api/workbooks/[id]/untrash/route";
import * as versionContent from "@/app/api/workbooks/[id]/versions/[versionId]/content/route";
import * as restore from "@/app/api/workbooks/[id]/versions/[versionId]/restore/route";
import * as version from "@/app/api/workbooks/[id]/versions/[versionId]/route";
import * as versions from "@/app/api/workbooks/[id]/versions/route";
import { getPrisma } from "@/shared/db/prisma";
import {
  roleAllows,
  type WorkbookCapability,
  type WorkbookRole,
} from "@/shared/rbac/workbookAccess";
import { callRaw, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles } from "@/tests/setup/users";
import { resetTestStorage } from "@/tests/setup/testStorage";
import { shareWith } from "@/tests/setup/workbookCalls";
import { createWorkbookAs } from "@/tests/setup/workbooks";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;
interface Case {
  name: string;
  handler: Handler;
  method: string;
  capability: WorkbookCapability;
  body?: unknown;
  extra?: Record<string, string>;
}

const json = (value: unknown) => JSON.stringify(value);
const h = (fn: unknown) => fn as Handler;
const CASES: Case[] = [
  { name: "read workbook", handler: h(workbook.GET), method: "GET", capability: "read" },
  { name: "read content", handler: h(content.GET), method: "GET", capability: "read" },
  { name: "download", handler: h(download.GET), method: "GET", capability: "read" },
  {
    name: "lease",
    handler: h(lease.POST),
    method: "POST",
    capability: "read",
    body: { tabId: "tab-matrix-01" },
  },
  {
    name: "release",
    handler: h(release.POST),
    method: "POST",
    capability: "read",
    body: { tabId: "tab-matrix-01" },
  },
  { name: "save (comment and up)", handler: h(content.PUT), method: "PUT", capability: "comment" },
  { name: "history", handler: h(versions.GET), method: "GET", capability: "history" },
  { name: "old version", handler: h(versionContent.GET), method: "GET", capability: "history" },
  {
    name: "name version",
    handler: h(version.PATCH),
    method: "PATCH",
    capability: "edit",
    body: { name: "x" },
  },
  { name: "restore", handler: h(restore.POST), method: "POST", capability: "edit" },
  {
    name: "rename",
    handler: h(workbook.PATCH),
    method: "PATCH",
    capability: "edit",
    body: { title: "Renamed" },
  },
  { name: "list shares", handler: h(shares.GET), method: "GET", capability: "share" },
  {
    name: "share",
    handler: h(shares.PUT),
    method: "PUT",
    capability: "share",
    body: { target: { type: "user", id: "0190f5e0-0000-7000-8000-000000000000" }, role: "VIEWER" },
  },
  {
    name: "change grant",
    handler: h(grant.PATCH),
    method: "PATCH",
    capability: "share",
    body: { role: "VIEWER" },
  },
  { name: "remove grant", handler: h(grant.DELETE), method: "DELETE", capability: "share" },
  {
    name: "company link",
    handler: h(link.PUT),
    method: "PUT",
    capability: "share",
    body: { role: null },
  },
  {
    name: "download setting",
    handler: h(settings.PUT),
    method: "PUT",
    capability: "share",
    body: { allowDownloadForReaders: true },
  },
  { name: "trash", handler: h(trash.POST), method: "POST", capability: "own" },
  { name: "untrash", handler: h(untrash.POST), method: "POST", capability: "own" },
  { name: "delete", handler: h(workbook.DELETE), method: "DELETE", capability: "own" },
];

let cookies: Record<WorkbookRole | "STRANGER", string>;
let ids: { id: string; versionId: string; grantId: string };

beforeAll(async () => {
  await resetWithRoles();
  resetTestStorage();
  installRealResolvers();
  const people = await Promise.all(
    ["OWNER", "EDITOR", "COMMENTER", "VIEWER", "STRANGER"].map((name) =>
      createTestUser({ displayName: name }),
    ),
  );
  const signedIn = await Promise.all(people.map((p) => signIn(p.email)));
  cookies = Object.fromEntries(
    ["OWNER", "EDITOR", "COMMENTER", "VIEWER", "STRANGER"].map((k, i) => [k, signedIn[i]!]),
  ) as typeof cookies;
  const wb = await createWorkbookAs(cookies.OWNER, "Matrix");
  for (const [i, role] of (["EDITOR", "COMMENTER", "VIEWER"] as const).entries()) {
    await shareWith(cookies.OWNER, wb.id, people[i + 1]!.id, role);
  }
  // The grant routes act on a spare person's grant, so removing it changes nobody's role here.
  const spare = await createTestUser({ displayName: "Spare" });
  await shareWith(cookies.OWNER, wb.id, spare.id, "VIEWER");
  const g = await getPrisma().shareGrant.findFirstOrThrow({
    where: { workbookId: wb.id, userId: spare.id },
  });
  ids = { id: wb.id, versionId: wb.currentVersionId, grantId: g.id };
}, 60_000);
afterAll(() => getPrisma().$disconnect());

describe("every workbook route checks the workbook role (P2-ROLE-01)", () => {
  // Owner last for the routes that change the workbook's existence.
  const roles: Array<WorkbookRole | "STRANGER"> = [
    "STRANGER",
    "VIEWER",
    "COMMENTER",
    "EDITOR",
    "OWNER",
  ];
  for (const c of CASES) {
    it(c.name, async () => {
      for (const role of roles) {
        if (c.capability === "own" && role === "OWNER") continue; // the owner's own routes are tested elsewhere
        const response = await callRaw(c.handler as never, {
          method: c.method,
          cookie: cookies[role],
          params: { id: ids.id, versionId: ids.versionId, grantId: ids.grantId } as never,
          headers: c.body ? { "content-type": "application/json" } : {},
          body: c.body ? json(c.body) : undefined,
        });
        const expected =
          role === "STRANGER" ? 404 : roleAllows(role, c.capability) ? "allowed" : 403;
        if (expected === "allowed") {
          expect([403, 404], `${role} ${c.name}: ${response.status}`).not.toContain(
            response.status,
          );
        } else {
          expect(response.status, `${role} ${c.name}`).toBe(expected);
        }
      }
    });
  }
});
