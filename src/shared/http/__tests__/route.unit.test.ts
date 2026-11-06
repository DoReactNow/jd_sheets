// The route() wrapper: envelope, errors, input, access, internal token, workbook roles.
// P0-ERR-01..03, P0-ACC-02, P0-ACC-04, X-ACCESS-05, X-INPUT-07..09.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "@/shared/errors/AppError";
import { ERROR_CATALOG } from "@/shared/errors/errorCatalog";
import { callRoute } from "@/tests/setup/callRoute";
import { fakePrincipal } from "@/tests/setup/fakePrincipal";
import type { Principal } from "@/shared/rbac/principal";
import { configureWorkbookRoleResolver, type WorkbookRole } from "@/shared/rbac/workbookAccess";

const TOKEN = "test-only-internal-token-0123456789abcdef";
const WORKBOOK = "0190f1e2-0000-7000-8000-000000000001";

let principal: Principal | null = null;
let roleOnWorkbook: WorkbookRole | null = null;

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("APP_URL", "http://127.0.0.1:47330");
  vi.stubEnv("DATABASE_URL", "postgresql://u:p@127.0.0.1:47322/jdsheets_test");
  vi.stubEnv("COLLAB_URL", "http://127.0.0.1:47331");
  vi.stubEnv("COLLAB_TOKEN_SECRET", "test-only-collab-secret-0123456789abcdef");
  vi.stubEnv("INTERNAL_SERVICE_TOKEN", TOKEN);
  vi.stubEnv("AUTH_SECRET", "test-only-auth-secret-0123456789abcdef0123");
  vi.stubEnv("WORKBOOK_VALIDATOR", "fake");
  vi.stubEnv("STORAGE_DRIVER", "local");
  vi.stubEnv("STORAGE_LOCAL_DIR", "./storage/test");
  principal = null;
  roleOnWorkbook = null;
  configureWorkbookRoleResolver(async () => roleOnWorkbook);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function load() {
  const { route } = await import("../route");
  const { setPrincipalResolverForTests } = await import("@/shared/rbac/principalResolver");
  setPrincipalResolverForTests(async () => principal);
  return route;
}

const member: Principal = fakePrincipal({ role: "MEMBER" });
const superAdmin: Principal = fakePrincipal({ role: "SUPER_ADMIN" });

