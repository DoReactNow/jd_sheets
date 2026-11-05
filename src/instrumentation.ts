// Next.js calls register() once when a server starts: the composition root for request identity,
// workbook roles and the startup checks.
export async function register(): Promise<void> {
  // NEXT_RUNTIME is set by Next.js itself and is not part of the app's environment schema.
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getEnv } = await import("@/shared/config/env");
  let env;
  try {
    env = getEnv();
  } catch {
    return; // no runtime environment (for example during `next build`): nothing to install
  }

  // Fail at startup, not on the first save, when the storage driver is wrong.
  const { getFileStorage } = await import("@/shared/storage");
  getFileStorage();

  // Workbook roles: owner only in Phase 0; the sharing module takes over in Phase 2.
  const { configureWorkbookRoleResolver } = await import("@/shared/rbac/workbookAccess");
  const { resolveWorkbookRoleForOwner } = await import("@/modules/workbooks");
  configureWorkbookRoleResolver(resolveWorkbookRoleForOwner);

  // Phase 0 has no sign-in: every request is the development principal (Decision 35). The env
  // loader already refuses DEV_PRINCIPAL=on in production.
  if (env.DEV_PRINCIPAL === "on") {
    const { configurePrincipalResolver } = await import("@/shared/rbac/principalResolver");
    const { createDevPrincipalResolver } = await import("@/shared/rbac/devPrincipal");
    configurePrincipalResolver(createDevPrincipalResolver());
  }
}

/** Errors while rendering a page never pass through route(), so they are logged here. */
export async function onRequestError(error: unknown): Promise<void> {
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("@/shared/logger");
  logger.error("page failed to render", { err: error });
}
