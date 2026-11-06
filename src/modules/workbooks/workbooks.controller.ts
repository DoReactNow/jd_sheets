// HTTP side of the workbooks module. Imported only by src/app (architecture rule 2).
import { Readable } from "node:stream";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { AppError } from "@/shared/errors/AppError";
import { parseInput } from "@/shared/errors/toErrorResponse";
import { attachmentDisposition, readBodyLimited } from "@/shared/http/body";
import type { HandlerResult, RawResult, RouteContext } from "@/shared/http/route";
import {
  createWorkbookInput,
  ifMatchSchema,
  leaseInput,
  listWorkbooksInput,
  releaseLeaseInput,
  tabIdSchema,
  type LeaseInput,
  type CreateWorkbookInput,
  type ListWorkbooksInput,
} from "./workbooks.schemas";
import { getEnv } from "@/shared/config/env";
import { clientIp } from "@/shared/http/clientIp";
import * as allSchemas from "./workbooks.schemas";
import {
  historyService,
  leaseService,
  lifecycleService,
  workbooksService,
} from "./workbooks.instance";
import type { LeaseState } from "./workbooks.lease";
import type {
  AdminWorkbookDto,
  SavedVersionDto,
  VersionPageDto,
  WorkbookDto,
  WorkbookPageDto,
} from "./workbooks.types";

/** Input schemas the routes declare (routes import only the controller, rule 2). */
export const workbookSchemas = {
  create: createWorkbookInput,
  list: listWorkbooksInput,
  lease: leaseInput,
  releaseLease: releaseLeaseInput,
  rename: allSchemas.renameInput,
  versionName: allSchemas.versionNameInput,
  versionList: allSchemas.versionListInput,
  adminList: allSchemas.adminListInput,
  adminOpen: allSchemas.adminOpenInput,
  adminContent: allSchemas.adminContentInput,
};

/** The header an import sends its original file name in, URL-encoded. */
export const IMPORT_FILE_NAME_HEADER = "x-file-name";

function meta(request: Request) {
  const ip = clientIp(request.headers, getEnv().TRUSTED_PROXY_HOPS);
  return { ip: ip === "unknown" ? null : ip };
}

function fileResponse(
  body: Readable,
  sizeBytes: number,
  name: string,
  etag?: string,
): { response: Response } {
  const headers: Record<string, string> = {
    "content-type": APP_CONFIG.workbooks.mediaType,
    "content-length": String(sizeBytes),
    "content-disposition": attachmentDisposition(name),
    "cache-control": "no-store",
  };
  if (etag) headers.etag = `"${etag}"`;
  return {
    response: new Response(Readable.toWeb(body) as ReadableStream, { status: 200, headers }),
  };
}

const xlsxName = (title: string) => `${title}.${APP_CONFIG.workbooks.extension}`;

/** The header an editor page sends with each save: its lease id (Decision 52). */
export const EDITOR_TAB_HEADER = "x-editor-tab";

type Ctx<I = undefined> = RouteContext<I, { id: string }>;

function principalOf<I, P>(context: RouteContext<I, P>) {
  if (!context.principal) throw new AppError("UNAUTHENTICATED");
  return context.principal;
}

