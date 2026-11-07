import type { ReactNode } from "react";
import { cn } from "@/components/ui";

/**
 * An art-directed stand-in for a photograph that doesn't exist yet.
 *
 * Each one is a named slot (data-photo) with a tone, soft window light, fine grain
 * and a caption, so the page reads as designed today and the real shot drops into the
 * same frame later. The PR lists every slot with its subject, crop and size.
 */
type Tone = "moss" | "ink" | "mist" | "linen" | "signal" | "dusk";

const tones: Record<Tone, { bg: string; light: string; line: string; text: string }> = {
  moss: { bg: "bg-[linear-gradient(160deg,#2c5a49_0%,#23493b_45%,#17322a_100%)]", light: "rgb(255 236 200 / 0.28)", line: "rgb(255 255 255 / 0.07)", text: "text-paper" },
  ink: { bg: "bg-[linear-gradient(160deg,#25313c_0%,#11181f_60%,#0b1015_100%)]", light: "rgb(255 190 150 / 0.20)", line: "rgb(255 255 255 / 0.06)", text: "text-paper" },
  mist: { bg: "bg-[linear-gradient(165deg,#eef3f7_0%,#dbe6ef_50%,#c4d4e1_100%)]", light: "rgb(255 255 255 / 0.75)", line: "rgb(17 24 31 / 0.06)", text: "text-ink" },
  linen: { bg: "bg-[linear-gradient(165deg,#f3ede1_0%,#e6dccb_55%,#d6c9b2_100%)]", light: "rgb(255 255 255 / 0.6)", line: "rgb(17 24 31 / 0.06)", text: "text-ink" },
  signal: { bg: "bg-[linear-gradient(160deg,#ff8a63_0%,#ff5a2b_50%,#e2461a_100%)]", light: "rgb(255 240 220 / 0.45)", line: "rgb(17 24 31 / 0.08)", text: "text-ink" },
  dusk: { bg: "bg-[linear-gradient(170deg,#9aa7b3_0%,#6f7d89_55%,#4c5863_100%)]", light: "rgb(255 226 196 / 0.35)", line: "rgb(255 255 255 / 0.07)", text: "text-paper" },
};

export function Photo({
  slot,
  caption,
  tone = "moss",
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
        <line x1="0" y1="72" x2="100" y2="72" stroke={t.line} strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        <line x1="62" y1="0" x2="62" y2="72" stroke={t.line} strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        <rect x="8" y="10" width="40" height="46" fill="none" stroke={t.line} strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
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
