import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "signal" | "ink" | "secondary" | "ghost" | "onNavy" | "danger";
type Size = "md" | "lg" | "xl";

// Every size is at least 48px tall: thumb-sized, usable with wet hands.
const sizes: Record<Size, string> = {
  md: "min-h-12 px-5 text-base gap-2",
  lg: "min-h-14 px-7 text-lg gap-2.5",
  xl: "min-h-16 px-9 text-xl gap-3",
};

// Contrast (WCAG AA, tested in tokens.test.ts):
//   primary    white on brand blue        5.8:1  (on light surfaces)
//   signal     navy on teal               7.7:1  (the action on navy surfaces)
//   ink        white on navy             16.7:1
//   onNavy     white on raised navy      14.2:1  (quiet action on navy)
const variants: Record<Variant, string> = {
  primary:
    "bg-blue text-white shadow-[0_1px_0_rgb(0_29_68/0.2),0_10px_24px_-12px_rgb(0_82_254/0.7)] hover:bg-blue-press active:bg-navy",
  signal: "bg-teal text-navy shadow-glow hover:bg-teal-glow active:bg-teal-deep active:text-white",
  ink: "bg-navy text-white hover:bg-navy-800 active:bg-navy-950",
  secondary: "bg-card text-navy ring-1 ring-inset ring-line hover:ring-navy-3 active:bg-mist",
  ghost: "text-navy hover:bg-mist active:bg-line/60",
  onNavy: "bg-white/8 text-white ring-1 ring-inset ring-white/25 hover:bg-white/14 hover:ring-teal/70 active:bg-white/20",
  danger: "bg-bad text-white hover:bg-[#9c1f18]",
};

const base =
  "inline-flex items-center justify-center rounded-full font-semibold tracking-[-0.01em] whitespace-nowrap " +
  "transition-[background-color,box-shadow,color,transform] duration-200 ease-out-soft active:scale-[0.98] " +
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
