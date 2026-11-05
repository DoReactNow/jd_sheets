// The "collab" validator: asks the Rust service to open the workbook with GridCraft's engine
// (Decision 11). Only the registry imports this file.
import { APP_CONFIG } from "@/shared/config/appConfig";
import { collabRequest } from "@/shared/collab/client";
import { AppError } from "@/shared/errors/AppError";
import { isErrorCode } from "@/shared/errors/errorCatalog";
import type { WorkbookSummary, WorkbookValidator } from "../workbookValidator";

async function failure(response: Response): Promise<AppError> {
  const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
  const code = body?.error?.code;
  if (code === "WORKBOOK_TOO_LARGE" || code === "WORKBOOK_UNREADABLE") return new AppError(code);
  if (response.status === 413) return new AppError("WORKBOOK_TOO_LARGE");
  return new AppError("SERVICE_UNAVAILABLE", {
    logContext: { service: "collab", status: response.status, code: isErrorCode(code) ? code : null },
  });
}

export function createCollabValidator(): WorkbookValidator {
  return {
    driver: "collab",
    async validate(bytes) {
      if (bytes.byteLength > APP_CONFIG.workbooks.maxBytes) throw new AppError("WORKBOOK_TOO_LARGE");
      const response = await collabRequest("/internal/workbooks/validate", {
        method: "POST",
        body: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        contentType: APP_CONFIG.workbooks.mediaType,
      });
      if (!response.ok) throw await failure(response);
      const body = (await response.json()) as { data: WorkbookSummary };
      return body.data;
    },
    async blank() {
      const response = await collabRequest("/internal/workbooks/blank", { method: "POST" });
      if (!response.ok) throw await failure(response);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
