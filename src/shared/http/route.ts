// The route() wrapper every src/app/api/**/route.ts uses:
//   export const POST = route({ access, workbook?, input?, handler: controller.fn })
// Order: request ID → same-origin check → principal / internal token → access check (default
// deny) → workbook role (NOT_FOUND when none) → input parsing → handler → envelope.
// Anything thrown becomes the friendly error envelope (Decision 26).
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { getEnv } from "@/shared/config/env";
import { AppError } from "@/shared/errors/AppError";
import { GENERIC_FIELD_MESSAGE } from "@/shared/errors/errorCatalog";
import { parseInput, toErrorResponse } from "@/shared/errors/toErrorResponse";
import { logger as rootLogger, type Logger } from "@/shared/logger";
import { checkNetwork, recordOutsideAccess } from "@/shared/http/networkGuard";
import { readSessionToken } from "@/shared/http/sessionCookie";
import {
  checkAccess,
  mayWorkFromAnyNetwork,
  requiredPermissions,
  type Access,
} from "@/shared/rbac/guard";
import type { Principal } from "@/shared/rbac/principal";
import { resolvePrincipal } from "@/shared/rbac/principalResolver";
import {
  resolveWorkbookRole,
  roleAllows,
  type WorkbookCapability,
  type WorkbookRole,
} from "@/shared/rbac/workbookAccess";

export type { Access };

/** Header the Rust service sends on internal calls (Decision 10). */
export const INTERNAL_TOKEN_HEADER = "x-internal-token";

/** Largest JSON body a route accepts (X-INPUT-09). Workbook bytes use their own limit. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export interface RouteContext<I, P> {
  request: Request;
  requestId: string;
  params: P;
  input: I;
  /** Null on public and internal routes. */
  principal: Principal | null;
  /** Set when the route declares `workbook`: the caller's effective role on it. */
  workbookRole: WorkbookRole | null;
  /** True when the request comes from outside the allowed networks (Super Admins, sign-in). */
  outsideNetwork: boolean;
  logger: Logger;
}

export interface HandlerResult<T> {
  data: T;
  status?: number;
  headers?: Record<string, string>;
}

/** For responses that are not the JSON envelope, such as workbook bytes. */
export interface RawResult {
  response: Response;
}

export interface WorkbookRequirement<P> {
  /** The route parameter that holds the workbook ID. */
  param: keyof P & string;
  capability: WorkbookCapability;
}

export interface RouteOptions<T, I, P> {
  access: Access;
  /** Workbook routes: the caller needs this capability on the workbook (Decision 17). */
  workbook?: WorkbookRequirement<P>;
  /** Validates the JSON body (or the query string for GET, HEAD and DELETE). */
  input?: z.ZodType<I>;
  /**
   * false only for /api/health, which container health checks call (Decision 46). "sign-in": open
   * to every network, the handler is told (Decision 57: Super Admins sign in from anywhere).
   */
  network?: boolean | "sign-in";
  /** true for the routes a person who must change their password may still use. */
  allowWhilePasswordChangeRequired?: boolean;
  handler: (context: RouteContext<I, P>) => Promise<HandlerResult<T> | RawResult>;
}

export type NextRouteHandler<P> = (
  request: Request,
  context: { params: Promise<P> },
) => Promise<Response>;

const QUERY_METHODS = new Set(["GET", "HEAD", "DELETE"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readRawInput(request: Request): Promise<unknown> {
  if (QUERY_METHODS.has(request.method)) {
    return Object.fromEntries(new URL(request.url).searchParams);
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_JSON_BODY_BYTES) throw new AppError("REQUEST_TOO_LARGE");
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_JSON_BODY_BYTES) throw new AppError("REQUEST_TOO_LARGE");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_FAILED", {
      fieldErrors: [{ field: "_root", message: GENERIC_FIELD_MESSAGE }],
    });
  }
}

/**
 * A write must come from the app's own address. With the session cookie, a missing Origin is
 * refused too (P1-SESS-09); scripts without a cookie may omit it.
 */
