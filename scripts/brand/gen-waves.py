#!/usr/bin/env python3
"""Writes public/brand/signal-waves.svg: the fine flowing teal lines from Carl's banners.

    python3 scripts/brand/gen-waves.py

A bundle of thin lines that braid and cross, brighter where they gather. Decorative only;
it sits behind content on navy panels at low opacity (see .grain.bg-ink in app/globals.css).
"""
import math
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
W, H, N, STEPS = 1600, 520, 26, 48


def bezier_path(points):
    """Catmull-Rom through the points, as cubic Beziers: smooth at any zoom."""
    d = f"M{points[0][0]:.1f} {points[0][1]:.1f}"
    for i in range(len(points) - 1):
        p0 = points[max(i - 1, 0)]
        p1, p2 = points[i], points[i + 1]
        p3 = points[min(i + 2, len(points) - 1)]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f"C{c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}"
    return d


lines = []
for k in range(N):
    t = k / (N - 1)
    phase = t * math.pi * 1.35
    amp = 42 + 70 * math.sin(math.pi * t)       # middle lines swing widest
    spread = (t - 0.5) * 150                      # the bundle fans out at the edges...
    pts = []
    for j in range(STEPS + 1):
        x = W * j / STEPS
        u = x / W
        waist = 0.35 + 0.65 * abs(math.sin(math.pi * (u - 0.18)))  # ...and gathers twice
        y = (H * 0.56 + spread * waist
             + amp * math.sin(2 * math.pi * (0.85 * u) + phase)
             + 18 * math.sin(2 * math.pi * (2.3 * u) - phase * 0.7))
        pts.append((x, y))
    opacity = 0.18 + 0.42 * math.sin(math.pi * t) ** 2
    width = 0.8 if k % 3 else 1.2
    lines.append(f'<path d="{bezier_path(pts)}" stroke-width="{width}" stroke-opacity="{opacity:.2f}"/>')

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="none">'
       '<defs><linearGradient id="w" x1="0" x2="1" y1="0" y2="0">'
       '<stop offset="0" stop-color="#1B7EFA"/><stop offset=".45" stop-color="#00C2D1"/>'
       '<stop offset=".7" stop-color="#18F5E8"/><stop offset="1" stop-color="#1B7EFA"/></linearGradient></defs>'
       '<g fill="none" stroke="url(#w)" stroke-linecap="round">' + "".join(lines) + "</g></svg>\n")
(ROOT / "public" / "brand" / "signal-waves.svg").write_text(svg)
print(f"signal-waves.svg: {len(svg) // 1024} KB")
