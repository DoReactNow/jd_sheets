// Which pages an address outside the allowed networks may open (Decisions 57, 64, 65). The API
// follows the same rule in route(): sign-in is open, a signed-in Super Admin works everywhere,
// everyone else is blocked.

/** Pages anyone may open from any network: the main address (sign-in) and /sign-in. */
const OPEN_TO_EVERYONE = new Set(["/", "/sign-in"]);

export type OutsideViewer = "anonymous" | "other" | "super-admin";
export type OutsidePageDecision = "show" | "blocked";

export function outsidePageDecision(path: string, viewer: OutsideViewer): OutsidePageDecision {
  if (viewer === "super-admin") return "show";
  if (path === "/sign-in") return "show";
  return viewer === "anonymous" && OPEN_TO_EVERYONE.has(path) ? "show" : "blocked";
}
