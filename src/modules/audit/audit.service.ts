// Reading the audit trail for the Audit screen (P1-AUDIT-03..05). Days are business days in
// Asia/Kolkata (Decision 25).
import { businessDayRange, toIsoInstant, type BusinessDate } from "@/shared/time";
import { auditRepository } from "./audit.repository";

export interface AuditQuery {
  actorId?: string;
  action?: string;
  fromDay?: BusinessDate;
  toDay?: BusinessDate;
  before?: string;
}

export interface AuditEventDto {
  id: string;
  at: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actor: { id: string; name: string; email: string } | null;
  actorKind: string;
  ip: string | null;
  details: Record<string, unknown>;
}

const PAGE_SIZE = 100;

export const auditService = {
  async list(
    query: AuditQuery,
  ): Promise<{ events: AuditEventDto[]; actions: string[]; nextBefore: string | null }> {
    const rows = await auditRepository.list({
      actorId: query.actorId,
      action: query.action,
      from: query.fromDay ? businessDayRange(query.fromDay).start : undefined,
      to: query.toDay ? businessDayRange(query.toDay).end : undefined,
      before: query.before,
      limit: PAGE_SIZE + 1,
    });
    const page = rows.slice(0, PAGE_SIZE);
    return {
      events: page.map((row) => ({
        id: row.id,
        at: toIsoInstant(row.createdAt),
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        actor:
          row.actorId && row.actor
            ? { id: row.actorId, name: row.actor.displayName, email: row.actor.email }
            : null,
        actorKind: row.actorKind,
        ip: row.ip,
        details: (row.details ?? {}) as Record<string, unknown>,
      })),
      actions: await auditRepository.distinctActions(),
      nextBefore: rows.length > PAGE_SIZE ? page[page.length - 1].id : null,
    };
  },
};
