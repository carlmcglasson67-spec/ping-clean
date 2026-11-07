import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { display, text } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "Ping Clean · Regular home cleaning in West Cumbria",
    template: "%s · Ping Clean",
  },
  description:
    "The same vetted, insured cleaner every week. Fixed prices, a checklist and photos on every clean. Workington, Whitehaven, Cockermouth and across West Cumbria.",
  applicationName: "Ping Clean",
  // Icons come from app/icon.svg, app/apple-icon.png and app/favicon.ico (scripts/brand/).
};

export const viewport: Viewport = {
  themeColor: "#f2f1f1",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" className={`${display.variable} ${text.variable}`}>
      <body>{children}</body>
    </html>
  );
}
