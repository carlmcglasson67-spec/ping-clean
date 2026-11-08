import type { ReactNode } from "react";
import { cn } from "@/components/ui";

/**
 * An art-directed stand-in for a photograph that doesn't exist yet.
 *
 * Each one is a named slot (data-photo) with a tone, soft window light, fine grain
 * and a caption, so the page reads as designed today and the real shot drops into the
 * same frame later. The PR lists every slot with its subject, crop and size.
 */
type Tone = "navy" | "deep" | "steel" | "mist" | "cloud" | "teal";

// Brand placeholders, built only from the tokens in app/globals.css: navy frames for the
// moody shots, mist and cloud for bright rooms, teal for the odd accent.
const mix = (token: string, pct: number) => `color-mix(in srgb, var(--color-${token}) ${pct}%, transparent)`;
const tones: Record<Tone, { bg: string; light: string; line: string; text: string }> = {
  navy: { bg: "bg-[linear-gradient(160deg,var(--color-navy-800)_0%,var(--color-navy-900)_50%,var(--color-navy-950)_100%)]", light: mix("blue-bright", 30), line: mix("teal", 16), text: "text-on-navy" },
  deep: { bg: "bg-[linear-gradient(160deg,var(--color-teal-ink)_0%,var(--color-navy-900)_70%,var(--color-navy-950)_100%)]", light: mix("teal-glow", 22), line: mix("teal", 18), text: "text-on-navy" },
  steel: { bg: "bg-[linear-gradient(170deg,var(--color-navy-3)_0%,var(--color-navy-2)_55%,var(--color-navy)_100%)]", light: mix("on-navy-2", 35), line: mix("card", 10), text: "text-on-navy" },
  mist: { bg: "bg-[linear-gradient(165deg,var(--color-card)_0%,var(--color-mist)_55%,var(--color-line)_100%)]", light: mix("card", 80), line: mix("navy", 7), text: "text-navy" },
  cloud: { bg: "bg-[linear-gradient(165deg,var(--color-card)_0%,var(--color-canvas)_50%,var(--color-teal-soft)_100%)]", light: mix("card", 70), line: mix("navy", 6), text: "text-navy" },
  teal: { bg: "bg-[linear-gradient(160deg,var(--color-teal-glow)_0%,var(--color-teal)_45%,var(--color-teal-deep)_100%)]", light: mix("card", 40), line: mix("navy", 10), text: "text-navy" },
};

export function Photo({
  slot,
  caption,
  tone = "navy",
  className,
  children,
  priority = false,
  captionSide = "left",
}: {
  /** Stable name for the photo Carl supplies, e.g. "home-hero-kitchen". */
  slot: string;
  caption: string;
  tone?: Tone;
  className?: string;
  children?: ReactNode;
  priority?: boolean;
  /** "right" keeps two captions apart when frames overlap, as in the before/after. */
  captionSide?: "left" | "right";
}) {
  const t = tones[tone];
  return (
    <figure
      data-photo={slot}
      data-priority={priority || undefined}
      className={cn("relative isolate overflow-hidden rounded-lg", t.bg, t.text, className)}
    >
      {/* Grain sits on its own layer: the utility sets background-image, which would
          otherwise replace the tone gradient. */}
      <div aria-hidden className="grain absolute inset-0" />
      {/* Window light falling across the frame. */}
      <div
        aria-hidden
        className="absolute -left-1/4 -top-1/3 h-[140%] w-[90%] rotate-[18deg] blur-2xl"
        style={{ background: `linear-gradient(90deg, transparent, ${t.light} 45%, transparent)` }}
      />
      {/* Fine architectural lines: a frame inside the frame. */}
      <svg aria-hidden className="absolute inset-0 size-full" preserveAspectRatio="none" viewBox="0 0 100 100">
        <line x1="0" y1="72" x2="100" y2="72" style={{ stroke: t.line }} strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        <line x1="62" y1="0" x2="62" y2="72" style={{ stroke: t.line }} strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        <rect x="8" y="10" width="40" height="46" fill="none" style={{ stroke: t.line }} strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
      </svg>
      {children}
      <figcaption
        className={cn(
          "absolute bottom-4 flex items-center gap-2 text-sm font-semibold sm:bottom-5",
          captionSide === "left" ? "left-4 max-w-[calc(100%-2rem)] sm:left-5" : "right-4 max-w-[calc(50%-1.5rem)] justify-end text-right sm:right-5",
        )}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
        <span className="opacity-85">{caption}</span>
      </figcaption>
    </figure>
  );
}
