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
};

export const viewport: Viewport = {
  themeColor: "#f5f1e8",
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
