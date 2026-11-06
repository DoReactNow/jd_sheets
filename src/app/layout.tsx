import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { APP_CONFIG } from "@/shared/config/appConfig";
import { pageNetworkAllowed } from "@/shared/http/pageAccess";
import { Blocked } from "@/shared/ui/Blocked";
import "./globals.css";

// Pages are rendered per request, so each gets its own content-security-policy nonce
// (src/proxy.ts) and its own network check (Decision 46).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: APP_CONFIG.product.name, template: `%s · ${APP_CONFIG.product.name}` },
  description: `${APP_CONFIG.company.legalName}'s spreadsheets`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const allowed = await pageNetworkAllowed();
  return (
    <html lang="en">
      <body>{allowed ? children : <Blocked />}</body>
    </html>
  );
}
