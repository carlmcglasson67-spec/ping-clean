import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { STANDARD_CLEAN } from "../_content/checklist";

/** The small uppercase label above a section title. */
export function Eyebrow({ children, tone = "signal", className }: { children: ReactNode; tone?: "signal" | "muted" | "onInk"; className?: string }) {
  const color = tone === "signal" ? "text-teal-ink" : tone === "onInk" ? "text-teal" : "text-navy-2";
  return <p className={cn("text-sm font-semibold uppercase tracking-[0.16em]", color, className)}>{children}</p>;
}

/** Page-top breadcrumb. The last item is the current page. */
export function Crumbs({ items }: { items: { href?: Route; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-base font-semibold text-navy-3">
        {items.map((c, i) => (
          <li key={c.label} className="flex items-center gap-2">
            {c.href ? (
              <Link href={c.href} className="inline-flex min-h-12 items-center hover:text-navy">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-navy">
                {c.label}
              </span>
            )}
            {i < items.length - 1 ? <span aria-hidden>/</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Numbered steps with oversized signal numerals. */
export function StepList({ steps, tone = "paper" }: { steps: { title: string; body: string }[]; tone?: "paper" | "ink" }) {
  return (
    <ol className="grid content-start">
      {steps.map((s, i) => (
        <li
          key={s.title}
          className={cn(
            "grid grid-cols-[4.5rem_1fr] gap-x-4 border-t py-9 first:border-t-0 first:pt-0 sm:grid-cols-[6rem_1fr]",
            tone === "ink" ? "border-line-navy" : "border-line",
          )}
        >
          <span className={cn("font-display text-[3.25rem] font-semibold leading-none tabular sm:text-[4rem]", tone === "ink" ? "text-teal" : "text-teal-deep")} aria-hidden>
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="pt-1">
            <h3 className="text-xl font-semibold">
              <span className="sr-only">Step {i + 1}: </span>
              {s.title}
            </h3>
            <p className={cn("mt-3 text-lg", tone === "ink" ? "text-on-navy-2" : "text-navy-2")}>{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The standard clean, room by room, as raised cards. */
export function ChecklistGrid({ className }: { className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:gap-5", className)}>
      {STANDARD_CLEAN.map((r) => (
        <article key={r.room} className="rounded-lg bg-card p-8 shadow-card ring-1 ring-line/70 lg:p-10">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-xl font-semibold">{r.room}</h3>
            <span className="whitespace-nowrap text-sm font-semibold text-navy-3 tabular">
              {r.items.length} {r.items.length === 1 ? "tick" : "ticks"}
            </span>
          </div>
          <ul className="mt-6 grid gap-4">
            {r.items.map((item) => (
              <li key={item} className="grid grid-cols-[1.75rem_1fr] gap-3 text-lg text-navy-2">
                <Tick />
                {item}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

export function Tick({ tone = "ok" }: { tone?: "ok" | "ink" }) {
  return (
    <span aria-hidden className={cn("mt-1 grid size-6 place-items-center rounded-full", tone === "ok" ? "bg-ok-soft text-ok" : "bg-navy/10 text-navy")}>
      <svg viewBox="0 0 20 20" className="size-3.5">
        <path d="m5 10.5 3.2 3L15 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Concentric rings: the Ping signal, used as a quiet graphic on dark panels. */
export function Rings({ className, dot = false }: { className?: string; dot?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 600 600" className={cn("pointer-events-none absolute", className)}>
      {[80, 150, 220, 290].map((r) => (
        <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" />
      ))}
      {dot ? <circle cx="300" cy="300" r="22" className="fill-teal" /> : null}
    </svg>
  );
}
