// Next.js calls register() once when a server starts: the composition root for request identity,
// workbook roles, the network rules and the startup checks.
export async function register(): Promise<void> {
  // NEXT_RUNTIME is set by Next.js itself and is not part of the app's environment schema.
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getEnv } = await import("@/shared/config/env");
  try {
    getEnv();
  } catch {
    return; // no runtime environment (for example during `next build`): nothing to install
  }

  // Fail at startup, not on the first save, when the storage driver is wrong.
  const { getFileStorage } = await import("@/shared/storage");
  getFileStorage();

  // Who is asking: the session cookie (Decision 14).
  const { configurePrincipalResolver } = await import("@/shared/rbac/principalResolver");
  const { createSessionPrincipalResolver } = await import("@/modules/identity");
  configurePrincipalResolver(createSessionPrincipalResolver());

  // Workbook roles: owner, direct and group grants and the company link (Phase 2).
  const { configureWorkbookRoleResolver } = await import("@/shared/rbac/workbookAccess");
  const { resolveWorkbookRoleWithSharing } = await import("@/modules/sharing");
  configureWorkbookRoleResolver(resolveWorkbookRoleWithSharing);

  // The network rules for every page and API route (Decisions 18, 46).
  const { configureNetworkGuard, configureOutsideAccessRecorder } =
    await import("@/shared/http/networkGuard");
  const { networkService } = await import("@/modules/network");
  configureNetworkGuard((request) => networkService.check(request));
  // Super Admins from outside the allowed networks are audited (Decision 57).
  configureOutsideAccessRecorder((input) => networkService.recordOutsideAccess(input));
  const { logger } = await import("@/shared/logger");
  networkService
    .bootstrap()
    .then((written) => written > 0 && logger.info("first network rules written", { written }))
    .catch((error: unknown) =>
      logger.error("could not write the first network rules", { err: error }),
    );
}

/** Errors while rendering a page never pass through route(), so they are logged here. */
export async function onRequestError(error: unknown): Promise<void> {
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("@/shared/logger");
  logger.error("page failed to render", { err: error });
}
