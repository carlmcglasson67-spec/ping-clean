import type { ReactNode } from "react";
import { SiteFooter } from "./_components/site-footer";
import { SiteHeader } from "./_components/site-header";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-paper">
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-ink px-5 py-3 font-semibold text-paper focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}
