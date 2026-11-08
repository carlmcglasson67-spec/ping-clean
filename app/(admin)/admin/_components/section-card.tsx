import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

const TONE = {
  bad: "bg-bad-soft ring-bad/30",
  warn: "bg-warn-soft ring-warn/25",
} as const;

/** A number that needs someone, as one big link into the section that deals with it. */
export function SectionCard({
  href,
  label,
  value,
  note,
  cta,
  tone,
}: {
  href: Route | `${Route}#${string}`;
  label: string;
  value: ReactNode;
  note?: ReactNode;
  cta: string;
  tone?: keyof typeof TONE;
}) {
  return (
    <Link
      href={href as Route}
      className={cn(
        "group grid min-h-48 content-between gap-6 rounded-lg p-6 shadow-card ring-1 transition-[box-shadow,transform] duration-200 ease-out-soft hover:-translate-y-0.5 hover:shadow-lift sm:p-7",
        tone ? TONE[tone] : "bg-card ring-line/70",
      )}
    >
      <div className="grid gap-2">
        <span className="text-sm font-semibold text-navy">{label}</span>
        <span className="font-display text-3xl font-semibold tabular">{value}</span>
        {note ? <span className="text-sm text-navy-2">{note}</span> : null}
      </div>
      <span className={cn("inline-flex items-center gap-2 text-sm font-semibold", tone ? "text-navy" : "text-blue")}>
        {cta}
        <svg viewBox="0 0 16 16" className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden>
          <path d="M3 8h9m-3.5-4L12 8l-3.5 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </Link>
  );
}
