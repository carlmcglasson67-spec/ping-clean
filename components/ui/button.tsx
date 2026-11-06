import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "ink" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "xl";

// Every size is at least 48px tall: thumb-sized, usable with wet hands.
const sizes: Record<Size, string> = {
  md: "min-h-12 px-5 text-base gap-2",
  lg: "min-h-14 px-7 text-lg gap-2.5",
  xl: "min-h-16 px-9 text-xl gap-3",
};

const variants: Record<Variant, string> = {
  // Ink text on signal: 6.3:1 contrast. White on signal would fail AA.
  primary: "bg-signal text-ink hover:bg-[#ff7449] active:bg-[#f04c1d] shadow-[0_1px_0_rgb(17_24_31/0.25)]",
  ink: "bg-ink text-paper hover:bg-[#1d2732] active:bg-black",
  secondary: "bg-card text-ink ring-1 ring-inset ring-line hover:ring-ink-3 active:bg-paper-2",
  ghost: "text-ink hover:bg-paper-2 active:bg-line/60",
  danger: "bg-bad text-white hover:bg-[#9c1f18]",
};

const base =
  "inline-flex items-center justify-center rounded-full font-semibold tracking-[-0.01em] whitespace-nowrap " +
  "transition-[background-color,box-shadow,transform] duration-200 ease-out-soft active:scale-[0.98] " +
  "disabled:pointer-events-none disabled:opacity-50 select-none";

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cn(base, sizes[size], variants[variant], extra);
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  pending?: boolean;
  icon?: ReactNode;
};

export function Button({ variant, size, pending, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClass(variant, size, className)}
    >
      {pending ? <Spinner /> : icon}
      <span>{children}</span>
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & { variant?: Variant; size?: Size; icon?: ReactNode };

export function ButtonLink({ variant, size, icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link {...rest} className={buttonClass(variant, size, className)}>
      {icon}
      <span>{children}</span>
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-5 animate-spin", className)}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
