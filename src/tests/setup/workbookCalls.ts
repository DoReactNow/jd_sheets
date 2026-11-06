// Shared calls for Phase 2 workbook integration tests: save with the lease, share, read.
import { POST as leaseRoute } from "@/app/api/workbooks/[id]/lease/route";
import { PUT as saveRoute } from "@/app/api/workbooks/[id]/content/route";
import { PUT as shareRoute } from "@/app/api/workbooks/[id]/shares/route";
import { getPrisma } from "@/shared/db/prisma";
import { minimalXlsx } from "@/shared/validator";
import { call, callRaw } from "./session";

/** Takes the lease for `tab` and saves `cells` on top of the current version. */
export async function saveAs(
  cookie: string,
  workbookId: string,
  cells: Record<string, string>,
  tab = "tab-test-0001",
) {
  await call(leaseRoute, {
    method: "POST",
    cookie,
    params: { id: workbookId },
    body: { tabId: tab },
  });
  const current = await getPrisma().workbook.findUniqueOrThrow({ where: { id: workbookId } });
  const response = await callRaw(saveRoute, {
    method: "PUT",
    cookie,
    params: { id: workbookId },
    headers: { "if-match": `"${current.currentVersionId}"`, "x-editor-tab": tab },
    body: new Uint8Array(minimalXlsx(cells)),
  });
  return {
    status: response.status,
    body: (await response.json()) as { data: { versionId: string; number: number } },
  };
}

export function shareWith(cookie: string, workbookId: string, userId: string, role: string) {
  return call(shareRoute, {
    method: "PUT",
    cookie,
    params: { id: workbookId },
    body: { target: { type: "user", id: userId }, role },
  });
}

export async function bodyText(response: Response): Promise<string> {
  return Buffer.from(await response.arrayBuffer()).toString("utf8");
}
