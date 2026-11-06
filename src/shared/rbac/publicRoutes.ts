// The only API routes that may declare `access: 'public'` (project_data.md Section 5.2, rule 1).
// Adding a route here needs a decision-log entry. src/tests/scans/routeGuards.unit.test.ts
// enforces this list.
export const PUBLIC_ROUTES = [
  "/api/health",
  "/api/auth/sign-in",
  // Public so that repeating it, or an expired session, succeeds quietly.
  "/api/auth/sign-out",
  "/api/auth/sign-up/request",
  "/api/auth/sign-up/verify",
  "/api/auth/sign-up/complete",
  // Test-only: answer 404 unless APP_ENV=test.
  "/api/test-support/fail",
  "/api/test-support/mail",
] as const;
