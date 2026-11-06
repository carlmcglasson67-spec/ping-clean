import localFont from "next/font/local";

// Self-hosted from npm (@fontsource-variable): no runtime call to Google, no build-time
// network dependency, and the files are served from our own domain.

/** Display: characterful grotesque for headlines and numbers. */
export const display = localFont({
  src: "../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2",
  variable: "--font-bricolage",
  weight: "200 800",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

/** Text: calm, legible sans for body copy and every app screen. */
export const text = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2", style: "normal" },
    { path: "../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-italic.woff2", style: "italic" },
  ],
  variable: "--font-instrument",
  weight: "400 700",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
