// The network check every page and API route runs first (Decisions 18, 46). The network module
// installs the real check at server start (src/instrumentation.ts); shared code never imports it.
export type NetworkDecision = { allowed: true } | { allowed: false; ip: string | null };

export interface NetworkRequest {
  headers: Headers;
  method: string;
  path: string;
}

export type NetworkGuard = (request: NetworkRequest) => Promise<NetworkDecision>;

const holder = globalThis as unknown as { jdsheetsNetworkGuard?: NetworkGuard };

export function configureNetworkGuard(guard: NetworkGuard | null): void {
  holder.jdsheetsNetworkGuard = guard ?? undefined;
}

/**
 * Records that a Super Admin used the app from outside the allowed networks (Decision 57). The
 * network module installs it; it decides how often to write the audit event.
 */
export type OutsideAccessRecorder = (input: {
  userId: string;
  ip: string | null;
  path: string;
}) => Promise<void>;

const recorderHolder = globalThis as unknown as { jdsheetsOutsideAccess?: OutsideAccessRecorder };

export function configureOutsideAccessRecorder(recorder: OutsideAccessRecorder | null): void {
  recorderHolder.jdsheetsOutsideAccess = recorder ?? undefined;
}

export async function recordOutsideAccess(input: {
  userId: string;
  ip: string | null;
  path: string;
}): Promise<void> {
  await recorderHolder.jdsheetsOutsideAccess?.(input);
}

/** No guard installed (unit tests, build) allows everything; the app always installs one. */
export function checkNetwork(request: NetworkRequest): Promise<NetworkDecision> {
  return holder.jdsheetsNetworkGuard?.(request) ?? Promise.resolve({ allowed: true });
}
