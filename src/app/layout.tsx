import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { APP_CONFIG } from "@/shared/config/appConfig";
import "./globals.css";

// Pages are rendered per request, so each gets its own content-security-policy nonce
// (src/proxy.ts); a prerendered page could not carry one and its scripts would be blocked.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: APP_CONFIG.product.name, template: `%s · ${APP_CONFIG.product.name}` },
  description: `${APP_CONFIG.company.legalName}'s spreadsheets`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
