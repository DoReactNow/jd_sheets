import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { APP_CONFIG } from "@/shared/config/appConfig";
import "./globals.css";

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
