// Version history (P2-VER-01..05, P2-ROLE-07, -08): the list, naming versions, reading an old
// version, restoring one as a new version (history is never rewritten), and renaming a workbook.
// Roles are checked by the routes; restore also waits while someone else holds the lease.
import type { Readable } from "node:stream";
import { recordAudit } from "@/modules/audit";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { notifyAccessChanged } from "@/shared/collab/client";
import { AppError } from "@/shared/errors/AppError";
import { uuid7 } from "@/shared/ids/uuid7";
import type { Principal } from "@/shared/rbac/principal";
import { workbookVersionKey, type FileStorage } from "@/shared/storage";
import { toIsoInstant, type Clock } from "@/shared/time";
import type { LeaseService } from "./workbooks.lease";
import type { Tx, WorkbooksRepository } from "./workbooks.repository";
import type { SavedVersionDto, VersionDto, VersionPageDto } from "./workbooks.types";

export interface HistoryDeps {
  repository: WorkbooksRepository;
  lease: LeaseService;
  storage: FileStorage;
  clock: Clock;
}

const PAGE = 50;

export function createHistoryService({ repository, lease, storage, clock }: HistoryDeps) {
  async function live(workbookId: string) {
    const row = await repository.findById(workbookId);
    if (!row?.currentVersion || row.trashedAt) throw new AppError("NOT_FOUND");
    return row;
  }

  return {
    async list(workbookId: string, cursor?: string): Promise<VersionPageDto> {
      const row = await live(workbookId);
      const before = cursor && /^\d+$/.test(cursor) ? Number(cursor) : undefined;
      const versions = await repository.listVersions(workbookId, before, PAGE + 1);
      const page = versions.slice(0, PAGE);
      const people = await repository.userNames([
        ...new Set(
          page
            .flatMap((v) => [v.createdById, ...v.contributorIds])
            .filter((id): id is string => id !== null),
        ),
      ]);
      const numbers = new Map(versions.map((v) => [v.id, v.number]));
      const items: VersionDto[] = page.map((v) => ({
        id: v.id,
        number: v.number,
        name: v.name,
        source: v.source,
        createdBy: v.createdById
          ? { id: v.createdById, displayName: people.get(v.createdById) ?? "" }
          : null,
        contributors: v.contributorIds.map((id) => ({ id, displayName: people.get(id) ?? "" })),
        createdAt: toIsoInstant(v.createdAt),
        sizeBytes: Number(v.sizeBytes),
        restoredFromNumber: v.restoredFromId ? (numbers.get(v.restoredFromId) ?? null) : null,
        current: v.id === row.currentVersion!.id,
      }));
      return {
        items,
        nextCursor: versions.length > PAGE ? String(page.at(-1)!.number) : null,
      };
    },

    /** Names a version (kept forever, P2-VER-02) or clears its name. */
    async name(workbookId: string, versionId: string, name: string | null): Promise<void> {
      await live(workbookId);
      const version = await repository.findVersion(workbookId, versionId);
      if (!version) throw new AppError("NOT_FOUND");
      await repository.nameVersion(versionId, name);
    },

    /** An old version's bytes, to open in view mode (P2-VER-03). */
    async openVersion(
      workbookId: string,
      versionId: string,
    ): Promise<{ body: Readable; sizeBytes: number; number: number; title: string }> {
      const row = await live(workbookId);
      const version = await repository.findVersion(workbookId, versionId);
      if (!version) throw new AppError("NOT_FOUND");
      const file = await storage.get(version.storageKey);
      if (!file) throw new AppError("INTERNAL", { logContext: { workbookId, versionId } });
      return {
        body: file.body,
        sizeBytes: file.sizeBytes,
        number: version.number,
        title: row.title,
      };
    },

    /**
     * Restores a version: a new version with the same bytes, on top of the current one; audited
     * (P2-VER-04). Refused while someone else is editing (P2-VER-05).
     */
    async restore(
      principal: Principal,
      workbookId: string,
      versionId: string,
      meta: { ip: string | null },
    ): Promise<SavedVersionDto> {
      const row = await live(workbookId);
      const version = await repository.findVersion(workbookId, versionId);
      if (!version) throw new AppError("NOT_FOUND");
      if (await lease.heldByOther(principal, workbookId)) throw new AppError("WORKBOOK_LOCKED");
      const file = await storage.get(version.storageKey);
      if (!file) throw new AppError("INTERNAL", { logContext: { workbookId, versionId } });
      const chunks: Buffer[] = [];
      for await (const chunk of file.body) chunks.push(Buffer.from(chunk as Uint8Array));
      const bytes = new Uint8Array(Buffer.concat(chunks));
      const newId = uuid7(clock);
      const storageKey = workbookVersionKey(workbookId, newId, APP_CONFIG.workbooks.extension);
      const stored = await storage.put(storageKey, bytes, APP_CONFIG.workbooks.mediaType);
      const now = clock.now();
      try {
        const { number } = await repository.addVersion(
          workbookId,
          row.currentVersion!.id,
          {
            id: newId,
            storageKey,
            sizeBytes: stored.sizeBytes,
            sha256: stored.checksumSha256,
            source: "RESTORE",
            createdById: principal.userId,
            restoredFromId: version.id,
          },
          now,
          (tx: Tx, newNumber: number) =>
            recordAudit(tx, {
              action: "workbook.versionRestored",
              targetType: "workbook",
              targetId: workbookId,
              actorId: principal.userId,
              ip: meta.ip,
              details: { fromVersion: version.number, newVersion: newNumber },
            }),
        );
        // Everyone editing live loads the restored version (P3-RESTORE-01).
        notifyAccessChanged({ workbookId, reload: true });
        return {
          versionId: newId,
          number,
          sizeBytes: stored.sizeBytes,
          savedAt: toIsoInstant(now),
        };
      } catch (error) {
        if (error instanceof Error && error.name === "StaleBaseVersionError") {
          throw new AppError("WORKBOOK_CHANGED");
        }
        throw error;
      }
    },

    /** Renames a workbook (Owner, Editor; P2-ROLE-08); audited. */
    async rename(
      principal: Principal,
      workbookId: string,
      title: string,
      meta: { ip: string | null },
    ): Promise<void> {
      const row = await live(workbookId);
      await repository.transaction(async (tx) => {
        await repository.rename(tx, workbookId, title);
        await recordAudit(tx, {
          action: "workbook.renamed",
          targetType: "workbook",
          targetId: workbookId,
          actorId: principal.userId,
          ip: meta.ip,
          details: { from: row.title, to: title },
        });
      });
    },
  };
}

export type HistoryService = ReturnType<typeof createHistoryService>;
