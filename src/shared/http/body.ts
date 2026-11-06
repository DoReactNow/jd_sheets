// Reads a request body as bytes, refusing it as soon as it passes `maxBytes` (it is never read in
// full first), so a huge upload cannot exhaust memory (X-INPUT-09, P0-WB-12).
import { AppError } from "@/shared/errors/AppError";
import type { ErrorCode } from "@/shared/errors/errorCatalog";

export async function readBodyLimited(
  request: Request,
  maxBytes: number,
  tooLarge: ErrorCode = "REQUEST_TOO_LARGE",
): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new AppError(tooLarge);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AppError(tooLarge);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** A Content-Disposition header that keeps any title safe (P2-EXPORT-03 starts here). */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\/]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
