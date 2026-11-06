// Server-side checks for pages (Decision 46): the network rules, then who is signed in. Pages call
// these before rendering; the API has the same checks in route().
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { can } from "@/shared/rbac/guard";
import type { PermissionCode } from "@/shared/rbac/permissionRegistry";
import type { Principal } from "@/shared/rbac/principal";
import { resolvePrincipal } from "@/shared/rbac/principalResolver";
import { checkNetwork } from "./networkGuard";

/** True when this page request comes from an allowed network. */
export async function pageNetworkAllowed(path: string): Promise<boolean> {
  const decision = await checkNetwork({ headers: await headers(), method: "GET", path });
  return decision.allowed;
}

/** The signed-in person, or a redirect to sign-in (and to change-password when required). */
export async function requirePageUser(path: string): Promise<Principal> {
  const principal = await resolvePrincipal({ headers: await headers() });
  if (!principal) redirect(`/sign-in?next=${encodeURIComponent(path)}`);
  if (principal.mustChangePassword) redirect("/change-password");
  return principal;
}

/** The signed-in person with one of these permissions, or the friendly 403 page. */
export async function requirePagePermission(
  path: string,
  codes: PermissionCode[],
): Promise<Principal> {
  const principal = await requirePageUser(path);
  if (!codes.some((code) => can(principal, code))) redirect("/forbidden");
  return principal;
}

export async function currentPrincipal(): Promise<Principal | null> {
  return resolvePrincipal({ headers: await headers() });
}
