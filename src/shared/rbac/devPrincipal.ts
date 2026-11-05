// Phase 0 only (Decision 35): with DEV_PRINCIPAL=on, every request runs as this principal.
// The env loader refuses DEV_PRINCIPAL=on in production, and the resolver below refuses it outside
// development and test as a second lock. Phase 1 replaces it with real sessions.
import { getEnv } from "@/shared/config/env";
import type { Principal } from "./principal";
import type { PrincipalResolver } from "./principalResolver";

export const DEV_PRINCIPAL_USER_ID = "00000000-0000-7000-8000-00000000d0e0";

export const DEV_PRINCIPAL: Principal = Object.freeze({
  userId: DEV_PRINCIPAL_USER_ID,
  displayName: "Developer",
  roleCode: "SUPER_ADMIN",
  bypassesAccess: true,
  permissions: new Set(),
});

export function isDevPrincipal(principal: Principal | null): boolean {
  return principal?.userId === DEV_PRINCIPAL_USER_ID;
}

/** The resolver the composition root installs when DEV_PRINCIPAL=on. */
export function createDevPrincipalResolver(): PrincipalResolver {
  const env = getEnv();
  if (env.DEV_PRINCIPAL !== "on") {
    throw new Error("The development principal needs DEV_PRINCIPAL=on");
  }
  if (env.APP_ENV !== "development" && env.APP_ENV !== "test") {
    throw new Error("The development principal is only allowed in development and test");
  }
  return async () => DEV_PRINCIPAL;
}
