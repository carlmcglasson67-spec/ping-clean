import type { ReactNode } from "react";
import { Wordmark } from "./logo";

type Area = "/account" | "/work" | "/admin";

const AREA_LABEL: Record<Area, string> = {
  "/account": "My cleans",
  "/work": "Cleaner",
  "/admin": "Admin",
};

/**
 * Frame for the three signed-in apps. Same brand as the site, quieter: the content is the
 * point. Customers and cleaners get a light bar on the canvas; the Ping team works under a
 * deep navy bar, so it's always obvious which side of the counter you're on. The bar stays
 * put on phones so sign-out and the app name are always one reach away.
 */
export function AppShell({ area, who, children }: { area: Area; who: string; children: ReactNode }) {
  const isAdmin = area === "/admin";
  return (
    <div className="min-h-dvh bg-canvas">
      <header
        className={
          isAdmin
            ? "sticky top-0 z-30 border-b border-line-navy bg-navy-950 text-on-navy"
            : "sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur supports-[backdrop-filter]:bg-canvas/75"
        }
      >
        <div className="mx-auto flex h-18 max-w-[88rem] items-center gap-4 px-5 sm:px-8 lg:px-12">
          <Wordmark href={area} tone={isAdmin ? "paper" : "ink"} className="text-[1.45rem] sm:text-[1.6rem]" />
          <span
            className={
              isAdmin
                ? "rounded-full bg-teal px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.1em] text-navy"
                : "hidden border-l border-line pl-4 text-sm font-semibold text-navy-3 sm:inline"
            }
          >
            {AREA_LABEL[area]}
          </span>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <span className={isAdmin ? "hidden text-sm text-on-navy-2 sm:inline" : "hidden text-sm text-navy-2 sm:inline"}>{who}</span>
            <form action="/logout" method="post">
              <button
                type="submit"
                className={
                  isAdmin
                    ? "min-h-12 whitespace-nowrap rounded-full px-4 text-sm font-semibold text-on-navy hover:bg-white/10"
                    : "min-h-12 whitespace-nowrap rounded-full px-4 text-sm font-semibold text-navy hover:bg-mist"
                }
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        {isAdmin ? <div aria-hidden className="h-px bg-[linear-gradient(90deg,var(--color-blue),var(--color-teal),transparent)]" /> : null}
      </header>
      <main className="mx-auto max-w-[88rem] px-5 pb-24 pt-10 sm:px-8 sm:pt-14 lg:px-12">{children}</main>
    </div>
  );
}
