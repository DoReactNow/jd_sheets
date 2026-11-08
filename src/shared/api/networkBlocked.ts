// Decision 64: when the network changes under an open page (a sheet, say), the server answers
// NETWORK_BLOCKED. Reloading lets the server show the blocked page instead of the sheet.

/** Calls `reload` the first time it sees NETWORK_BLOCKED, never again. */
export function createNetworkBlockedReloader(reload: () => void): (code: string) => void {
  let done = false;
  return (code) => {
    if (code !== "NETWORK_BLOCKED" || done) return;
    done = true;
    reload();
  };
}

/** The browser's reloader; does nothing on the server. */
export const reactToNetworkBlocked = createNetworkBlockedReloader(() => {
  if (typeof window !== "undefined") window.location.reload();
});
