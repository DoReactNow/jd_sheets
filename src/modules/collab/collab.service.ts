// Live co-editing, the app's side (Decisions 10, 22, 56, 58): tokens for the browser, and the
// internal routes the Rust service uses to load a workbook, store accepted changes and save
// "Live editing" versions. The Rust service never touches the database itself.
import type { Readable } from "node:stream";
import { workbooksService } from "@/modules/workbooks";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors/AppError";
import type { Principal } from "@/shared/rbac/principal";
import type { WorkbookRole } from "@/shared/rbac/workbookAccess";
import { plusDuration, systemClock, toIsoInstant, type Clock } from "@/shared/time";
import type { Prisma } from "@/generated/prisma/client";
import { collabRepository } from "./collab.repository";
import { issueCollabToken } from "./token";

export interface CollabTokenDto {
  token: string;
  /** Where the browser opens the WebSocket. */
  url: string;
  expiresAt: string;
}

export interface LiveStateDto {
  versionId: string;
  versionNumber: number;
  /** Changes built on that version, in order, to replay (recovery). */
  ops: Array<{ seq: number; userId: string; clientCommandId: string; step: unknown }>;
  /** The last sequence number used for this workbook. */
  lastSeq: number;
}

/** The browser's WebSocket address: COLLAB_PUBLIC_URL, or COLLAB_URL as ws://. */
export function collabPublicUrl(): string {
  const env = getEnv();
  if (env.COLLAB_PUBLIC_URL) return env.COLLAB_PUBLIC_URL.replace(/\/$/, "");
  return env.COLLAB_URL.replace(/^http/, "ws").replace(/\/$/, "");
}

export function createCollabService({ clock = systemClock }: { clock?: Clock } = {}) {
  return {
    async issueToken(
      principal: Principal,
      role: WorkbookRole,
      workbookId: string,
      ip: string,
    ): Promise<CollabTokenDto> {
      if (!principal.sessionId) throw new AppError("UNAUTHENTICATED");
      const token = await issueCollabToken({
        userId: principal.userId,
        sessionId: principal.sessionId,
        workbookId,
        role,
        ip,
        displayName: principal.displayName,
        clock,
        secret: getEnv().COLLAB_TOKEN_SECRET,
      });
      return {
        token,
        url: `${collabPublicUrl()}/collab/${workbookId}`,
        expiresAt: toIsoInstant(
          plusDuration(clock.now(), { seconds: APP_CONFIG.collab.tokenTtlSeconds }),
        ),
      };
    },

    async state(workbookId: string): Promise<LiveStateDto> {
      const workbook = await workbooksService().get(workbookId, "OWNER");
      const [ops, lastSeq] = await Promise.all([
        collabRepository.opsOn(workbookId, workbook.currentVersionId),
        collabRepository.lastSeq(workbookId),
      ]);
      return {
        versionId: workbook.currentVersionId,
        versionNumber: workbook.currentVersionNumber,
        ops: ops.map((op) => ({
          seq: Number(op.seq),
          userId: op.userId,
          clientCommandId: op.clientCommandId,
          step: op.step,
        })),
        lastSeq,
      };
    },

    content(
      workbookId: string,
    ): Promise<{ body: Readable; sizeBytes: number; versionId: string; title: string }> {
      return workbooksService().openContent(workbookId);
    },

    async appendOps(
      workbookId: string,
      baseVersionId: string,
      ops: Array<{
        seq: number;
        userId: string;
        clientCommandId: string;
        commandId: string;
        step: unknown;
      }>,
    ): Promise<number> {
      return collabRepository.append(
        workbookId,
        baseVersionId,
        ops.map((op) => ({ ...op, step: op.step as Prisma.InputJsonValue })),
      );
    },

    snapshot(
      workbookId: string,
      baseVersionId: string,
      bytes: Uint8Array,
      contributorIds: string[],
    ) {
      return workbooksService().addLiveSnapshot(workbookId, baseVersionId, bytes, contributorIds);
    },

    /** Nightly: changes no longer built on the current version, older than 7 days. */
    prune(): Promise<number> {
      return collabRepository.prune(plusDuration(clock.now(), { days: -7 }));
    },
  };
}

export const collabService = createCollabService();
