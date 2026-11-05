import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";
import {
  API_CONTENT_SECURITY_POLICY,
  EDITOR_SECURITY_HEADERS,
  STATIC_SECURITY_HEADERS,
  editorContentSecurityPolicy,
} from "./src/shared/http/securityHeaders";

/** Hashes of the inline scripts in the built editor (written by scripts/editor-build.mjs). */
function editorScriptHashes(): string[] {
  const file = path.join(process.cwd(), "public/editor/build-info.json");
  if (!existsSync(file)) return [];
  const info = JSON.parse(readFileSync(file, "utf8")) as { scriptHashes?: string[] };
  return info.scriptHashes ?? [];
}

const nextConfig: NextConfig = {
  // Production image runs .next/standalone/server.js (W-015).
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/((?!editor/).*)", headers: STATIC_SECURITY_HEADERS },
      {
        source: "/editor/:path*",
        headers: [
          ...EDITOR_SECURITY_HEADERS,
          { key: "Content-Security-Policy", value: editorContentSecurityPolicy(editorScriptHashes()) },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Content-Security-Policy", value: API_CONTENT_SECURITY_POLICY }],
      },
    ];
  },
  async rewrites() {
    // /editor/ serves the built editor's index.html (Next.js does not map folders to index files).
    return [{ source: "/editor", destination: "/editor/index.html" }, { source: "/editor/", destination: "/editor/index.html" }];
  },
};

export default nextConfig;
