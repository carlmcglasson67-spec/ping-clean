"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

type Item = { href: Route; label: string; icon: ReactNode; activeOnly?: boolean; applicantLabel?: string };

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ITEMS: Item[] = [
  {
    href: "/work",
    label: "Home",
    applicantLabel: "Application",
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <path {...stroke} d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
      </svg>
    ),
  },
  {
    href: "/work/you",
    label: "You",
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <circle {...stroke} cx="12" cy="8.5" r="3.75" />
        <path {...stroke} d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
      </svg>
    ),
  },
];

/** True when `path` is this tab or a page inside it. Home only matches itself. */
function isCurrent(href: string, path: string) {
  return href === "/work" ? path === "/work" : path === href || path.startsWith(`${href}/`);
}

/**
 * The cleaner app's tabs. On a phone they sit in a bar at the bottom of the screen,
 * where a thumb already is; on a desktop they run along the top of the page.
 * Every tab is at least 56px tall.
 */
export function WorkNav({ active }: { active: boolean }) {
  const path = usePathname();
  const items = ITEMS.filter((i) => active || !i.activeOnly);

  const link = (i: Item, variant: "bar" | "tabs") => {
    const current = isCurrent(i.href, path);
    const label = !active && i.applicantLabel ? i.applicantLabel : i.label;
    return (
      <li key={i.href} className={variant === "bar" ? "flex-1" : undefined}>
        <Link
          href={i.href}
          aria-current={current ? "page" : undefined}
          className={cn(
            variant === "bar"
              ? "flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors"
              : "inline-flex min-h-12 items-center gap-2.5 rounded-full px-5 text-base font-semibold transition-colors",
            variant === "bar" && (current ? "text-ink" : "text-ink-3"),
            variant === "tabs" && (current ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2"),
          )}
        >
          <span className={cn("relative", variant === "bar" && current && "text-signal-ink")}>
            {i.icon}
          </span>
          {label}
        </Link>
      </li>
    );
  };

  return (
    <>
      <nav aria-label="Cleaner app" className="-mt-4 mb-10 hidden sm:block">
        <ul className="flex flex-wrap gap-2">{items.map((i) => link(i, "tabs"))}</ul>
      </nav>
      <nav
        aria-label="Cleaner app"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-paper/85 sm:hidden"
      >
        <ul className="mx-auto flex max-w-lg">{items.map((i) => link(i, "bar"))}</ul>
      </nav>
    </>
  );
}
