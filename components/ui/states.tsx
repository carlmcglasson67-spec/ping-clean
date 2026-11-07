import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * Designed empty state. Every list in every app uses this instead of a blank space:
 * say what will appear here, and what (if anything) to do about it.
 */
export function EmptyState({
  title,
  children,
  action,
  icon = <PingMark />,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid justify-items-start gap-4 rounded-lg bg-paper-2/70 p-7 ring-1 ring-inset ring-line sm:p-9", className)}>
      <div className="text-ink-3">{icon}</div>
      <h3 className="text-xl font-semibold">{title}</h3>
      {children ? <div className="max-w-prose text-ink-2">{children}</div> : null}
      {action}
    </div>
  );
}

/** Designed error state. Plain words, a way forward, never a stack trace. */
export function ErrorState({ title = "That didn't load", children, action }: { title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="grid justify-items-start gap-4 rounded-lg bg-bad-soft/60 p-7 ring-1 ring-inset ring-bad/25 sm:p-9">
      <svg viewBox="0 0 24 24" className="size-7 text-bad" aria-hidden>
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v6m0 3.5v.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <h3 className="text-xl font-semibold">{title}</h3>
      <div className="max-w-prose text-ink-2">
        {children ?? "It's probably a weak signal. Try again, and if it keeps happening, call the Ping office."}
      </div>
      {action}
    </div>
  );
}

/** The Ping mark: a dot with a signal ring. */
export function PingMark({ className, pulse = false, dot = "signal" }: { className?: string; pulse?: boolean; dot?: "signal" | "ink" }) {
  const dotClass = dot === "ink" ? "bg-ink" : "bg-signal";
  return (
    <span className={cn("relative inline-grid size-7 place-items-center", className)} aria-hidden>
      {pulse ? <span className={cn("ping-pulse absolute inset-1.5 rounded-full", dotClass)} /> : null}
      <span className="absolute inset-0 rounded-full ring-2 ring-current opacity-30" />
      <span className={cn("relative size-2.5 rounded-full", dotClass)} />
    </span>
  );
}
