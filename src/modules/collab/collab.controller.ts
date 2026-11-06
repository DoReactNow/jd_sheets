// HTTP side of the collab module. Imported only by src/app (architecture rule 2).
import { Readable } from "node:stream";
import type { z } from "zod";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors/AppError";
import { parseInput } from "@/shared/errors/toErrorResponse";
import { readBodyLimited } from "@/shared/http/body";
import { clientIp } from "@/shared/http/clientIp";
import type { RawResult, RouteContext } from "@/shared/http/route";
import { appendOpsInput, heartbeatInput, snapshotHeaders } from "./collab.schemas";
import { collabService } from "./collab.service";

export const collabSchemas = { appendOps: appendOpsInput, heartbeat: heartbeatInput };

type Ctx<I = undefined> = RouteContext<I, { id: string }>;

export const collabController = {
  /** POST /api/workbooks/:id/collab-token (read): a token for the live connection. */
  async token(context: Ctx) {
    if (!context.principal) throw new AppError("UNAUTHENTICATED");
    const ip = clientIp(context.request.headers, getEnv().TRUSTED_PROXY_HOPS);
    return {
      data: await collabService.issueToken(
        context.principal,
        context.workbookRole!,
        context.params.id,
        ip,
      ),
    };
  },

  /** GET /api/internal/collab/workbooks/:id/state (internal) */
  async state(context: Ctx) {
    return { data: await collabService.state(context.params.id) };
  },

  /** GET /api/internal/collab/workbooks/:id/content (internal): the current version's bytes. */
  async content(context: Ctx): Promise<RawResult> {
    const file = await collabService.content(context.params.id);
    return {
      response: new Response(Readable.toWeb(file.body) as ReadableStream, {
        status: 200,
        headers: {
          "content-type": APP_CONFIG.workbooks.mediaType,
          "content-length": String(file.sizeBytes),
          etag: `"${file.versionId}"`,
          "cache-control": "no-store",
        },
      }),
    };
  },

  /** POST /api/internal/collab/workbooks/:id/ops (internal): accepted changes, stored in order. */
  async appendOps(context: Ctx<z.output<typeof appendOpsInput>>) {
    const stored = await collabService.appendOps(
      context.params.id,
      context.input.baseVersionId,
      context.input.ops,
    );
    return { data: { stored } };
  },

  /** POST /api/internal/collab/workbooks/:id/heartbeat (internal): `{editing}` every 30 s. */
  async heartbeat(context: Ctx<z.output<typeof heartbeatInput>>) {
    await collabService.heartbeat(context.params.id, context.input.editing);
    return { data: { ok: true } };
  },

  /** POST /api/internal/collab/workbooks/:id/snapshots (internal): body = xlsx bytes. */
  async snapshot(context: Ctx) {
    const headers = parseInput(snapshotHeaders, {
      baseVersionId: context.request.headers.get("x-base-version") ?? undefined,
      contributors: context.request.headers.get("x-contributors") ?? "",
    });
    const bytes = await readBodyLimited(
      context.request,
      APP_CONFIG.workbooks.maxBytes,
      "WORKBOOK_TOO_LARGE",
    );
    return {
      status: 201,
      data: await collabService.snapshot(
        context.params.id,
        headers.baseVersionId,
        bytes,
        headers.contributors,
      ),
    };
  },
};
