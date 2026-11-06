// W-303: the live editing token, the internal routes the Rust service uses (Decision 58), and
// "Live editing" versions with their contributors (P3-SNAP-01..03, app side).
import { jwtVerify } from "jose";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as contentRoute } from "@/app/api/internal/collab/workbooks/[id]/content/route";
import { POST as opsRoute } from "@/app/api/internal/collab/workbooks/[id]/ops/route";
import { POST as snapshotRoute } from "@/app/api/internal/collab/workbooks/[id]/snapshots/route";
import { GET as stateRoute } from "@/app/api/internal/collab/workbooks/[id]/state/route";
import { POST as tokenRoute } from "@/app/api/workbooks/[id]/collab-token/route";
import { GET as versionsRoute } from "@/app/api/workbooks/[id]/versions/route";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { minimalXlsx } from "@/shared/validator";
import { call, callRaw, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, type TestUser } from "@/tests/setup/users";
import { resetTestStorage } from "@/tests/setup/testStorage";
import { saveAs, shareWith } from "@/tests/setup/workbookCalls";
import { createWorkbookAs, type TestWorkbook } from "@/tests/setup/workbooks";

let owner: TestUser;
let asha: TestUser;
let oc: string;
let ac: string;
let wb: TestWorkbook;
const internal = () => ({ "x-internal-token": getEnv().INTERNAL_SERVICE_TOKEN });

beforeEach(async () => {
  await resetWithRoles();
  resetTestStorage();
  installRealResolvers();
  owner = await createTestUser({ displayName: "Owner" });
  asha = await createTestUser({ displayName: "Asha" });
  [oc, ac] = await Promise.all([signIn(owner.email), signIn(asha.email)]);
  wb = await createWorkbookAs(oc, "Live");
}, 30_000);
afterAll(() => getPrisma().$disconnect());

const step = (cell: string) => ({
  sheet: 0,
  sheetName: "Sheet1",
  selection: {},
  id: "cell.set",
  params: { cell, input: "1" },
});

describe("the live editing token (Decision 10)", () => {
  it("carries the role, the name and the address; strangers get 404", async () => {
    await shareWith(oc, wb.id, asha.id, "COMMENTER");
    const issued = await call<{ data: { token: string; url: string } }>(tokenRoute, {
      method: "POST",
      cookie: ac,
      params: { id: wb.id },
      ip: "10.0.0.5",
    });
    expect(issued.status).toBe(200);
    expect(issued.body!.data.url).toMatch(new RegExp(`/collab/${wb.id}$`));
    const { payload } = await jwtVerify(
      issued.body!.data.token,
      new TextEncoder().encode(getEnv().COLLAB_TOKEN_SECRET),
    );
    expect(payload).toMatchObject({
      sub: asha.id,
      wb: wb.id,
      role: "COMMENTER",
      own: false,
      name: "Asha",
      ip: "10.0.0.5",
    });
    const ownerToken = await call<{ data: { token: string } }>(tokenRoute, {
      method: "POST",
      cookie: oc,
      params: { id: wb.id },
    });
    const ownerClaims = (
      await jwtVerify(
        ownerToken.body!.data.token,
        new TextEncoder().encode(getEnv().COLLAB_TOKEN_SECRET),
      )
    ).payload;
    expect(ownerClaims).toMatchObject({ role: "EDITOR", own: true });
    const stranger = await createTestUser();
    const sc = await signIn(stranger.email);
    expect(
      (await call(tokenRoute, { method: "POST", cookie: sc, params: { id: wb.id } })).status,
    ).toBe(404);
  });
});

describe("internal routes for the Rust service (Decision 58)", () => {
  it("need the service token", async () => {
    expect((await call(stateRoute, { params: { id: wb.id } })).status).toBe(401);
    expect((await call(stateRoute, { cookie: oc, params: { id: wb.id } })).status).toBe(401);
  });

  it("store changes in order, once each, and replay the ones built on the current version", async () => {
    const base = wb.currentVersionId;
    const ops = [1, 2].map((seq) => ({
      seq,
      userId: owner.id,
      clientCommandId: `p-${seq}`,
      commandId: "cell.set",
      step: step(`A${seq}`),
    }));
    const first = await call<{ data: { stored: number } }>(opsRoute, {
      method: "POST",
      headers: internal(),
      params: { id: wb.id },
      body: { baseVersionId: base, ops },
    });
    expect(first.body!.data.stored).toBe(2);
    // A retry stores nothing new (P3-ORDER-03).
    const again = await call<{ data: { stored: number } }>(opsRoute, {
      method: "POST",
      headers: internal(),
      params: { id: wb.id },
      body: { baseVersionId: base, ops },
    });
    expect(again.body!.data.stored).toBe(0);
    const state = await call<{
      data: { versionId: string; ops: Array<{ seq: number }>; lastSeq: number };
    }>(stateRoute, {
      headers: internal(),
      params: { id: wb.id },
    });
    expect(state.body!.data).toMatchObject({ versionId: base, lastSeq: 2 });
    expect(state.body!.data.ops.map((o) => o.seq)).toEqual([1, 2]);
    const content = await callRaw(contentRoute, { headers: internal(), params: { id: wb.id } });
    expect(content.headers.get("etag")).toBe(`"${base}"`);
    // A normal save starts a new base: nothing is replayed on it.
    await saveAs(oc, wb.id, { A1: "saved" });
    const after = await call<{ data: { ops: unknown[]; lastSeq: number } }>(stateRoute, {
      headers: internal(),
      params: { id: wb.id },
    });
    expect(after.body!.data).toMatchObject({ ops: [], lastSeq: 2 });
  });

  it("save a snapshot as a 'Live editing' version with its contributors, on top of its base only", async () => {
    const upload = (base: string) =>
      callRaw(snapshotRoute, {
        method: "POST",
        params: { id: wb.id },
        headers: {
          ...internal(),
          "x-base-version": base,
          "x-contributors": `${owner.id},${asha.id}`,
        },
        body: new Uint8Array(minimalXlsx({ A1: "live" })),
      });
    const saved = await upload(wb.currentVersionId);
    expect(saved.status).toBe(201);
    const history = await call<{
      data: {
        items: Array<{
          source: string;
          createdBy: unknown;
          contributors: Array<{ displayName: string }>;
        }>;
      };
    }>(versionsRoute, { cookie: oc, params: { id: wb.id } });
    expect(history.body!.data.items[0]).toMatchObject({ source: "LIVE_SNAPSHOT", createdBy: null });
    expect(history.body!.data.items[0]!.contributors.map((c) => c.displayName)).toEqual([
      "Owner",
      "Asha",
    ]);
    // On a base that is no longer current (someone restored meanwhile): refused, nothing written.
    const stale = await upload(wb.currentVersionId);
    expect(stale.status).toBe(409);
    expect(await getPrisma().workbookVersion.count({ where: { workbookId: wb.id } })).toBe(2);
  });
});
