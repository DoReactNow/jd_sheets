// The audit trail (Decision 48, X-DATA-02). recordAudit() writes inside the caller's transaction,
// so an event exists exactly when its change does. Details hold IDs and field names, never
// secrets or workbook content. Rows are never updated or deleted (trigger in the migration).
import { getPrisma } from "@/shared/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type AuditTx = Prisma.TransactionClient;

export interface AuditInput {
  /** Action name, for example "user.approved". */
  action: string;
  targetType: string;
  targetId?: string | null;
  /** Null for actions by the system (recovery commands, jobs). */
  actorId: string | null;
  actorKind?: "USER" | "SYSTEM" | "SERVICE";
  ip?: string | null;
  details?: Record<string, unknown>;
}

const FORBIDDEN_KEYS = /password|token|secret|otp|code|hash|cookie/i;

/** Drops any detail whose key looks like a secret (P1-AUDIT-02). */
export function safeDetails(details: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([key]) => !FORBIDDEN_KEYS.test(key)));
}

export async function recordAudit(tx: AuditTx, input: AuditInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      actorId: input.actorId,
      actorKind: input.actorKind ?? (input.actorId ? "USER" : "SYSTEM"),
      ip: input.ip ?? null,
      details: safeDetails(input.details) as Prisma.InputJsonValue,
    },
  });
}

export interface AuditFilter {
  actorId?: string;
  action?: string;
  from?: Date;
  /** Exclusive. */
  to?: Date;
  limit: number;
  /** Keyset pagination: events strictly older than this ID. */
  before?: string;
}

export const auditRepository = {
  list(filter: AuditFilter) {
    return getPrisma().auditEvent.findMany({
      where: {
        actorId: filter.actorId,
        action: filter.action,
        createdAt: { gte: filter.from, lt: filter.to },
        id: filter.before ? { lt: filter.before } : undefined,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filter.limit,
      include: { actor: { select: { displayName: true, email: true } } },
    });
  },

  distinctActions(): Promise<string[]> {
    return getPrisma()
      .auditEvent.findMany({
        distinct: ["action"],
        select: { action: true },
        orderBy: { action: "asc" },
      })
      .then((rows) => rows.map((row) => row.action));
  },
};
