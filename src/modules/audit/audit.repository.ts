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

/** Writes the event; answers its id. */
export async function recordAudit(tx: AuditTx, input: AuditInput): Promise<string> {
  const created = await tx.auditEvent.create({
    data: {
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      actorId: input.actorId,
      actorKind: input.actorKind ?? (input.actorId ? "USER" : "SYSTEM"),
      ip: input.ip ?? null,
      details: safeDetails(input.details) as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return created.id;
}

/** The newest events of one kind, with who did them (the Network page's outside access). */
export function recentAuditEvents(action: string, limit: number) {
  return getPrisma().auditEvent.findMany({
    where: { action },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      ip: true,
      details: true,
      createdAt: true,
      actor: { select: { displayName: true, email: true } },
    },
  });
}

/** One event by id (the administrator's audited open, P2-ADMINWB-03). */
export function findAuditEvent(id: string) {
  return getPrisma().auditEvent.findUnique({
    where: { id },
    select: { id: true, action: true, actorId: true, targetId: true, createdAt: true },
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
