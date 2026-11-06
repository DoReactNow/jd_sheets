// Live changes (database_schema.md 3.15, Decision 58). Writes only collab_ops.
import { getPrisma } from "@/shared/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

export interface NewOp {
  seq: number;
  userId: string;
  clientCommandId: string;
  commandId: string;
  step: unknown;
}

export const collabRepository = {
  /** Appends ops in one transaction; an op already stored (a retry) is skipped. */
  async append(workbookId: string, baseVersionId: string, ops: NewOp[]): Promise<number> {
    const result = await getPrisma().collabOp.createMany({
      data: ops.map((op) => ({
        ...op,
        step: op.step as Prisma.InputJsonValue,
        seq: BigInt(op.seq),
        workbookId,
        baseVersionId,
      })),
      skipDuplicates: true,
    });
    return result.count;
  },

  /** Ops built on `baseVersionId`, in order (recovery after a restart). */
  opsOn(workbookId: string, baseVersionId: string) {
    return getPrisma().collabOp.findMany({
      where: { workbookId, baseVersionId },
      orderBy: { seq: "asc" },
      select: { seq: true, userId: true, clientCommandId: true, step: true },
    });
  },

  async lastSeq(workbookId: string): Promise<number> {
    const row = await getPrisma().collabOp.aggregate({
      where: { workbookId },
      _max: { seq: true },
    });
    return Number(row._max.seq ?? 0n);
  },

  /** Old ops no longer built on the current version (P3-RECOV-03). */
  async prune(before: Date): Promise<number> {
    const result = await getPrisma().$executeRaw`
      DELETE FROM collab_ops o USING workbooks_workbooks w
      WHERE o.workbook_id = w.id AND o.created_at < ${before}
        AND o.base_version_id IS DISTINCT FROM w.current_version_id`;
    return result;
  },
};