describe("route() envelope and errors", () => {
  it("wraps the handler result in { data } with its status and a request ID", async () => {
    const route = await load();
    const handler = route({ access: "public", handler: async () => ({ status: 201, data: 1 }) });
    const result = await callRoute(handler, { path: "/api/x" });
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ data: 1 });
    expect(result.headers.get("x-request-id")).toMatch(/[0-9a-f-]{36}/);
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("turns a thrown AppError into the envelope with the same request ID", async () => {
    const route = await load();
    const handler = route({
      access: "public",
      handler: async () => {
        throw new AppError("NOT_FOUND");
      },
    });
    const result = await callRoute(handler, { path: "/api/x" });
    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: ERROR_CATALOG.NOT_FOUND.message,
        requestId: result.headers.get("x-request-id"),
      },
    });
  });

  it("turns an unexpected error into INTERNAL without leaking it (P0-ERR-01)", async () => {
    const route = await load();
    const handler = route({
      access: "public",
      handler: async () => {
        throw new Error("SELECT * FROM secrets failed at prisma.ts:12");
      },
    });
    const result = await callRoute(handler, { path: "/api/x" });
    expect(result.status).toBe(500);
    const text = JSON.stringify(result.body);
    expect(text).not.toMatch(/SELECT|prisma|secrets/);
    expect(result.body).toMatchObject({ error: { code: "INTERNAL" } });
  });

  it("parses the body with the input schema; failures are VALIDATION_FAILED (P0-ERR-02)", async () => {
    const route = await load();
    const handler = route({
      access: "public",
      input: z.object({ name: z.string().min(1, { error: "Enter a name." }) }),
      handler: async ({ input }) => ({ data: input.name }),
    });
    const ok = await callRoute(handler, { method: "POST", path: "/api/x", body: { name: "Asha" } });
    expect(ok.body).toEqual({ data: "Asha" });
    const bad = await callRoute(handler, { method: "POST", path: "/api/x", body: { name: "" } });
    expect(bad.body).toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        fieldErrors: [{ field: "name", message: "Enter a name." }],
      },
    });
  });

  it("rejects malformed JSON as VALIDATION_FAILED (P0-ERR-03)", async () => {
    const route = await load();
    const handler = route({
      access: "public",
      input: z.object({}),
      handler: async () => ({ data: 1 }),
    });
    const response = await handler(
      new Request("http://127.0.0.1/api/x", { method: "POST", body: "{not json" }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(400);
  });

  it("refuses a body over the JSON limit (X-INPUT-09)", async () => {
    const route = await load();
    const { MAX_JSON_BODY_BYTES } = await import("../route");
    const handler = route({
      access: "public",
      input: z.object({}),
      handler: async () => ({ data: 1 }),
    });
    const response = await handler(
      new Request("http://127.0.0.1/api/x", {
        method: "POST",
        body: JSON.stringify({ big: "x".repeat(MAX_JSON_BODY_BYTES) }),
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(413);
  });

  it("refuses a write from another website", async () => {
    const route = await load();
    const handler = route({ access: "public", handler: async () => ({ data: 1 }) });
    const result = await callRoute(handler, {
      method: "POST",
      path: "/api/x",
      headers: { origin: "https://evil.example" },
    });
    expect(result.status).toBe(403);
    const same = await callRoute(handler, {
      method: "POST",
      path: "/api/x",
      headers: { origin: "http://127.0.0.1:47330" },
    });
    expect(same.status).toBe(200);
  });
});

describe("route() access (P0-ACC-02, P0-ACC-04)", () => {
  it("answers 401 to a signed-out caller and 403 without the permission, with no code in the body", async () => {
    const route = await load();
    const handler = route({
      access: { permission: "users:view" },
      handler: async () => ({ data: 1 }),
    });
    expect((await callRoute(handler, { path: "/api/x" })).status).toBe(401);
    principal = member;
    const refused = await callRoute(handler, { path: "/api/x" });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).not.toContain("users:view");
    principal = superAdmin;
    expect((await callRoute(handler, { path: "/api/x" })).status).toBe(200);
  });

  it("allows an internal route only with the right service token", async () => {
    const route = await load();
    principal = superAdmin; // a signed-in person is not enough
    const handler = route({ access: "internal", handler: async () => ({ data: 1 }) });
    expect((await callRoute(handler, { path: "/api/internal/x" })).status).toBe(401);
    const wrong = await callRoute(handler, {
      path: "/api/internal/x",
      headers: { "x-internal-token": "test-only-internal-token-0123456789abcdeX" },
    });
    expect(wrong.status).toBe(401);
    const right = await callRoute(handler, {
      path: "/api/internal/x",
      headers: { "x-internal-token": TOKEN },
    });
    expect(right.status).toBe(200);
  });
});

describe("route() workbook roles (X-ACCESS-05, X-INPUT-07)", () => {
  const workbookRoute = async (capability: "read" | "edit" | "share") => {
    const route = await load();
    return route<string, undefined, { id: string }>({
      access: "authenticated",
      workbook: { param: "id", capability },
      handler: async ({ workbookRole }) => ({ data: String(workbookRole) }),
    });
  };

  it("gives NOT_FOUND, not FORBIDDEN, when the caller has no role", async () => {
    principal = superAdmin; // the bypass does not grant workbook roles (Decision 17)
    const handler = await workbookRoute("read");
    const result = await callRoute(handler, { path: "/api/w", params: { id: WORKBOOK } });
    expect(result.status).toBe(404);
  });

  it("gives NOT_FOUND for a malformed ID", async () => {
    principal = member;
    roleOnWorkbook = "OWNER";
    const handler = await workbookRoute("read");
    const result = await callRoute(handler, { path: "/api/w", params: { id: "not-a-uuid" } });
    expect(result.status).toBe(404);
  });

  it("gives FORBIDDEN when the role lacks the capability, and passes the role on success", async () => {
    principal = member;
    roleOnWorkbook = "VIEWER";
    const edit = await workbookRoute("edit");
    expect((await callRoute(edit, { path: "/api/w", params: { id: WORKBOOK } })).status).toBe(403);
    const read = await workbookRoute("read");
    const ok = await callRoute(read, { path: "/api/w", params: { id: WORKBOOK } });
    expect(ok.body).toEqual({ data: "VIEWER" });
  });
});
