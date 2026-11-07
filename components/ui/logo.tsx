import Link from "next/link";
import { cn } from "./cn";
import { ARC_WIDTH, ARCS, LETTER_WEIGHT, LETTERS, LOGO_VIEWBOX, MARK_VIEWBOX, SPARKLE } from "./logo-paths";

/**
 * The Ping Clean logo: signal arcs and sparkle, with the PingClean wordmark.
 * Drawn inline from the same paths as public/brand/*.svg (scripts/brand/gen-logo.py), so it
 * is crisp at every size and needs no request. Never retype the name as text instead.
 *
 * colour: "full" works on light and on navy (Carl's banners put it on navy);
 *         "white" for photos, the teal panels and anywhere the full colours fight;
 *         "navy" for single-colour print on light.
 * Size it with height (or font size: it is 1.4em tall by default).
 */
export type LogoColour = "full" | "white" | "navy";

const SINGLE: Record<Exclude<LogoColour, "full">, string> = { white: "#FFFFFF", navy: "#001D44" };

export function Logo({
  colour = "full",
  className,
  title = "Ping Clean",
  decorative = false,
}: {
  colour?: LogoColour;
  className?: string;
  title?: string;
  /** Inside a link or heading that already says "Ping Clean". */
  decorative?: boolean;
}) {
  const one = colour === "full" ? null : SINGLE[colour];
  return (
    <svg
      viewBox={LOGO_VIEWBOX}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : title}
      aria-hidden={decorative || undefined}
      className={cn("block h-[1.4em] w-auto shrink-0", className)}
    >
      <g fill="none" strokeWidth={ARC_WIDTH} strokeLinecap="round">
        {ARCS.map((a) => <path key={a.d} d={a.d} stroke={one ?? a.colour} />)}
      </g>
      <path d={SPARKLE.d} fill={one ?? SPARKLE.colour} />
      {LETTERS.map((l) => (
        <path
          key={l.d}
          d={l.d}
          fill={one ?? l.colour}
          {...(l.stroked ? { stroke: one ?? l.colour, strokeWidth: LETTER_WEIGHT, strokeLinejoin: "round" as const } : {})}
        />
      ))}
    </svg>
  );
}

/** The mark alone (arcs and sparkle): icons, empty states, tight spaces. */
export function LogoMark({ colour = "full", className, title }: { colour?: LogoColour | "current"; className?: string; title?: string }) {
  const one = colour === "full" ? null : colour === "current" ? "currentColor" : SINGLE[colour];
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("block size-[1.6em] shrink-0", className)}
    >
      <g fill="none" strokeWidth={ARC_WIDTH} strokeLinecap="round">
        {ARCS.map((a) => <path key={a.d} d={a.d} stroke={one ?? a.colour} />)}
      </g>
      <path d={SPARKLE.d} fill={one ?? SPARKLE.colour} />
    </svg>
  );
}

type Href = "/" | "/account" | "/work" | "/admin";

/**
 * The logo as a home link, for headers and footers. `tone` is kept from the typeset
 * wordmark it replaces: "ink" = for light backgrounds, "paper" = for navy. Both use the
 * full-colour logo, as on Carl's banners; pass `colour="white"` to override.
 */
export function Wordmark({
  href = "/",
  tone = "ink",
  colour = "full",
  className,
}: {
  href?: Href;
  tone?: "ink" | "paper";
  colour?: LogoColour;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label="Ping Clean home"
      data-tone={tone}
      className={cn("group inline-flex items-center text-[1.65rem] leading-none", className)}
    >
      <Logo colour={colour} decorative className="transition-transform duration-300 ease-out-soft group-hover:-translate-y-px" />
    </Link>
  );
}
