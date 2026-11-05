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
import type { CreateWorkbookInput } from "./workbooks.schemas";
import {
  StaleBaseVersionError,
  type WorkbookRow,
  type WorkbooksRepository,
} from "./workbooks.repository";
import type { SavedVersionDto, WorkbookDto } from "./workbooks.types";

export interface WorkbooksServiceDeps {
  repository: WorkbooksRepository;
  storage: FileStorage;
  validator: WorkbookValidator;
  clock: Clock;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

export type SaveSource = "SAVE" | "AUTOSAVE";

function toDto(row: WorkbookRow, role: WorkbookRole): WorkbookDto {
  if (!row.currentVersion) throw new AppError("NOT_FOUND");
  return {
    id: row.id,
    title: row.title,
    sizeBytes: Number(row.sizeBytes),
    currentVersionId: row.currentVersion.id,
    currentVersionNumber: row.currentVersion.number,
    createdAt: toIsoInstant(row.createdAt),
    updatedAt: toIsoInstant(row.updatedAt),
    role,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function createWorkbooksService(deps: WorkbooksServiceDeps) {
  const { repository, storage, validator, clock, logger } = deps;

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
      return createWith(principal, input.title ?? APP_CONFIG.workbooks.defaultTitle, blank, "CREATE");
    },

    /** A new workbook from an existing .xlsx (validated first). Used by seeds; Phase 2 import. */
    async createFromBytes(principal: Principal, title: string, bytes: Uint8Array): Promise<WorkbookDto> {
      if (bytes.byteLength > APP_CONFIG.workbooks.maxBytes) throw new AppError("WORKBOOK_TOO_LARGE");
      await validator.validate(bytes);
      return createWith(principal, title, bytes, "IMPORT");
    },

    /** The caller's workbooks, newest change first (X-ACCESS-06). Phase 2 adds shared ones. */
    async list(principal: Principal): Promise<WorkbookDto[]> {
      const rows = await repository.listOwnedBy(principal.userId);
      return rows.map((row) => toDto(row, "OWNER"));
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
      workbookId: string,
      baseVersionId: string,
      bytes: Uint8Array,
      source: SaveSource,
    ): Promise<SavedVersionDto> {
      if (bytes.byteLength > APP_CONFIG.workbooks.maxBytes) throw new AppError("WORKBOOK_TOO_LARGE");
      const current = await repository.findById(workbookId);
      if (!current?.currentVersion) throw new AppError("NOT_FOUND");
      // Cheap early answer; the transaction below is what really decides.
      if (current.currentVersion.id !== baseVersionId) throw new AppError("WORKBOOK_CHANGED");

      await validator.validate(bytes);
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
