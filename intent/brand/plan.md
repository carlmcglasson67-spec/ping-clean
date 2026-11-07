# Brand: Carl's official Ping Clean brand (7 Nov 2026)

Shared design layer only (main session): tokens, fonts, logo, icons, components/ui.
Route-group pages stay with their tracks and re-skin through the token aliases.

## Decisions
- **Logo**: rebuilt as SVG from Carl's crop (scripts/brand/gen-logo.py). Four arcs and the
  sparkle fitted to the crop by overlap (88%); wordmark is Comfortaa Bold (OFL), placed
  letter by letter on the original and thickened to its weight (87%), with a straight "l".
  The mark keeps the artwork's flat colours; the full-colour wordmark is one smooth gradient,
  #0052FE to #00C2D1 left to right (Carl's choice after review). White and navy stay flat.
  Comparison: logo-comparison.png.
- **Tokens**: new names (canvas, mist, card, navy-*, on-navy-*, blue, teal, teal-ink...).
  The earlier names (paper, ink, signal, moss...) are aliases onto them, so unmerged track
  pages keep working; they move to the new names as they're touched.
- **Contrast**: every intended pair tested in components/ui/tokens.test.ts. Teal is never
  small text on light (teal-ink instead); bright blue on navy only for large type.
- **Fonts**: Sora (display) and Figtree (text), self-hosted from @fontsource-variable.
- **Navy panels**: `grain` on a navy background now carries the signal waves
  (public/brand/signal-waves.svg); `NavyPanel` and `.signal-waves` for new code.
- **Buttons**: primary = white on brand blue (light surfaces); new `signal` = navy on teal
  and `onNavy` for navy surfaces.

## Screens
before-after-1440.png and before-after-390.png: holding page, sign-in, admin.
