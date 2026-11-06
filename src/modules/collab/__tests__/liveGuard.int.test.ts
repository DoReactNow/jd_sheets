// P3-FALLBACK-02: live editing and the one-editor lease never both allow editing; P3-RECOV-03:
// old live changes are pruned.
import { jwtVerify } from "jose";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as heartbeatRoute } from "@/app/api/internal/collab/workbooks/[id]/heartbeat/route";
import { POST as opsRoute } from "@/app/api/internal/collab/workbooks/[id]/ops/route";
import { POST as tokenRoute } from "@/app/api/workbooks/[id]/collab-token/route";
import { POST as leaseRoute } from "@/app/api/workbooks/[id]/lease/route";
import { getEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/db/prisma";
import { createTestClock, plusDuration, systemClock } from "@/shared/time";
import { call, installRealResolvers, signIn } from "@/tests/setup/session";
import { createTestUser, resetWithRoles, type TestUser } from "@/tests/setup/users";
import { resetTestStorage } from "@/tests/setup/testStorage";
import { saveAs, shareWith } from "@/tests/setup/workbookCalls";
import { createWorkbookAs, type TestWorkbook } from "@/tests/setup/workbooks";
import { createCollabService } from "../collab.service";

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
  wb = await createWorkbookAs(oc, "Guarded");
  await shareWith(oc, wb.id, asha.id, "EDITOR");
}, 30_000);
afterAll(() => getPrisma().$disconnect());

const roleIn = async (token: string) =>
  (await jwtVerify(token, new TextEncoder().encode(getEnv().COLLAB_TOKEN_SECRET))).payload.role;

describe("live editing and the lease (P3-FALLBACK-02)", () => {
  it("while people edit live, nobody can take the one-editor lease", async () => {
    const beat = await call(heartbeatRoute, {
      method: "POST",
      headers: internal(),
      params: { id: wb.id },
      body: { editing: true },
    });
    expect(beat.status).toBe(200);
    const lease = await call<{ data: { status: string; holderName: string } }>(leaseRoute, {
      method: "POST",
      cookie: ac,
      params: { id: wb.id },
      body: { tabId: "tab-asha-0001" },
    });
    expect(lease.body!.data).toEqual({ status: "OTHER", holderName: "People editing live" });
    // When live editing stops, the lease is available again.
    await call(heartbeatRoute, {
      method: "POST",
      headers: internal(),
      params: { id: wb.id },
      body: { editing: false },
    });
    const free = await call<{ data: { status: string } }>(leaseRoute, {
      method: "POST",
      cookie: ac,
      params: { id: wb.id },
      body: { tabId: "tab-asha-0001" },
    });
    expect(free.body!.data.status).toBe("HELD");
  });

  it("while someone holds the lease, live editing opens view-only", async () => {
    await call(leaseRoute, {
      method: "POST",
      cookie: oc,
      params: { id: wb.id },
      body: { tabId: "tab-owner-001" },
    });
    const token = await call<{ data: { token: string; heldBy: string | null } }>(tokenRoute, {
      method: "POST",
      cookie: ac,
      params: { id: wb.id },
    });
    expect(token.body!.data.heldBy).toBe("Owner");
    expect(await roleIn(token.body!.data.token)).toBe("VIEWER");
  });

  it("needs the service token", async () => {
    expect(
      (
        await call(heartbeatRoute, {
          method: "POST",
          params: { id: wb.id },
          body: { editing: true },
        })
      ).status,
    ).toBe(401);
  });
});

describe("pruning old live changes (P3-RECOV-03)", () => {
  it("removes changes not built on the current version after 7 days, and keeps the rest", async () => {
    const oldBase = wb.currentVersionId;
    const op = (seq: number) => ({
      seq,
      userId: owner.id,
      clientCommandId: `c-${seq}`,
      commandId: "cell.set",
      step: { id: "cell.set" },
    });
    await call(opsRoute, {
      method: "POST",
      headers: internal(),
      params: { id: wb.id },
      body: { baseVersionId: oldBase, ops: [op(1)] },
    });
    await saveAs(oc, wb.id, { A1: "new base" });
    const current = (await getPrisma().workbook.findUniqueOrThrow({ where: { id: wb.id } }))
      .currentVersionId!;
    await call(opsRoute, {
      method: "POST",
      headers: internal(),
      params: { id: wb.id },
      body: { baseVersionId: current, ops: [op(2)] },
    });
    const soon = createCollabService({
      clock: createTestClock(plusDuration(systemClock.now(), { days: 6 })),
    });
    expect(await soon.prune()).toBe(0);
    const later = createCollabService({
      clock: createTestClock(plusDuration(systemClock.now(), { days: 8 })),
    });
    expect(await later.prune()).toBe(1);
    expect((await getPrisma().collabOp.findMany()).map((o) => Number(o.seq))).toEqual([2]);
  });
});
