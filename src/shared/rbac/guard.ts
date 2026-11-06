// The guard in front of every action (Decision 16). Default deny; the Super Admin bypass is
// honoured here only. Feature code never checks role names.
//   "public"        anyone (allow-listed in publicRoutes.ts)
//   "authenticated" any signed-in principal
//   "internal"      the Rust service, proven by INTERNAL_SERVICE_TOKEN (Decision 10)
//   { permission } / { anyOf }  registered permission codes
import type { PermissionCode } from "./permissionRegistry";
import type { Principal } from "./principal";

export type Access =
  | "public"
  | "authenticated"
  | "internal"
  | { permission: PermissionCode }
  | { anyOf: readonly PermissionCode[] };

export type AccessDecision = "allow" | "unauthenticated" | "forbidden";

export interface AccessContext {
  /** True when the request carried the valid internal service token. */
  internalAuthorized?: boolean;
}

export function can(principal: Principal | null, code: PermissionCode): boolean {
  if (!principal) return false;
  if (principal.bypassesAccess) return true;
  return principal.permissions.has(code);
}

/** The permission codes an access declaration asks for (null for the string forms). */
export function requiredPermissions(access: Access | undefined): readonly PermissionCode[] | null {
  if (access && typeof access === "object") {
    if ("permission" in access && typeof access.permission === "string") return [access.permission];
    if ("anyOf" in access && Array.isArray(access.anyOf)) return access.anyOf;
  }
  return null;
}

export function checkAccess(
  access: Access | undefined,
  principal: Principal | null,
  context: AccessContext = {},
): AccessDecision {
  if (access === "public") return "allow";
  if (access === "internal")
    return context.internalAuthorized === true ? "allow" : "unauthenticated";
  if (access === "authenticated") return principal ? "allow" : "unauthenticated";

  const codes = requiredPermissions(access);
  if (!codes || codes.length === 0) return "forbidden"; // missing or malformed access: deny
  if (!principal) return "unauthenticated";
  return codes.some((code) => can(principal, code)) ? "allow" : "forbidden";
}