function assertSameOrigin(request: Request): void {
  if (!WRITE_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  const appOrigin = new URL(getEnv().APP_URL).origin;
  const hasSession = readSessionToken(request.headers) !== null;
  if ((origin !== null && origin !== appOrigin) || (hasSession && origin === null)) {
    throw new AppError("FORBIDDEN", { logContext: { rule: "cross-site-write" } });
  }
}

/** Constant-time comparison of the internal service token. */
export function hasInternalToken(headers: Headers): boolean {
  const given = headers.get(INTERNAL_TOKEN_HEADER);
  if (!given) return false;
  const expected = Buffer.from(getEnv().INTERNAL_SERVICE_TOKEN);
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function checkWorkbook<P>(
  requirement: WorkbookRequirement<P>,
  params: P,
  principal: Principal | null,
): Promise<WorkbookRole> {
  const workbookId = String(params[requirement.param] ?? "");
  // A malformed ID is simply "not found" (X-INPUT-07).
  if (!principal || !UUID.test(workbookId)) throw new AppError("NOT_FOUND");
  const role = await resolveWorkbookRole(principal, workbookId);
  // No role: the workbook does not exist for this person (X-ACCESS-05).
  if (!role) throw new AppError("NOT_FOUND");
  if (!roleAllows(role, requirement.capability)) {
    throw new AppError("FORBIDDEN", {
      logContext: { workbookId, role, capability: requirement.capability },
    });
  }
  return role;
}

export function route<T, I = undefined, P extends object = Record<string, string>>(
  options: RouteOptions<T, I, P>,
): NextRouteHandler<P> {
  return async (request, context) => {
    const requestId = randomUUID();
    const logger = rootLogger.child({ requestId });
    // no-store: a browser must never keep an API answer.
    const headers = { "x-request-id": requestId, "cache-control": "no-store" };
    try {
      const internal = options.access === "internal";
      // Outside the allowed networks only sign-in and a signed-in Super Admin pass (Decision 57).
      let outside: { ip: string | null; path: string } | null = null;
      if (!internal && options.network !== false) {
        const path = new URL(request.url).pathname;
        const decision = await checkNetwork({
          headers: request.headers,
          method: request.method,
          path,
        });
        if (!decision.allowed) outside = { ip: decision.ip, path };
      }
      if (!internal) assertSameOrigin(request);
      const principal = internal ? null : await resolvePrincipal(request);
      if (outside && options.network !== "sign-in") {
        if (!mayWorkFromAnyNetwork(principal)) throw new AppError("NETWORK_BLOCKED");
        await recordOutsideAccess({ userId: principal.userId, ...outside });
      }
      const decision = checkAccess(options.access, principal, {
        internalAuthorized: internal && hasInternalToken(request.headers),
      });
      if (decision === "unauthenticated") throw new AppError("UNAUTHENTICATED");
      if (decision === "forbidden") {
        const codes = requiredPermissions(options.access);
        throw new AppError("FORBIDDEN", {
          logContext: {
            permission: codes?.length === 1 ? codes[0] : codes,
            principalId: principal?.userId ?? null,
          },
        });
      }

      if (principal?.mustChangePassword && !options.allowWhilePasswordChangeRequired) {
        throw new AppError("PASSWORD_CHANGE_REQUIRED");
      }

      const params = await context.params;
      const workbookRole = options.workbook
        ? await checkWorkbook(options.workbook, params, principal)
        : null;

      const input = options.input
        ? parseInput(options.input, await readRawInput(request))
        : (undefined as I);
      const result = await options.handler({
        request,
        requestId,
        params,
        input,
        principal,
        workbookRole,
        outsideNetwork: outside !== null,
        logger,
      });
      if ("response" in result) {
        result.response.headers.set("x-request-id", requestId);
        if (!result.response.headers.has("cache-control")) {
          result.response.headers.set("cache-control", "no-store");
        }
        return result.response;
      }
      return Response.json(
        { data: result.data },
        { status: result.status ?? 200, headers: { ...headers, ...result.headers } },
      );
    } catch (error) {
      const { status, body } = toErrorResponse(error, { requestId, logger });
      return Response.json(body, { status, headers });
    }
  };
}
