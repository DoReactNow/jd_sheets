// Issues collab tokens for the Rust service (Decision 10). The browser receives one after the
// session, network and workbook-role checks, and presents it to the service. Shared fixtures in
// contracts/collab-token/ keep this issuer and the Rust verifier in step.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { APP_CONFIG } from "@/shared/config/appConfig";
import type { WorkbookRole } from "@/shared/rbac/workbookAccess";
import type { Clock } from "@/shared/time";

export type TokenRole = "EDITOR" | "COMMENTER" | "VIEWER";

export interface CollabTokenInput {
  userId: string;
  sessionId: string;
  workbookId: string;
  role: WorkbookRole;
  /** The client IP as the app saw it; the service refuses a connection from another one. */
  ip: string;
  displayName: string;
  clock: Clock;
  secret: string;
  /** Fixed in tests; random otherwise. */
  jti?: string;
}

export interface CollabClaims {
  iss: string;
  aud: string;
  sub: string;
  sid: string;
  wb: string;
  role: TokenRole;
  own: boolean;
  ip: string;
  name: string;
  iat: number;
  exp: number;
  jti: string;
}

/** An Owner is sent as EDITOR plus own: true; the service has no separate owner role. */
export function tokenRoleOf(role: WorkbookRole): { role: TokenRole; own: boolean } {
  return role === "OWNER" ? { role: "EDITOR", own: true } : { role, own: false };
}

export function collabClaims(input: Omit<CollabTokenInput, "secret">): CollabClaims {
  const iat = Math.floor(input.clock.now().getTime() / 1000);
  return {
    iss: APP_CONFIG.collab.tokenIssuer,
    aud: APP_CONFIG.collab.tokenAudience,
    sub: input.userId,
    sid: input.sessionId,
    wb: input.workbookId,
    ...tokenRoleOf(input.role),
    ip: input.ip,
    name: input.displayName,
    iat,
    exp: iat + APP_CONFIG.collab.tokenTtlSeconds,
    jti: input.jti ?? randomUUID(),
  };
}

/** Signs claims exactly as given (HS256). Used by the issuer and the fixture generator. */
export function signClaims(claims: Record<string, unknown>, secret: string): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .sign(new TextEncoder().encode(secret));
}

export function issueCollabToken(input: CollabTokenInput): Promise<string> {
  return signClaims({ ...collabClaims(input) }, input.secret);
}
