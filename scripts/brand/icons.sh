#!/usr/bin/env bash
# PNG icons and the favicon from the generated SVGs (run after scripts/brand/gen-logo.py).
# Needs rsvg-convert and ImageMagick.
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
B=public/brand
rsvg-convert -w 192 -h 192 -o "$B/icon-192.png" "$B/pingclean-icon.svg"
rsvg-convert -w 512 -h 512 -o "$B/icon-512.png" "$B/pingclean-icon.svg"
rsvg-convert -w 512 -h 512 -o "$B/icon-maskable-512.png" "$B/pingclean-icon-maskable.svg"
rsvg-convert -w 180 -h 180 -o app/apple-icon.png "$B/pingclean-icon-apple.svg"  # iOS rounds the corners itself
tmp=$(mktemp -d)
for s in 16 32 48; do rsvg-convert -w "$s" -h "$s" -o "$tmp/$s.png" "$B/pingclean-favicon.svg"; done
convert "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" app/favicon.ico
rm -rf "$tmp"
echo "icons: ok"
