// A workbook's life outside editing: import (P2-IMPORT-*), download (P2-EXPORT-*, P2-ROLE-06),
// Trash and deleting for good (P2-TRASH-*, P2-ROLE-09), the nightly purge and version pruning
// (P2-VER-06, -07, P2-TRASH-03), and the administrator's metadata list and audited, view-only
// open (P2-ADMINWB-01, -03, -05). Roles are checked by the routes.
import type { Readable } from "node:stream";
import { findAuditEvent, recordAudit } from "@/modules/audit";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { AppError } from "@/shared/errors/AppError";
import type { Logger } from "@/shared/logger";
import type { Principal } from "@/shared/rbac/principal";
import type { WorkbookRole } from "@/shared/rbac/workbookAccess";
import type { FileStorage } from "@/shared/storage";
import { plusDuration, toBusinessDate, toIsoInstant, type Clock } from "@/shared/time";
import type { WorkbookValidator } from "@/shared/validator";
import type { WorkbooksRepository } from "./workbooks.repository";
import type { AdminWorkbookDto } from "./workbooks.types";

export interface LifecycleDeps {
  repository: WorkbooksRepository;
  storage: FileStorage;
  validator: WorkbookValidator;
  clock: Clock;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

export interface Meta {
  ip: string | null;
}

/** How long an administrator's audited open lets them read the content. */
const ADMIN_OPEN_MINUTES = 15;

/** "Budget 2026.xlsx" → { title: "Budget 2026", extension: "xlsx" } (P2-IMPORT-04). */
export function splitFileName(fileName: string): { title: string; extension: string } {
  // Browsers send the bare name; an old one may send "C:\\fakepath\\name".
  const base = fileName.split("\\").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return { title: base, extension: "" };
  return { title: base.slice(0, dot), extension: base.slice(dot + 1).toLowerCase() };
}

export function createLifecycleService(deps: LifecycleDeps) {
  const { repository, storage, validator, clock, logger } = deps;

  async function deleteFiles(keys: string[]) {
    for (const key of keys) {
      try {
        await storage.delete(key);
      } catch (error) {
        // The weekly orphan cleanup removes it later; the rows are already gone.
        logger.warn("could not delete a workbook file", { key, err: error });
      }
    }
  }

  return {
    /** Converts an imported file to .xlsx bytes (P2-IMPORT-01..03). */
    async convertImport(
      fileName: string,
      bytes: Uint8Array,
    ): Promise<{ title: string; bytes: Uint8Array }> {
      const { title, extension } = splitFileName(fileName);
      if (!(APP_CONFIG.workbooks.importExtensions as readonly string[]).includes(extension)) {
        throw new AppError("FILE_TYPE_NOT_SUPPORTED");
      }
      if (bytes.byteLength > APP_CONFIG.workbooks.maxBytes)
        throw new AppError("WORKBOOK_TOO_LARGE");
      const xlsx = await validator.convert(bytes, extension);
      await validator.validate(xlsx);
      return { title, bytes: xlsx };
    },

    /** Readers download only when the Owner allows it (P2-ROLE-06). */
    async assertMayDownload(workbookId: string, role: WorkbookRole): Promise<void> {
      if (role === "OWNER" || role === "EDITOR") return;
      const settings = await repository.findSettings(workbookId);
      if (!settings) throw new AppError("NOT_FOUND");
      if (!settings.allowDownloadForReaders) throw new AppError("DOWNLOAD_DISABLED");
    },

    async downloadSettings(workbookId: string) {
      const settings = await repository.findSettings(workbookId);
      if (!settings) throw new AppError("NOT_FOUND");
      return settings;
    },

    /** Moves to Trash; it disappears for everyone else at once (P2-TRASH-01). */
    async trash(principal: Principal, workbookId: string, meta: Meta): Promise<void> {
      const row = await repository.findById(workbookId);
      if (!row) throw new AppError("NOT_FOUND");
      if (row.trashedAt) return;
      await repository.transaction(async (tx) => {
        await repository.setTrashed(tx, workbookId, { at: clock.now(), by: principal.userId });
        await recordAudit(tx, {
          action: "workbook.trashed",
          targetType: "workbook",
          targetId: workbookId,
          actorId: principal.userId,
          ip: meta.ip,
        });
      });
    },

    /** Restores from Trash with its shares as they were (P2-TRASH-02). */
    async untrash(principal: Principal, workbookId: string, meta: Meta): Promise<void> {
      const row = await repository.findById(workbookId);
      if (!row?.trashedAt) throw new AppError("NOT_FOUND");
      await repository.transaction(async (tx) => {
        await repository.setTrashed(tx, workbookId, null);
        await recordAudit(tx, {
          action: "workbook.restoredFromTrash",
          targetType: "workbook",
          targetId: workbookId,
          actorId: principal.userId,
          ip: meta.ip,
        });
      });
    },

    /** Deletes a trashed workbook for good: rows first, then its files. */
    async deleteForever(
      principal: Principal | null,
      workbookId: string,
      meta: Meta,
    ): Promise<void> {
      const row = await repository.findById(workbookId);
      if (!row?.trashedAt) throw new AppError("NOT_FOUND");
      const keys = await repository.transaction(async (tx) => {
        const storageKeys = await repository.storageKeysOf(workbookId, tx);
        if (!(await repository.deleteWorkbook(tx, workbookId))) return [];
        await recordAudit(tx, {
          action: "workbook.deleted",
          targetType: "workbook",
          targetId: workbookId,
          actorId: principal?.userId ?? null,
          ip: meta.ip,
          details: { title: row.title, versions: storageKeys.length },
        });
        return storageKeys;
      });
      await deleteFiles(keys);
    },

    /** Nightly: deletes workbooks trashed more than 30 days ago (P2-TRASH-03). Idempotent. */
    async purgeTrash(): Promise<number> {
      const cutoff = plusDuration(clock.now(), { days: -APP_CONFIG.workbooks.trashDays });
      let purged = 0;
      for (;;) {
        const due = await repository.trashedBefore(cutoff, 50);
        if (due.length === 0) break;
        for (const { id } of due) {
          await this.deleteForever(null, id, { ip: null }).catch((error: unknown) => {
            if (!(error instanceof AppError && error.code === "NOT_FOUND")) throw error;
          });
          purged++;
        }
      }
      return purged;
    },

    /**
     * Nightly: keeps every version for 30 days, then the newest of each Kolkata day up to a year,
     * then the newest of each month; never a named or the current version (P2-VER-06). Rows and
     * files go together; running it twice deletes nothing more (P2-VER-07).
     */
    async pruneVersions(): Promise<number> {
      const now = clock.now();
      const keepAllAfter = plusDuration(now, { days: -APP_CONFIG.workbooks.keepAllVersionsDays });
      const dailyAfter = plusDuration(now, { days: -APP_CONFIG.workbooks.keepDailyVersionsDays });
      let removed = 0;
      let after: string | null = null;
      for (;;) {
        const ids = await repository.workbooksWithVersionsBefore(keepAllAfter, after, 100);
        if (ids.length === 0) break;
        after = ids.at(-1)!;
        for (const workbookId of ids) {
          const found = await repository.versionsForPruning(workbookId);
          if (!found) continue;
          const seen = new Set<string>();
          const drop: Array<{ id: string; storageKey: string }> = [];
          // Newest first, so the first version of each day or month is the one kept.
          for (const v of found.versions) {
            if (v.createdAt >= keepAllAfter || v.name !== null || v.id === found.currentVersionId) {
              continue;
            }
            const day = toBusinessDate(v.createdAt);
            const bucket = v.createdAt >= dailyAfter ? `d:${day}` : `m:${day.slice(0, 7)}`;
            if (seen.has(bucket)) drop.push(v);
            else seen.add(bucket);
          }
          if (drop.length === 0) continue;
          const deleted = await repository.deleteVersions(
            workbookId,
            drop.map((v) => v.id),
          );
          // Files only for rows that are really gone (X-JOB-05).
          const remaining = await repository.referencedKeys(drop.map((v) => v.storageKey));
          await deleteFiles(drop.map((v) => v.storageKey).filter((k) => !remaining.has(k)));
          removed += deleted;
        }
      }
      if (removed > 0) logger.info("old versions pruned", { removed });
      return removed;
    },

    /** Every workbook's title, owner, size and last change, never content (P2-ADMINWB-01, -05). */
    async adminList(filter: {
      q?: string;
      ownerStatus?: "ACTIVE" | "DEACTIVATED";
    }): Promise<AdminWorkbookDto[]> {
      const rows = await repository.adminList({ ...filter, limit: 500 });
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        sizeBytes: Number(row.sizeBytes),
        updatedAt: toIsoInstant(row.updatedAt),
        trashedAt: row.trashedAt ? toIsoInstant(row.trashedAt) : null,
        owner: row.owner
          ? {
              id: row.owner.id,
              displayName: row.owner.displayName,
              email: row.owner.email,
              active: row.owner.status === "ACTIVE",
            }
          : null,
      }));
    },

    /**
     * "Open as administrator": a reason, an audit event every time, and a short window to read
     * the content in view mode (P2-ADMINWB-03). The event's id is the permission.
     */
    async adminOpen(principal: Principal, workbookId: string, reason: string, meta: Meta) {
      const row = await repository.findById(workbookId);
      if (!row?.currentVersion) throw new AppError("NOT_FOUND");
      const grant = await repository.transaction((tx) =>
        recordAudit(tx, {
          action: "workbook.adminOpened",
          targetType: "workbook",
          targetId: workbookId,
          actorId: principal.userId,
          ip: meta.ip,
          details: { reason },
        }),
      );
      return { grant, title: row.title };
    },

    async adminContent(
      principal: Principal,
      workbookId: string,
      grant: string,
    ): Promise<{ body: Readable; sizeBytes: number; versionId: string; title: string }> {
      const event = /^[0-9a-f-]{36}$/.test(grant) ? await findAuditEvent(grant) : null;
      const fresh =
        event && event.createdAt >= plusDuration(clock.now(), { minutes: -ADMIN_OPEN_MINUTES });
      if (
        !event ||
        !fresh ||
        event.action !== "workbook.adminOpened" ||
        event.actorId !== principal.userId ||
        event.targetId !== workbookId
      ) {
        throw new AppError("FORBIDDEN", { logContext: { workbookId, grant } });
      }
      const row = await repository.findById(workbookId);
      if (!row?.currentVersion) throw new AppError("NOT_FOUND");
      const file = await storage.get(row.currentVersion.storageKey);
      if (!file) throw new AppError("INTERNAL");
      return {
        body: file.body,
        sizeBytes: file.sizeBytes,
        versionId: row.currentVersion.id,
        title: row.title,
      };
    },
  };
}

export type LifecycleService = ReturnType<typeof createLifecycleService>;
