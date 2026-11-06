#!/usr/bin/env node
// Screenshots pages at phone (390px) and desktop (1440px) widths, for the
// design-reviewer agent and PR descriptions.
//   node scripts/screenshot.mjs http://localhost:3000 / /login
// Uses the system Chrome (CHROME_PATH or /usr/bin/google-chrome) via playwright-core.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:3000", ...paths] = process.argv.slice(2);
const targets = paths.length ? paths : ["/"];
const outDir = process.env.SHOT_DIR ?? "screenshots";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome" });
for (const width of [390, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: width === 390 ? 2 : 1 });
  for (const p of targets) {
    await page.goto(base + p, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200); // let entrance animations settle
    const name = `${outDir}/${(p.replace(/\//g, "_") || "_").replace(/^_$/, "home")}-${width}.png`;
    await page.screenshot({ path: name, fullPage: true });
    console.log(name);
  }
  await page.close();
}
await browser.close();
