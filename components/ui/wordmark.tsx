import Link from "next/link";
import { cn } from "./cn";

/**
 * Typeset wordmark until a real logo exists (open question in intent/v1/spec.md).
 * "ping" with the signal dot as the tittle of the i.
 */
export function Wordmark({ href = "/", tone = "ink", className }: { href?: "/" | "/account" | "/work" | "/admin"; tone?: "ink" | "paper"; className?: string }) {
  return (
    <Link
      href={href}
      aria-label="Ping Clean home"
      className={cn(
        "group inline-flex items-baseline gap-1.5 font-display text-[1.65rem] font-bold leading-none tracking-[-0.045em]",
        tone === "ink" ? "text-ink" : "text-paper",
        className,
      )}
    >
      <span className="relative">
        p<span className="relative">ı<span className="absolute left-1/2 top-[0.02em] size-[0.2em] -translate-x-1/2 rounded-full bg-signal transition-transform duration-300 group-hover:-translate-y-0.5" /></span>ng
      </span>
      <span className={cn("text-[0.62em] font-semibold tracking-[-0.02em]", tone === "ink" ? "text-ink-3" : "text-paper/60")}>clean</span>
    </Link>
  );
}
