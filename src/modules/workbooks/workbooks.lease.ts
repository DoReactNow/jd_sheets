// The edit lease (Decision 21, Decision 52, P2-LEASE-01..10): one page at a time may save a
// workbook. It lasts 90 seconds and the page renews it every 30. It belongs to one page (tab),
// so the same person in a second tab is told it is open elsewhere and may move it there.
import { APP_CONFIG } from "@/shared/config/appConfig";
import { AppError } from "@/shared/errors/AppError";
import type { Principal } from "@/shared/rbac/principal";
import { roleAllows, type WorkbookRole } from "@/shared/rbac/workbookAccess";
import { systemClock, toIsoInstant, type Clock } from "@/shared/time";
import { leaseRepository } from "./workbooks.repository";

export type LeaseState =
  | { status: "HELD"; expiresAt: string; renewSeconds: number }
  | { status: "OTHER"; holderName: string }
  | { status: "ELSEWHERE" }
  | { status: "VIEW_ONLY" };

export function createLeaseService({ clock = systemClock }: { clock?: Clock } = {}) {
  const ttlMs = APP_CONFIG.lease.ttlSeconds * 1000;

  async function whoHolds(principal: Principal, workbookId: string): Promise<LeaseState | null> {
    const current = await leaseRepository.current(workbookId, clock.now());
    if (!current) return null;
    if (current.userId === principal.userId) return { status: "ELSEWHERE" };
    return { status: "OTHER", holderName: current.holderName };
  }

  return {
    /**
     * Takes or renews the lease for this page. A person who cannot edit never holds it, and one
     * who lost edit rights loses it here (P2-LEASE-09, -10).
     */
    async acquire(
      principal: Principal,
      role: WorkbookRole,
      workbookId: string,
      tabId: string,
      takeOver: boolean,
    ): Promise<LeaseState> {
      if (!roleAllows(role, "edit")) {
        await leaseRepository.releaseAllOf(workbookId, principal.userId);
        return { status: "VIEW_ONLY" };
      }
      if (!principal.sessionId) throw new AppError("UNAUTHENTICATED");
      for (let attempt = 0; attempt < 2; attempt++) {
        const now = clock.now();
        const expiresAt = new Date(now.getTime() + ttlMs);
        const held = await leaseRepository.take({
          workbookId,
          userId: principal.userId,
          sessionId: principal.sessionId,
          tabId,
          now,
          expiresAt,
          takeOver,
        });
        if (held) {
          return {
            status: "HELD",
            expiresAt: toIsoInstant(expiresAt),
            renewSeconds: APP_CONFIG.lease.renewSeconds,
          };
        }
        // Held by someone else, or it expired between the two statements: look once more.
        const holder = await whoHolds(principal, workbookId);
        if (holder) return holder;
      }
      throw new AppError("CONFLICT");
    },

    async release(principal: Principal, workbookId: string, tabId: string): Promise<void> {
      await leaseRepository.release(workbookId, principal.userId, tabId);
    },

    /** Saves need this page to hold the lease (P2-LEASE-07). */
    async assertHolds(
      principal: Principal,
      workbookId: string,
      tabId: string | null,
    ): Promise<void> {
      const current = await leaseRepository.current(workbookId, clock.now());
      if (current && current.userId === principal.userId && current.tabId === tabId) return;
      if (current && current.userId === principal.userId) throw new AppError("EDITING_ELSEWHERE");
      throw new AppError("WORKBOOK_LOCKED", {
        logContext: { workbookId, holder: current?.userId ?? null },
      });
    },

    /** Someone other than this person holds the lease (restore and Commenter saves wait). */
    async heldByOther(principal: Principal, workbookId: string): Promise<boolean> {
      const current = await leaseRepository.current(workbookId, clock.now());
      return current !== null && current.userId !== principal.userId;
    },
  };
}

export type LeaseService = ReturnType<typeof createLeaseService>;
