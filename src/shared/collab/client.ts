// The app's HTTP client for the Rust collab service (Decision 10). Internal calls carry the service
// token; every call has a timeout, and a service that does not answer becomes SERVICE_UNAVAILABLE.
import { APP_CONFIG } from "@/shared/config/appConfig";
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors/AppError";

/** The header the Rust service expects on internal calls (same as route.ts accepts from it). */
export const COLLAB_INTERNAL_TOKEN_HEADER = "x-internal-token";

export interface CollabRequestOptions {
  method?: "GET" | "POST";
  body?: BodyInit;
  contentType?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Calls an internal endpoint of the Rust service. Network failures and timeouts → 503. */
export async function collabRequest(
  path: string,
  { method = "GET", body, contentType, headers: extra = {}, timeoutMs }: CollabRequestOptions = {},
): Promise<Response> {
  const env = getEnv();
  const headers: Record<string, string> = {
    ...extra,
    [COLLAB_INTERNAL_TOKEN_HEADER]: env.INTERNAL_SERVICE_TOKEN,
  };
  if (contentType) headers["content-type"] = contentType;
  try {
    return await fetch(new URL(path, env.COLLAB_URL), {
      method,
      body,
      headers,
      signal: AbortSignal.timeout(timeoutMs ?? APP_CONFIG.collab.requestTimeoutMs),
    });
  } catch (error) {
    throw new AppError("SERVICE_UNAVAILABLE", { cause: error, logContext: { service: "collab" } });
  }
}

/** True when the Rust service answers its health check. Never throws. */
export async function pingCollab(timeoutMs = 2_000): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", getEnv().COLLAB_URL), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}
