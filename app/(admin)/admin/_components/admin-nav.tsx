"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";

type Item = { href: Route; label: string };

// The console's sections, in the order the day runs: what needs you, who to vet, the jobs,
// the quality check, demand, and the numbers the marketplace runs on.
const ITEMS: Item[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/approvals", label: "Approvals" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/qc", label: "QC" },
  { href: "/admin/interest", label: "Interest" },
  { href: "/admin/settings", label: "Settings" },
];

function isCurrent(href: string, path: string) {
  return href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`);
}

/**
 * Section tabs under the navy bar. One row that scrolls sideways on a phone (the page itself
 * never does), every tab 48px tall, the current one solid navy.
 */
export function AdminNav() {
  const path = usePathname();
  return (
    <nav aria-label="Admin sections" className="-mx-5 -mt-4 mb-10 sm:mx-0 sm:-mt-6">
      <ul className="flex gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:px-0">
        {ITEMS.map((i) => {
          const current = isCurrent(i.href, path);
          return (
            <li key={i.href} className="shrink-0">
              <Link
                href={i.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-12 items-center rounded-full px-5 text-base font-semibold transition-colors",
                  current ? "bg-navy text-on-navy" : "text-navy-2 ring-1 ring-inset ring-line hover:bg-mist hover:text-navy",
                )}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
