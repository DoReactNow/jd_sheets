// Integration helpers that go through the real sign-in: the session resolver, the network guard and
// the session cookie, exactly as in production.
import { POST as signInRoute } from "@/app/api/auth/sign-in/route";
import { createSessionPrincipalResolver } from "@/modules/identity";
import { networkService } from "@/modules/network";
import { getEnv } from "@/shared/config/env";
import { configureNetworkGuard } from "@/shared/http/networkGuard";
import {
  configurePrincipalResolver,
  setPrincipalResolverForTests,
} from "@/shared/rbac/principalResolver";
import { callRoute, type RouteResult } from "./callRoute";
import { TEST_PASSWORD } from "./users";

export function installRealResolvers(): void {
  setPrincipalResolverForTests(null);
  configurePrincipalResolver(createSessionPrincipalResolver());
  configureNetworkGuard((request) => networkService.check(request));
  networkService.invalidate();
}

type Handler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;

export interface CallOptions<P> {
  method?: string;
  path?: string;
  cookie?: string | null;
  body?: unknown;
  params?: P;
  headers?: Record<string, string>;
  ip?: string;
}

/** Calls a route as a browser on our own site would: Origin on writes, the cookie, the client IP. */
export function call<B = unknown, P extends object = Record<string, string>>(
  handler: Handler<P>,
  { method = "GET", path = "/api/x", cookie, body, params, headers = {}, ip }: CallOptions<P> = {},
): Promise<RouteResult<B>> {
  const all: Record<string, string> = { ...headers };
  if (method !== "GET" && !("origin" in all)) all.origin = new URL(getEnv().APP_URL).origin;
  if (cookie) all.cookie = cookie;
  if (ip) all["x-forwarded-for"] = ip;
  return callRoute<B, P>(handler, { method, path, body, params, headers: all });
}

export function cookieFrom(result: RouteResult): string | null {
  const header = result.headers.get("set-cookie");
  return header ? header.split(";")[0] : null;
}

export async function signIn(
  email: string,
  password = TEST_PASSWORD,
  ip?: string,
): Promise<string> {
  const result = await call(signInRoute, { method: "POST", body: { email, password }, ip });
  const cookie = cookieFrom(result);
  if (result.status !== 200 || !cookie) {
    throw new Error(`sign-in failed for ${email}: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return cookie;
}
