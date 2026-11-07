#!/usr/bin/env python3
"""Builds the Ping Clean logo files from measured geometry and Comfortaa Bold outlines.

    python3 scripts/brand/gen-logo.py <comfortaa-latin-700-normal.woff>

Writes public/brand/*.svg and components/ui/logo-paths.ts. Then run
`bash scripts/brand/icons.sh` for the PNG icons.

How the logo was rebuilt (see intent/brand/plan.md):
  * Coordinates are pixels of Carl's crop (pingclean-logo.png, 620x149, cut from his banner).
  * The four arcs and the sparkle were fitted to that crop by maximising overlap; the outer
    arc's start comes from the banner, because the crop cuts it off.
  * The wordmark is Comfortaa Bold (SIL Open Font Licence), each letter placed on the
    original's ink edges, thickened by a round-joined stroke to the original's weight.
    The "l" is a plain rounded stem, as in Carl's artwork (Comfortaa's has a curled foot).
  * Colours: the mark is flat per element as in the artwork (deep blue, bright blue, teal).
    The full-colour wordmark is one smooth gradient, brand blue #0052FE to teal #00C2D1,
    left to right across "PingClean" (Carl's choice, 7 Nov 2026). White and navy stay flat.
Needs fontTools (pip install fonttools).
"""
import math
import pathlib
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parents[2]
FONT = sys.argv[1]
WEIGHT = 2.5  # extra weight on the letters (stroke width), fitted to the original

DEEP, BRIGHT, TEAL, BLUE = "#0F2DF6", "#1190F7", "#00C2D1", "#0052FE"

ARC_W = 13.0
ARCS = [  # centre x, centre y, radius, start and end angle (deg, SVG: 0 = right, 90 = down), colour
    (51.0, 66.5, 56.3, -185, -88, DEEP),
    (62.6, 75.1, 45.9, -188, -62, BRIGHT),
    (62.45, 80.79, 39.34, -6.9, 107.1, TEAL),
    (70.65, 87.75, 53.1, -2, 87, TEAL),
]
SPARK = (61.95, 76.25, 23.45, 23.85, 2.95)  # centre, half width, half height, waist

# Each letter's ink left edge and width in the original; baseline ink at 116.5, cap top 35.
RUNS = [("P", 157, 57), ("i", 219, 13), ("n", 238, 54), ("g", 297, 58), ("C", 360, 64),
        ("l", 429, 13), ("e", 448, 54), ("a", 505, 57), ("n", 568, 54)]
BASE_INK, CAP_TOP = 116.5, 35.0

# The wordmark gradient runs across the letters' ink: P's left edge to the final n's right.
WORD_X1, WORD_X2 = 157.0, 622.0

LOGO_BOX = (-14.0, 1.5, 638.0, 148.0)   # measured ink -11.9..622 x 3.7..147.3, plus margin
MARK_BOX = (-16.8, -0.5, 152.0, 152.0)  # square around the mark's ink


