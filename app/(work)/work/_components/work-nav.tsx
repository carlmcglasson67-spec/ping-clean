"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

type Item = { href: Route; label: string; icon: ReactNode; activeOnly?: boolean; applicantLabel?: string; also?: string[] };

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
    href: "/work/today",
    label: "Today",
    activeOnly: true,
    also: ["/work/visit"],
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <rect {...stroke} x="4" y="5.5" width="16" height="14.5" rx="2" />
        <path {...stroke} d="M4 10h16M8.5 3.5v4m7-4v4" />
        <path {...stroke} d="m9.5 14.75 1.75 1.75 3.5-3.5" />
      </svg>
    ),
  },
  {
    href: "/work/calendar",
    label: "Calendar",
    activeOnly: true,
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <rect {...stroke} x="4" y="5.5" width="16" height="14.5" rx="2" />
        <path {...stroke} d="M4 10h16M8.5 3.5v4m7-4v4" />
        <path {...stroke} d="M8 13.5h2m3 0h2m-7 3h2m3 0h2" />
      </svg>
    ),
  },
  {
    href: "/work/jobs",
    label: "Jobs",
    activeOnly: true,
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <circle {...stroke} cx="12" cy="12" r="2.5" />
        <path {...stroke} d="M7.05 7.05a7 7 0 0 0 0 9.9m9.9 0a7 7 0 0 0 0-9.9M4.2 4.2a11 11 0 0 0 0 15.6m15.6 0a11 11 0 0 0 0-15.6" />
      </svg>
    ),
  },
  {
    href: "/work/you",
    label: "You",
    also: ["/work/details", "/work/documents", "/work/areas"],
    icon: (
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <circle {...stroke} cx="12" cy="8.5" r="3.75" />
        <path {...stroke} d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
      </svg>
    ),
  },
];

/** True when `path` is this tab, a page inside it, or one of the pages it groups. Home only matches itself. */
function isCurrent(item: Item, path: string) {
  const under = (base: string) => path === base || path.startsWith(`${base}/`);
  return item.href === "/work" ? path === "/work" : under(item.href) || (item.also ?? []).some(under);
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
    const current = isCurrent(i, path);
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
            variant === "bar" && (current ? "text-navy" : "text-navy-3"),
            variant === "tabs" && (current ? "bg-navy text-on-navy" : "text-navy-2 hover:bg-mist"),
          )}
        >
          <span className={cn("relative", variant === "bar" && current && "text-teal-ink")}>
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
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-canvas/85 sm:hidden"
      >
        <ul className="mx-auto flex max-w-lg">{items.map((i) => link(i, "bar"))}</ul>
      </nav>
    </>
  );
}
