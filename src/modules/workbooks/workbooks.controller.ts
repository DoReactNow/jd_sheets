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
  listWorkbooksInput,
  type CreateWorkbookInput,
  type ListWorkbooksInput,
} from "./workbooks.schemas";
import { workbooksService } from "./workbooks.instance";
import type { SavedVersionDto, WorkbookDto, WorkbookPageDto } from "./workbooks.types";

/** Input schemas the routes declare (routes import only the controller, rule 2). */
export const workbookSchemas = { create: createWorkbookInput, list: listWorkbooksInput };

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

  /** GET /api/workbooks/:id */
  async get(context: Ctx): Promise<HandlerResult<WorkbookDto>> {
    return { data: await workbooksService().get(context.params.id, context.workbookRole!) };
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
    const saved = await workbooksService().save(
      principal,
      context.params.id,
      base,
      bytes,
      autosave ? "AUTOSAVE" : "SAVE",
    );
    return { data: saved, headers: { etag: `"${saved.versionId}"` } };
  },
};
