import type { ReactNode } from "react";
import { Wordmark } from "./wordmark";

type Area = "/account" | "/work" | "/admin";

const AREA_LABEL: Record<Area, string> = {
  "/account": "My cleans",
  "/work": "Cleaner",
  "/admin": "Admin",
};

/**
 * Frame for the three signed-in apps. Same brand as the site, quieter: the content
 * is the point. The bar stays put on phones so sign-out and the app name are always
 * one reach away.
 */
export function AppShell({ area, who, children }: { area: Area; who: string; children: ReactNode }) {
  const isAdmin = area === "/admin";
  return (
    <div className="min-h-dvh bg-paper">
      <header
        className={
          isAdmin
            ? "sticky top-0 z-30 border-b border-line-dark bg-ink text-paper"
            : "sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/75"
        }
      >
        <div className="mx-auto flex h-18 max-w-[88rem] items-center gap-4 px-5 sm:px-8 lg:px-12">
          <Wordmark href={area} tone={isAdmin ? "paper" : "ink"} />
          <span className={isAdmin ? "rounded-full bg-signal px-2.5 py-0.5 text-xs font-bold text-ink" : "hidden text-sm font-semibold text-ink-3 sm:inline"}>
            {AREA_LABEL[area]}
          </span>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <span className={isAdmin ? "hidden text-sm text-paper/70 sm:inline" : "hidden text-sm text-ink-2 sm:inline"}>{who}</span>
            <form action="/logout" method="post">
              <button
                type="submit"
                className={
                  isAdmin
                    ? "min-h-12 rounded-full px-4 text-sm font-semibold text-paper hover:bg-white/10"
                    : "min-h-12 rounded-full px-4 text-sm font-semibold text-ink hover:bg-paper-2"
                }
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[88rem] px-5 pb-24 pt-10 sm:px-8 sm:pt-14 lg:px-12">{children}</main>
    </div>
  );
}
