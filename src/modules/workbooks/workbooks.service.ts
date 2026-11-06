// Workbook rules (Decisions 17, 19, 20): create from GridCraft's blank workbook, list, read the
// current version, and save new versions safely. No HTTP types here.
import type { Readable } from "node:stream";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { AppError } from "@/shared/errors/AppError";
import { uuid7 } from "@/shared/ids/uuid7";
import type { Logger } from "@/shared/logger";
import type { Principal } from "@/shared/rbac/principal";
import type { WorkbookRole } from "@/shared/rbac/workbookAccess";
import { workbookVersionKey, WORKBOOKS_PREFIX, type FileStorage } from "@/shared/storage";
import { toIsoInstant, type Clock } from "@/shared/time";
import type { WorkbookValidator } from "@/shared/validator";
import { resolveWorkbookRole, roleAllows } from "@/shared/rbac/workbookAccess";
import type { CreateWorkbookInput, ListWorkbooksInput } from "./workbooks.schemas";
import type { LeaseService } from "./workbooks.lease";
import {
  StaleBaseVersionError,
  type WorkbookRow,
  type WorkbooksRepository,
} from "./workbooks.repository";
import type { SavedVersionDto, WorkbookDto, WorkbookPageDto } from "./workbooks.types";

export interface WorkbooksServiceDeps {
  repository: WorkbooksRepository;
  lease: LeaseService;
  storage: FileStorage;
  validator: WorkbookValidator;
  clock: Clock;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

export type SaveSource = "SAVE" | "AUTOSAVE";

function encodeCursor(value: string, id: string): string {
  return Buffer.from(JSON.stringify([value, id])).toString("base64url");
}

function decodeCursor(cursor: string): { value: string; id: string } {
  try {
    const [value, id] = JSON.parse(Buffer.from(cursor, "base64url").toString()) as unknown[];
    if (typeof value === "string" && typeof id === "string" && /^[0-9a-f-]{36}$/.test(id)) {
      return { value, id };
    }
  } catch {
    // fall through
  }
  throw new AppError("VALIDATION_FAILED", {
    fieldErrors: [{ field: "cursor", message: "Please reload the list." }],
  });
}

function sortValue(row: WorkbookRow, sort: "updated" | "title"): string {
  return sort === "title"
    ? row.title.toLowerCase()
    : row.updatedAt.toISOString().replace("Z", "000").slice(0, 26);
}

function toDto(row: WorkbookRow, role: WorkbookRole): WorkbookDto {
  if (!row.currentVersion) throw new AppError("NOT_FOUND");
  return {
    id: row.id,
    title: row.title,
    owner: row.owner,
    trashedAt: row.trashedAt ? toIsoInstant(row.trashedAt) : null,
    sizeBytes: Number(row.sizeBytes),
    currentVersionId: row.currentVersion.id,
    currentVersionNumber: row.currentVersion.number,
    createdAt: toIsoInstant(row.createdAt),
    updatedAt: toIsoInstant(row.updatedAt),
    role,
  };
}

async function readAll(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return new Uint8Array(Buffer.concat(chunks));
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function createWorkbooksService(deps: WorkbooksServiceDeps) {
  const { repository, lease, storage, validator, clock, logger } = deps;

  async function storeVersionFile(workbookId: string, bytes: Uint8Array) {
    const versionId = uuid7(clock);
    const storageKey = workbookVersionKey(workbookId, versionId, APP_CONFIG.workbooks.extension);
    const stored = await storage.put(storageKey, bytes, APP_CONFIG.workbooks.mediaType);
    return { versionId, storageKey, stored };
  }

  async function createWith(
    principal: Principal,
    title: string,
    bytes: Uint8Array,
    source: "CREATE" | "IMPORT",
  ): Promise<WorkbookDto> {
    const workbookId = uuid7(clock);
    const { versionId, storageKey, stored } = await storeVersionFile(workbookId, bytes);
    const row = await repository.createWithFirstVersion({
      id: workbookId,
      title,
      ownerId: principal.userId,
      version: {
        id: versionId,
        storageKey,
        sizeBytes: stored.sizeBytes,
        sha256: stored.checksumSha256,
        source,
        createdById: principal.userId,
      },
    });
    logger.info("workbook created", { workbookId, versionId, source });
    return toDto(row, "OWNER");
  }

  return {
    /** A new workbook from GridCraft's blank workbook; the caller owns it. */
    async create(principal: Principal, input: CreateWorkbookInput): Promise<WorkbookDto> {
      const blank = await validator.blank();
      return createWith(
        principal,
        input.title ?? APP_CONFIG.workbooks.defaultTitle,
        blank,
        "CREATE",
      );
    },

    /** A new workbook from an existing .xlsx (validated first). Used by seeds; Phase 2 import. */
    async createFromBytes(
      principal: Principal,
      title: string,
      bytes: Uint8Array,
    ): Promise<WorkbookDto> {
      if (bytes.byteLength > APP_CONFIG.workbooks.maxBytes)
        throw new AppError("WORKBOOK_TOO_LARGE");
      await validator.validate(bytes);
      return createWith(principal, title, bytes, "IMPORT");
    },

    /**
     * A page of one list: mine, shared with me, all readable, Recent or Trash, with title search,
     * sort and keyset paging (P2-LIST-01..03, P2-SHARE-09). Each row carries the caller's role.
     */
    async list(principal: Principal, input: ListWorkbooksInput): Promise<WorkbookPageDto> {
      const withRoles = async (rows: WorkbookRow[]) => {
        const roles = await Promise.all(rows.map((row) => resolveWorkbookRole(principal, row.id)));
        return rows.flatMap((row, i) => (roles[i] ? [toDto(row, roles[i])] : []));
      };
      if (input.scope === "recent") {
        const recent = await repository.listRecent(
          principal.userId,
          APP_CONFIG.workbooks.recentShown,
          input.q,
        );
        const items = await withRoles(recent.map((r) => r.row));
        const opened = new Map(recent.map((r) => [r.row.id, toIsoInstant(r.openedAt)]));
        return {
          items: items.map((item) => ({ ...item, openedAt: opened.get(item.id) })),
          nextCursor: null,
        };
      }
      const dir = input.dir ?? (input.sort === "title" ? "asc" : "desc");
      const rows = await repository.listPage({
        userId: principal.userId,
        scope: input.scope,
        q: input.q || undefined,
        sort: input.sort,
        dir,
        after: input.cursor ? decodeCursor(input.cursor) : undefined,
        limit: input.limit + 1,
      });
      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      return {
        items: await withRoles(page),
        nextCursor:
          rows.length > input.limit && last
            ? encodeCursor(sortValue(last, input.sort), last.id)
            : null,
      };
    },

    /** Notes an open for Recent (P2-LIST-03). */
    async recordOpen(principal: Principal, workbookId: string): Promise<void> {
      await repository.recordOpen(
        principal.userId,
        workbookId,
        clock.now(),
        APP_CONFIG.workbooks.recentKept,
      );
    },

    async get(workbookId: string, role: WorkbookRole): Promise<WorkbookDto> {
      const row = await repository.findById(workbookId);
      if (!row) throw new AppError("NOT_FOUND");
      return toDto(row, role);
    },

    /** The current version's bytes as a stream, with what the response needs. */
    async openContent(
      workbookId: string,
    ): Promise<{ body: Readable; sizeBytes: number; versionId: string; title: string }> {
      const row = await repository.findById(workbookId);
      if (!row?.currentVersion) throw new AppError("NOT_FOUND");
      const file = await storage.get(row.currentVersion.storageKey);
      if (!file) {
        logger.error("workbook file missing from storage", {
          workbookId,
          versionId: row.currentVersion.id,
        });
        throw new AppError("INTERNAL");
      }
      return {
        body: file.body,
        sizeBytes: file.sizeBytes,
        versionId: row.currentVersion.id,
        title: row.title,
      };
    },

    /**
     * Saves bytes as a new version on top of `baseVersionId` (Decision 20). The file is validated
     * and stored first; then the version row and pointer move together, only if the base is
     * still current. Otherwise WORKBOOK_CHANGED and no version exists (the file is an orphan,
     * removed later by workbooks.purgeOrphanFiles).
     */
    async save(
      principal: Principal,
      role: WorkbookRole,
      workbookId: string,
      baseVersionId: string,
      bytes: Uint8Array,
      source: SaveSource,
      tabId: string | null,
    ): Promise<SavedVersionDto> {
      // The server is the lock: a Viewer never saves (P2-ROLE-02, P2-MODE-03).
      if (!roleAllows(role, "comment")) throw new AppError("FORBIDDEN");
      if (bytes.byteLength > APP_CONFIG.workbooks.maxBytes)
        throw new AppError("WORKBOOK_TOO_LARGE");
      const current = await repository.findById(workbookId);
      if (!current?.currentVersion || current.trashedAt) throw new AppError("NOT_FOUND");
      // Cheap early answer; the transaction below is what really decides.
      if (current.currentVersion.id !== baseVersionId) throw new AppError("WORKBOOK_CHANGED");

      if (roleAllows(role, "edit")) {
        await lease.assertHolds(principal, workbookId, tabId);
        await validator.validate(bytes);
      } else {
        // A Commenter saves comments only, never while someone is editing (Decision 54).
        if (await lease.heldByOther(principal, workbookId)) throw new AppError("WORKBOOK_LOCKED");
        await validator.validate(bytes);
        const base = await storage.get(current.currentVersion.storageKey);
        if (!base) throw new AppError("INTERNAL");
        const kind = await validator.diffKind(
          await readAll(base.body),
          bytes,
          principal.displayName,
        );
        if (kind === "NONE") {
          return {
            versionId: current.currentVersion.id,
            number: current.currentVersion.number,
            sizeBytes: Number(current.currentVersion.sizeBytes),
            savedAt: toIsoInstant(current.updatedAt),
          };
        }
        if (kind !== "COMMENTS_ONLY") {
          throw new AppError("COMMENTS_ONLY", { logContext: { workbookId, kind } });
        }
      }
      const { versionId, storageKey, stored } = await storeVersionFile(workbookId, bytes);
      const now = clock.now();
      try {
        const { number } = await repository.addVersion(
          workbookId,
          baseVersionId,
          {
            id: versionId,
            storageKey,
            sizeBytes: stored.sizeBytes,
            sha256: stored.checksumSha256,
            source,
            createdById: principal.userId,
          },
          now,
        );
        return { versionId, number, sizeBytes: stored.sizeBytes, savedAt: toIsoInstant(now) };
      } catch (error) {
        if (error instanceof StaleBaseVersionError || isUniqueViolation(error)) {
          throw new AppError("WORKBOOK_CHANGED", { logContext: { workbookId, baseVersionId } });
        }
        throw error;
      }
    },

    /**
     * Deletes stored files that no version row refers to and that are older than the grace period
     * (failed or refused saves). Never deletes a referenced file (X-JOB-05). Returns how many.
     */
    async purgeOrphanFiles(): Promise<number> {
      const cutoff = clock.now().getTime() - APP_CONFIG.workbooks.orphanFileGraceHours * 3_600_000;
      let deleted = 0;
      let batch: string[] = [];
      const flush = async () => {
        const referenced = await repository.referencedKeys(batch);
        for (const key of batch) {
          if (!referenced.has(key)) {
            await storage.delete(key);
            deleted++;
          }
        }
        batch = [];
      };
      for await (const file of storage.list(WORKBOOKS_PREFIX)) {
        if (file.modifiedAt.getTime() > cutoff) continue;
        batch.push(file.key);
        if (batch.length >= 200) await flush();
      }
      await flush();
      if (deleted > 0) logger.info("orphan workbook files deleted", { deleted });
      return deleted;
    },

    /** Phase 0 role resolver: the owner has OWNER; nobody else has a role (Phase 2 adds sharing). */
    async roleOf(principal: Principal, workbookId: string): Promise<WorkbookRole | null> {
      const owner = await repository.ownerOf(workbookId);
      return owner !== undefined && owner === principal.userId ? "OWNER" : null;
    },
  };
}

export type WorkbooksService = ReturnType<typeof createWorkbooksService>;
