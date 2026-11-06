// Gives every page a fresh nonce and a content security policy. Next.js reads the nonce from the
// request's policy and puts it on its own scripts. API routes and the static editor files stay out;
// their fixed headers come from next.config.ts. Phase 1 adds the IP rules here (Decision 18).
import { NextResponse, type NextRequest } from "next/server";
import { createNonce, pageContentSecurityPolicy } from "@/shared/http/securityHeaders";

/** The live editing WebSocket's origin (Phase 3): COLLAB_PUBLIC_URL, or COLLAB_URL as ws://. */
function liveOrigin(): string[] {
  // The proxy runs before the app's env module; it only reads these two addresses.
  // eslint-disable-next-line no-restricted-properties
  const configured =
    process.env.COLLAB_PUBLIC_URL ?? process.env.COLLAB_URL?.replace(/^http/, "ws");
  if (!configured) return [];
  try {
    return [new URL(configured).origin.replace(/^http/, "ws")];
  } catch {
    return [];
  }
}

export function proxy(request: NextRequest) {
  const policy = pageContentSecurityPolicy(createNonce(), {
    // Set by Next.js itself and not part of the app's environment schema.
    // eslint-disable-next-line no-restricted-properties
    development: process.env.NODE_ENV === "development",
    connect: liveOrigin(),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  // The page path, for the root layout's network check (only sign-in is open to every network).
  requestHeaders.set("x-jd-path", request.nextUrl.pathname);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|editor|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