def num(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def arc_d(cx, cy, r, a0, a1):
    p0 = (cx + r * math.cos(math.radians(a0)), cy + r * math.sin(math.radians(a0)))
    p1 = (cx + r * math.cos(math.radians(a1)), cy + r * math.sin(math.radians(a1)))
    large = 1 if abs(a1 - a0) > 180 else 0
    return f"M{num(p0[0])} {num(p0[1])}A{num(r)} {num(r)} 0 {large} 1 {num(p1[0])} {num(p1[1])}"


def spark_d(cx, cy, hw, hh, k):
    pts = [(cx, cy - hh), (cx + hw, cy), (cx, cy + hh), (cx - hw, cy)]
    ctl = [(cx + k, cy - k), (cx + k, cy + k), (cx - k, cy + k), (cx - k, cy - k)]
    d = f"M{num(pts[0][0])} {num(pts[0][1])}"
    for i in range(4):
        nx, ny = pts[(i + 1) % 4]
        d += f"Q{num(ctl[i][0])} {num(ctl[i][1])} {num(nx)} {num(ny)}"
    return d + "Z"


def letters():
    font = TTFont(FONT)
    gs, cmap = font.getGlyphSet(), font.getBestCmap()
    s = (BASE_INK - CAP_TOP - WEIGHT) / font["OS/2"].sCapHeight
    baseline = BASE_INK - WEIGHT / 2
    out = []
    for ch, left, width in RUNS:
        if ch == "l":
            w, x0, y0, y1 = 13.4, left - 0.2, 36.0, BASE_INK
            r = w / 2
            d = (f"M{num(x0 + r)} {num(y0)}A{num(r)} {num(r)} 0 0 1 {num(x0 + w)} {num(y0 + r)}V{num(y1 - r)}"
                 f"A{num(r)} {num(r)} 0 0 1 {num(x0)} {num(y1 - r)}V{num(y0 + r)}A{num(r)} {num(r)} 0 0 1 {num(x0 + r)} {num(y0)}Z")
            out.append((d, False))
            continue
        g = cmap[ord(ch)]
        bp = BoundsPen(gs)
        gs[g].draw(bp)
        xmin, _, xmax, _ = bp.bounds
        fx = max(0.9, min(1.1, (width - WEIGHT) / ((xmax - xmin) * s)))
        pen = SVGPathPen(gs, ntos=num)
        gs[g].draw(TransformPen(pen, (s * fx, 0, 0, -s, left + WEIGHT / 2 - xmin * s * fx, baseline)))
        out.append((pen.getCommands(), True))
    return out


LETTERS = letters()
ARC_D = [arc_d(*a[:5]) for a in ARCS]
SPARK_D = spark_d(*SPARK)


def svg(box, colour, with_word=True, title="Ping Clean", bg=None):
    x, y, w, h = box
    p = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{num(x)} {num(y)} {num(w)} {num(h)}" role="img" aria-label="{title}">']
    if bg:
        p.append(bg)
    p.append(f'<g fill="none" stroke-width="{num(ARC_W)}" stroke-linecap="round">')
    p += [f'<path stroke="{colour("arc", i, a[5])}" d="{ARC_D[i]}"/>' for i, a in enumerate(ARCS)]
    p.append("</g>")
    p.append(f'<path fill="{colour("spark", 0, TEAL)}" d="{SPARK_D}"/>')
    if with_word:
        gradient = colour("letter", 0, None) is None
        if gradient:
            p.append(f'<defs><linearGradient id="pc-word" gradientUnits="userSpaceOnUse" x1="{num(WORD_X1)}" y1="0" '
                     f'x2="{num(WORD_X2)}" y2="0"><stop offset="0" stop-color="{BLUE}"/><stop offset="1" stop-color="{TEAL}"/>'
                     f'</linearGradient></defs>')
        for i, (d, stroked) in enumerate(LETTERS):
            c = "url(#pc-word)" if gradient else colour("letter", i, None)
            extra = f' stroke="{c}" stroke-width="{num(WEIGHT)}" stroke-linejoin="round"' if stroked else ""
            p.append(f'<path fill="{c}"{extra} d="{d}"/>')
    p.append("</svg>")
    return "\n".join(p) + "\n"


full = lambda kind, i, c: c  # letters get c=None: the gradient
white = lambda kind, i, c: "#FFFFFF"
navy = lambda kind, i, c: "#001D44"
brand = ROOT / "public" / "brand"
brand.mkdir(parents=True, exist_ok=True)
(brand / "pingclean-logo.svg").write_text(svg(LOGO_BOX, full))
(brand / "pingclean-logo-white.svg").write_text(svg(LOGO_BOX, white))
(brand / "pingclean-logo-navy.svg").write_text(svg(LOGO_BOX, navy))
(brand / "pingclean-mark.svg").write_text(svg(MARK_BOX, full, with_word=False))
(brand / "pingclean-mark-white.svg").write_text(svg(MARK_BOX, white, with_word=False))

# App icon: the mark on a deep navy tile (favicon, home screen, PWA).
def tile(pad, radius):
    x, y, s, _ = MARK_BOX
    size = s / (1 - 2 * pad)
    box = (x - (size - s) / 2, y - (size - s) / 2, size, size)
    bg = (f'<defs><radialGradient id="g" cx="30%" cy="25%" r="85%"><stop offset="0" stop-color="#0B2A57"/>'
          f'<stop offset="1" stop-color="#010C26"/></radialGradient></defs>'
          f'<rect x="{num(box[0])}" y="{num(box[1])}" width="{num(size)}" height="{num(size)}" rx="{num(size * radius)}" fill="url(#g)"/>')
    return svg(box, full, with_word=False, bg=bg)

(brand / "pingclean-icon.svg").write_text(tile(0.16, 0.22))           # app icon, PWA
(brand / "pingclean-icon-maskable.svg").write_text(tile(0.26, 0))     # Android: full bleed, mark in the safe zone
(brand / "pingclean-icon-apple.svg").write_text(tile(0.14, 0))        # iOS rounds the corners itself
favicon = tile(0.05, 0.22)                                            # tiny sizes: the mark as big as it goes
(brand / "pingclean-favicon.svg").write_text(favicon)
(ROOT / "app" / "icon.svg").write_text(favicon)

# Path data for the React components (components/ui/logo.tsx).
ts = ["// Generated by scripts/brand/gen-logo.py. Do not edit by hand.", "",
      f"export const LOGO_VIEWBOX = \"{' '.join(num(v) for v in LOGO_BOX)}\";",
      f"export const MARK_VIEWBOX = \"{' '.join(num(v) for v in MARK_BOX)}\";",
      f"export const ARC_WIDTH = {num(ARC_W)};",
      f"export const LETTER_WEIGHT = {num(WEIGHT)};", "",
      "/** Full-colour wordmark: one gradient across the letters (userSpaceOnUse, logo coordinates). */",
      f'export const WORD_GRADIENT = {{ x1: {num(WORD_X1)}, x2: {num(WORD_X2)}, from: "{BLUE}", to: "{TEAL}" }} as const;', "",
      "/** Outer upper, inner upper, inner lower, outer lower. */",
      "export const ARCS = ["]
ts += [f'  {{ d: "{ARC_D[i]}", colour: "{a[5]}" }},' for i, a in enumerate(ARCS)]
ts += ["] as const;", "", f'export const SPARKLE = {{ d: "{SPARK_D}", colour: "{TEAL}" }} as const;', "",
       "/** P i n g C l e a n. `stroked`: thickened with a round-joined stroke of LETTER_WEIGHT.",
       " *  `colour`: the artwork's flat two-tone colour, kept for reference; full colour uses WORD_GRADIENT. */",
       "export const LETTERS = ["]
ts += [f'  {{ d: "{d}", colour: "{BLUE if i < 4 else TEAL}", stroked: {"true" if st else "false"} }},'
       for i, (d, st) in enumerate(LETTERS)]
ts += ["] as const;", ""]
(ROOT / "components" / "ui" / "logo-paths.ts").write_text("\n".join(ts))
print("ok")
