// Security headers. Pages get a policy with a fresh nonce from src/proxy.ts; the API, the static
// editor files (/editor/) and everything else get fixed headers from next.config.ts.
// Browsers ignore HSTS over plain http, so it is safe locally.

export function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function pageContentSecurityPolicy(
  nonce: string,
  { development, connect = [] }: { development: boolean; connect?: string[] },
): string {
  return [
    "default-src 'self'",
    // React's debugging needs eval in development only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    // React writes style attributes into the page, which a nonce can't cover.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // Live editing's WebSocket to the Rust service (Phase 3), when it is on another origin.
    `connect-src 'self'${connect.map((origin) => ` ${origin}`).join("")}`,
    // The editor page frames our own GridCraft build, nothing else (Decision 7).
    "frame-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * The GridCraft editor files (/editor/). WebAssembly needs 'wasm-unsafe-eval'; trunk's loader is
 * one inline module script, allowed by its hash (filled in from the built index.html, see
 * editorScriptHashes). Only our own pages may frame it.
 */
export function editorContentSecurityPolicy(scriptHashes: readonly string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval'${scriptHashes.map((hash) => ` '${hash}'`).join("")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}

export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";

const COMMON_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    key: "Permissions-Policy",
    value: "microphone=(), camera=(), geolocation=(), payment=(), usb=()",
  },
];

/** Every response except the editor files: nobody may frame us. */
export const STATIC_SECURITY_HEADERS = [
  ...COMMON_HEADERS,
  { key: "X-Frame-Options", value: "DENY" },
];

/** The editor files: only our own pages may frame them. */
export const EDITOR_SECURITY_HEADERS = [
  ...COMMON_HEADERS,
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
];
