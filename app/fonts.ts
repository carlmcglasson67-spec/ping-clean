import localFont from "next/font/local";

// Self-hosted from npm (@fontsource-variable): no runtime call to Google, no build-time
// network dependency, and the files are served from our own domain. Both SIL Open Font Licence.

/**
 * Display: Sora. A wide, geometric sans with a confident stance at 600-700: it carries the
 * bold voice of Carl's banners ("PING CLEAN", "BOOK NOW") and its round bowls and
 * single-storey g sit happily next to the rounded wordmark without imitating it.
 */
export const display = localFont({
  src: "../node_modules/@fontsource-variable/sora/files/sora-latin-wght-normal.woff2",
  variable: "--font-sora",
  weight: "100 800",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

/**
 * Text: Figtree. High x-height and open shapes, so it stays easy to read at 17-18px on a
 * phone in a hallway with one hand full. Friendly without being soft; tabular figures for prices.
 */
export const text = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2", style: "normal" },
    { path: "../node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-italic.woff2", style: "italic" },
  ],
  variable: "--font-figtree",
  weight: "300 900",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
