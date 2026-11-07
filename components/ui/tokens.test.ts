// Every text/background pair the brand tokens are meant for meets WCAG AA, read from the
// real tokens in app/globals.css (so changing a colour there re-runs this check).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const raw = new Map<string, string>();
for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) raw.set(m[1]!, m[2]!.trim());

function hex(name: string): string {
  const v = raw.get(name);
  if (!v) throw new Error(`No --color-${name} in globals.css`);
  const alias = v.match(/^var\(--color-([a-z0-9-]+)\)$/);
  return alias ? hex(alias[1]!) : v;
}

function luminance(h: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const WHITE = "#ffffff";
const BODY = 4.5;
const LARGE = 3; // 24px+, or 19px+ bold, and icons / UI shapes

// [text, background, minimum]
const PAIRS: Array<[string, string, number]> = [
  // Text on light surfaces
  ...["navy", "navy-2", "navy-3", "teal-ink", "blue"].flatMap((t) => ["canvas", "mist", "card"].map((bg): [string, string, number] => [t, bg, BODY])),
  ["teal-deep", "canvas", LARGE],
  ["teal-deep", "card", LARGE],
  ["teal-ink", "teal-soft", BODY],
  // Text on navy surfaces
  ...["on-navy", "on-navy-2", "on-navy-3", "teal", "teal-glow"].flatMap((t) =>
    ["navy-950", "navy-900", "navy-800", "navy"].map((bg): [string, string, number] => [t, bg, BODY]),
  ),
  ...["navy-950", "navy-900", "navy-800"].map((bg): [string, string, number] => ["blue-bright", bg, LARGE]),
  // Buttons and badges
  ["on-navy", "blue", BODY], // primary
  ["on-navy", "blue-press", BODY],
  ["navy", "teal", BODY], // signal
  ["navy", "teal-glow", BODY],
  ["on-navy", "navy-800", BODY], // ink hover
  ["on-navy", "teal-ink", BODY], // the old "moss" panel
  ["ok", "ok-soft", BODY],
  ["warn", "warn-soft", BODY],
  ["bad", "bad-soft", BODY],
  // Old names, as the tracks' pages use them (bg-ink text-paper, bg-signal text-ink, text-signal-ink on paper)
  ["paper", "ink", BODY],
  ["ink", "signal", BODY],
  ["signal-ink", "paper", BODY],
  ["signal-ink", "paper-2", BODY],
  ["ink-3", "paper-2", BODY],
  ["paper", "moss", BODY],
  ["signal", "ink", BODY],
];

describe("brand tokens meet WCAG AA", () => {
  it.each(PAIRS)("%s on %s ≥ %s:1", (text, bg, min) => {
    const t = text === "on-navy" ? WHITE : hex(text);
    expect(contrast(t, hex(bg))).toBeGreaterThanOrEqual(min);
  });

  it("knows teal is never small text on light", () => {
    // The reason for teal-ink: brand teal on white or canvas is far below 4.5:1.
    expect(contrast(hex("teal"), hex("card"))).toBeLessThan(BODY);
    expect(contrast(hex("teal"), hex("canvas"))).toBeLessThan(BODY);
  });
});
