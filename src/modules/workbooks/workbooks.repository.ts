// Database access for the workbooks module. Writes only workbooks_* tables. No business rules.
import { getPrisma } from "@/shared/db/prisma";
import { Prisma, type WorkbookVersionSource } from "@/generated/prisma/client";

export interface WorkbookRow {
  id: string;
  title: string;
  ownerId: string | null;
  sizeBytes: bigint;
  createdAt: Date;
  updatedAt: Date;
  currentVersion: { id: string; number: number; storageKey: string; sizeBytes: bigint } | null;
}

export interface NewVersion {
  id: string;
  storageKey: string;
  sizeBytes: number;
  sha256: string;
  source: WorkbookVersionSource;
  createdById: string | null;
}

const workbookSelect = {
  id: true,
  title: true,
  ownerId: true,
  sizeBytes: true,
  createdAt: true,
  updatedAt: true,
  currentVersion: { select: { id: true, number: true, storageKey: true, sizeBytes: true } },
} as const;

/** Thrown inside the save transaction when the base version is no longer current. */
export class StaleBaseVersionError extends Error {
  constructor() {
    super("the workbook moved on since this save's base version");
    this.name = "StaleBaseVersionError";
  }
}

export const workbooksRepository = {
  async createWithFirstVersion(input: {
    id: string;
    title: string;
    ownerId: string;
    version: NewVersion;
  }): Promise<WorkbookRow> {
    return getPrisma().$transaction(async (tx) => {
      await tx.workbook.create({ data: { id: input.id, title: input.title, ownerId: input.ownerId } });
      await tx.workbookVersion.create({
        data: { ...input.version, workbookId: input.id, number: 1 },
      });
      return tx.workbook.update({
        where: { id: input.id },
        data: { currentVersionId: input.version.id, sizeBytes: input.version.sizeBytes },
        select: workbookSelect,
      });
    });
  },

  findById(id: string): Promise<WorkbookRow | null> {
    return getPrisma().workbook.findUnique({ where: { id }, select: workbookSelect });
  },

  /** The owner of a workbook, or undefined when it does not exist. */
  async ownerOf(id: string): Promise<string | null | undefined> {
    const row = await getPrisma().workbook.findUnique({ where: { id }, select: { ownerId: true } });
    return row === null ? undefined : row.ownerId;
  },

  listOwnedBy(ownerId: string): Promise<WorkbookRow[]> {
    return getPrisma().workbook.findMany({
      where: { ownerId, currentVersionId: { not: null } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: workbookSelect,
    });
  },

  /**
   * Adds a version on top of `baseVersionId`, in one transaction that locks the workbook row:
   * if the current version is not the base any more, nothing is written (StaleBaseVersionError).
   */
  async addVersion(
    workbookId: string,
    baseVersionId: string,
    version: NewVersion,
    now: Date,
  ): Promise<{ number: number }> {
    return getPrisma().$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ current_version_id: string | null }>>(
        Prisma.sql`SELECT current_version_id FROM workbooks_workbooks WHERE id = ${workbookId}::uuid FOR UPDATE`,
      );
      if (locked.length === 0 || locked[0].current_version_id !== baseVersionId) {
        throw new StaleBaseVersionError();
      }
      const last = await tx.workbookVersion.aggregate({
        where: { workbookId },
        _max: { number: true },
      });
      const number = (last._max.number ?? 0) + 1;
      await tx.workbookVersion.create({ data: { ...version, workbookId, number } });
      await tx.workbook.update({
        where: { id: workbookId },
        data: { currentVersionId: version.id, sizeBytes: version.sizeBytes, updatedAt: now },
      });
      return { number };
    });
  },

  /** Which of these storage keys belong to a version row (for the orphan cleanup). */
  async referencedKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const rows = await getPrisma().workbookVersion.findMany({
      where: { storageKey: { in: keys } },
      select: { storageKey: true },
    });
    return new Set(rows.map((row) => row.storageKey));
  },
};

export type WorkbooksRepository = typeof workbooksRepository;
