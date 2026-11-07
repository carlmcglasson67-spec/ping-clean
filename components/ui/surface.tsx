import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

/** Raised white card on the canvas. */
export function Card({ className, ...rest }: ComponentProps<"div">) {
  return <div {...rest} className={cn("rounded-lg bg-card p-6 shadow-card ring-1 ring-line/70 sm:p-7", className)} />;
}

/** A navy statement panel with the signal waves: heroes, confirmations, the big moments. */
export function NavyPanel({ className, ...rest }: ComponentProps<"div">) {
  return <div {...rest} className={cn("signal-waves relative overflow-hidden rounded-xl text-on-navy", className)} />;
}

// "signal" and "ink" are the earlier names, kept so existing pages still work.
type Tone = "neutral" | "teal" | "signal" | "blue" | "ok" | "warn" | "bad" | "navy" | "ink" | "mist";
const tones: Record<Tone, string> = {
  neutral: "bg-mist text-navy-2",
  teal: "bg-teal-soft text-teal-ink",
  signal: "bg-teal-soft text-teal-ink",
  blue: "bg-blue text-white",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  navy: "bg-navy text-white",
  ink: "bg-navy text-white",
  mist: "bg-mist text-navy",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tracking-wide", tones[tone], className)}>
      {children}
    </span>
  );
}

/** A big number with its label. Numbers do the talking. */
export function Stat({ value, label, note, className }: { value: ReactNode; label: string; note?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1", className)}>
      <span className="font-display text-3xl font-semibold tabular">{value}</span>
      <span className="text-sm font-semibold text-navy">{label}</span>
      {note ? <span className="text-sm text-navy-3">{note}</span> : null}
    </div>
  );
}

/** Top of an app screen: eyebrow, title, optional action on the right. */
export function PageHeader({ eyebrow, title, lede, action }: { eyebrow?: string; title: ReactNode; lede?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-6 pb-8 sm:pb-10">
      <div className="grid max-w-3xl gap-3">
        {eyebrow ? (
          <p className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.14em] text-teal-ink">
            <span aria-hidden className="h-px w-8 bg-teal-deep" />
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold">{title}</h1>
        {lede ? <p className="text-lg text-navy-2">{lede}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-mist", className)} />;
}