export const workbooksController = {
  /** GET /api/workbooks */
  async list(
    context: RouteContext<ListWorkbooksInput, Record<string, string>>,
  ): Promise<HandlerResult<WorkbookPageDto>> {
    return { data: await workbooksService().list(principalOf(context), context.input) };
  },

  /** POST /api/workbooks */
  async create(
    context: RouteContext<CreateWorkbookInput, Record<string, string>>,
  ): Promise<HandlerResult<WorkbookDto>> {
    return {
      status: 201,
      data: await workbooksService().create(principalOf(context), context.input),
    };
  },

  /** GET /api/workbooks/:id (with the download setting, for the editor page) */
  async get(
    context: Ctx,
  ): Promise<HandlerResult<WorkbookDto & { allowDownloadForReaders: boolean }>> {
    const [workbook, settings] = await Promise.all([
      workbooksService().get(context.params.id, context.workbookRole!),
      lifecycleService().downloadSettings(context.params.id),
    ]);
    return { data: { ...workbook, allowDownloadForReaders: settings.allowDownloadForReaders } };
  },

  /** PATCH /api/workbooks/:id: rename (edit) */
  async rename(context: Ctx<{ title: string }>): Promise<HandlerResult<{ ok: true }>> {
    await historyService().rename(
      principalOf(context),
      context.params.id,
      context.input.title,
      meta(context.request),
    );
    return { data: { ok: true } };
  },

  /** GET /api/workbooks/:id/download (read; readers only when allowed) */
  async download(context: Ctx): Promise<RawResult> {
    await lifecycleService().assertMayDownload(context.params.id, context.workbookRole!);
    const file = await workbooksService().openContent(context.params.id);
    return fileResponse(file.body, file.sizeBytes, xlsxName(file.title), file.versionId);
  },

  /** POST /api/workbooks/import (workbooks:create): body = the file, name in x-file-name */
  async importFile(
    context: RouteContext<undefined, Record<string, string>>,
  ): Promise<HandlerResult<WorkbookDto>> {
    const fileName = parseInput(
      allSchemas.importFileNameSchema,
      context.request.headers.get(IMPORT_FILE_NAME_HEADER) ?? undefined,
    );
    const bytes = await readBodyLimited(
      context.request,
      APP_CONFIG.workbooks.maxBytes,
      "WORKBOOK_TOO_LARGE",
    );
    const converted = await lifecycleService().convertImport(fileName, bytes);
    const title = allSchemas.titleSchema.safeParse(converted.title);
    return {
      status: 201,
      data: await workbooksService().createFromBytes(
        principalOf(context),
        title.success ? title.data : APP_CONFIG.workbooks.defaultTitle,
        converted.bytes,
      ),
    };
  },

  /** GET /api/workbooks/:id/versions (history) */
  async versions(context: Ctx<{ cursor?: string }>): Promise<HandlerResult<VersionPageDto>> {
    return { data: await historyService().list(context.params.id, context.input.cursor) };
  },

  /** PATCH /api/workbooks/:id/versions/:versionId: name it (edit) */
  async nameVersion(
    context: RouteContext<{ name: string | null }, { id: string; versionId: string }>,
  ): Promise<HandlerResult<{ ok: true }>> {
    await historyService().name(context.params.id, context.params.versionId, context.input.name);
    return { data: { ok: true } };
  },

  /** GET /api/workbooks/:id/versions/:versionId/content (history) */
  async versionContent(
    context: RouteContext<undefined, { id: string; versionId: string }>,
  ): Promise<RawResult> {
    const file = await historyService().openVersion(context.params.id, context.params.versionId);
    return fileResponse(
      file.body,
      file.sizeBytes,
      xlsxName(`${file.title} (version ${file.number})`),
    );
  },

  /** POST /api/workbooks/:id/versions/:versionId/restore (edit) */
  async restoreVersion(
    context: RouteContext<undefined, { id: string; versionId: string }>,
  ): Promise<HandlerResult<SavedVersionDto>> {
    return {
      data: await historyService().restore(
        principalOf(context),
        context.params.id,
        context.params.versionId,
        meta(context.request),
      ),
    };
  },

  /** POST /api/workbooks/:id/trash (own) */
  async trash(context: Ctx): Promise<HandlerResult<{ ok: true }>> {
    await lifecycleService().trash(principalOf(context), context.params.id, meta(context.request));
    return { data: { ok: true } };
  },

  /** POST /api/workbooks/:id/untrash (own) */
  async untrash(context: Ctx): Promise<HandlerResult<{ ok: true }>> {
    await lifecycleService().untrash(
      principalOf(context),
      context.params.id,
      meta(context.request),
    );
    return { data: { ok: true } };
  },

  /** DELETE /api/workbooks/:id (own; only from the Trash) */
  async deleteForever(context: Ctx): Promise<HandlerResult<{ ok: true }>> {
    await lifecycleService().deleteForever(
      principalOf(context),
      context.params.id,
      meta(context.request),
    );
    return { data: { ok: true } };
  },

  /** GET /api/admin/workbooks (workbooks:administer) */
  async adminList(
    context: RouteContext<
      { q?: string; ownerStatus?: "ACTIVE" | "DEACTIVATED" },
      Record<string, string>
    >,
  ): Promise<HandlerResult<{ workbooks: AdminWorkbookDto[] }>> {
    return { data: { workbooks: await lifecycleService().adminList(context.input) } };
  },

  /** POST /api/admin/workbooks/:id/open (workbooks:administer): audited every time */
  async adminOpen(context: Ctx<{ reason: string }>) {
    return {
      data: await lifecycleService().adminOpen(
        principalOf(context),
        context.params.id,
        context.input.reason,
        meta(context.request),
      ),
    };
  },

  /** GET /api/admin/workbooks/:id/content?grant= (workbooks:administer) */
  async adminContent(context: Ctx<{ grant: string }>): Promise<RawResult> {
    const file = await lifecycleService().adminContent(
      principalOf(context),
      context.params.id,
      context.input.grant,
    );
    return fileResponse(file.body, file.sizeBytes, xlsxName(file.title), file.versionId);
  },

  /** GET /api/workbooks/:id/content: the current version's bytes, with its version as ETag. */
  async content(context: Ctx): Promise<RawResult> {
    const file = await workbooksService().openContent(context.params.id);
    await workbooksService().recordOpen(principalOf(context), context.params.id);
    const name = `${file.title}.${APP_CONFIG.workbooks.extension}`;
    return {
      response: new Response(Readable.toWeb(file.body) as ReadableStream, {
        status: 200,
        headers: {
          "content-type": APP_CONFIG.workbooks.mediaType,
          "content-length": String(file.sizeBytes),
          etag: `"${file.versionId}"`,
          "content-disposition": attachmentDisposition(name),
          "cache-control": "no-store",
        },
      }),
    };
  },

  /** PUT /api/workbooks/:id/content with If-Match: the base version. Body: the workbook bytes. */
  async save(context: Ctx): Promise<HandlerResult<SavedVersionDto>> {
    const principal = principalOf(context);
    const base = parseInput(ifMatchSchema, context.request.headers.get("if-match") ?? undefined);
    const bytes = await readBodyLimited(
      context.request,
      APP_CONFIG.workbooks.maxBytes,
      "WORKBOOK_TOO_LARGE",
    );
    const autosave = new URL(context.request.url).searchParams.get("autosave") === "1";
    const tab = context.request.headers.get(EDITOR_TAB_HEADER);
    const saved = await workbooksService().save(
      principal,
      context.workbookRole!,
      context.params.id,
      base,
      bytes,
      autosave ? "AUTOSAVE" : "SAVE",
      tab === null ? null : parseInput(tabIdSchema, tab),
    );
    return { data: saved, headers: { etag: `"${saved.versionId}"` } };
  },

  /** POST /api/workbooks/:id/lease: take, renew or move the edit lease (P2-LEASE-*). */
  async lease(context: Ctx<LeaseInput>): Promise<HandlerResult<LeaseState>> {
    return {
      data: await leaseService().acquire(
        principalOf(context),
        context.workbookRole!,
        context.params.id,
        context.input.tabId,
        context.input.takeOver,
      ),
    };
  },

  /** POST /api/workbooks/:id/lease/release: the page is closing (P2-LEASE-04). */
  async releaseLease(context: Ctx<{ tabId: string }>): Promise<HandlerResult<{ ok: true }>> {
    await leaseService().release(principalOf(context), context.params.id, context.input.tabId);
    return { data: { ok: true } };
  },
};
