// Server-side checks for pages (Decision 46): the network rules, then who is signed in. Pages call
// these before rendering; the API has the same checks in route().
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, mayWorkFromAnyNetwork } from "@/shared/rbac/guard";
import type { PermissionCode } from "@/shared/rbac/permissionRegistry";
import type { Principal } from "@/shared/rbac/principal";
import { resolvePrincipal } from "@/shared/rbac/principalResolver";
import { checkNetwork, recordOutsideAccess } from "./networkGuard";
import { outsidePageDecision } from "./outsideAccess";

/**
 * True when this page may be shown: an allowed network, the sign-in page, or a signed-in Super
 * Admin on an admin-panel page (Decisions 57, 64). Outside, `/` goes to sign-in (not signed in)
 * or to `/admin` (Super Admin); sheets are never shown.
 */
export async function pageNetworkAllowed(): Promise<boolean> {
  const all = await headers();
  const path = all.get("x-jd-path") ?? "page";
  const decision = await checkNetwork({ headers: all, method: "GET", path });
  if (decision.allowed) return true;
  const principal = await resolvePrincipal({ headers: all });
  const viewer = !principal
    ? "anonymous"
    : mayWorkFromAnyNetwork(principal)
      ? "super-admin"
      : "other";
  const outcome = outsidePageDecision(path, viewer);
  if (outcome === "sign-in") redirect("/sign-in");
  if (outcome === "admin-home") redirect("/admin");
  if (outcome === "blocked") return false;
  if (principal && viewer === "super-admin") {
    await recordOutsideAccess({ userId: principal.userId, ip: decision.ip, path });
  }
  return true;
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
