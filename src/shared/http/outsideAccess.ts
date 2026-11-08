// What an address outside the allowed networks may reach (Decision 64). The single list: a page
// or API route not named here is closed outside, so new routes are safe by default.

/** Admin-panel API a signed-in Super Admin may use from outside. Sheets are never here. */
const OUTSIDE_API_PREFIXES = [
  "/api/me",
  "/api/diagnostics",
  "/api/auth",
  "/api/admin/approvals",
  "/api/admin/users",
  "/api/admin/network",
  "/api/admin/groups",
  "/api/admin/audit",
] as const;

/** Admin-panel pages a signed-in Super Admin may open from outside. */
const OUTSIDE_PAGE_PREFIXES = [
  "/admin/approvals",
  "/admin/users",
  "/admin/network",
  "/admin/groups",
  "/admin/audit",
] as const;
const OUTSIDE_PAGES = new Set(["/admin", "/change-password", "/forbidden"]);

/** Pages anyone may open from any network. */
const OPEN_PAGES = new Set(["/sign-in"]);

/** True when `path` is `prefix` itself or below it ("/api/admin/usersX" is not below "/api/admin/users"). */
function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function outsideApiAllowed(path: string): boolean {
  return OUTSIDE_API_PREFIXES.some((prefix) => under(path, prefix));
}

export type OutsideViewer = "anonymous" | "other" | "super-admin";
export type OutsidePageDecision = "show" | "blocked" | "sign-in" | "admin-home";

export function outsidePageDecision(path: string, viewer: OutsideViewer): OutsidePageDecision {
  if (OPEN_PAGES.has(path)) return "show";
  if (viewer === "anonymous") return path === "/" ? "sign-in" : "blocked";
  if (viewer === "other") return "blocked";
  if (path === "/") return "admin-home";
  if (OUTSIDE_PAGES.has(path) || OUTSIDE_PAGE_PREFIXES.some((prefix) => under(path, prefix))) {
    return "show";
  }
  return "blocked";
}
