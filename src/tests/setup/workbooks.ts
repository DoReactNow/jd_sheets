// Workbook helpers for integration tests that go through the real routes with a session cookie.
import { POST as createRoute } from "@/app/api/workbooks/route";
import { call } from "./session";

export interface TestWorkbook {
  id: string;
  title: string;
  currentVersionId: string;
  role: string;
}

export async function createWorkbookAs(cookie: string, title = "Book"): Promise<TestWorkbook> {
  const result = await call<{ data: TestWorkbook }>(createRoute, {
    method: "POST",
    cookie,
    body: { title },
  });
  if (result.status !== 201) throw new Error(`create failed: ${result.status}`);
  return result.body!.data;
}
