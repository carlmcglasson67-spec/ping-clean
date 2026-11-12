// Phase 1 "done when", end to end: each role signs in through the real UI and sees
// only its own data. Run with: npm run test:e2e (builds a throwaway Postgres first).
// Uses the real app (next build + next start), real RLS, the system Chrome.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { adminFlows } from "./admin.flows.mjs";
import { authFlows } from "./auth.flows.mjs";
import { cleanerFlows } from "./cleaner.e2e.mjs";
import { cleanerPaymentsFlows } from "./cleaner-payments.e2e.mjs";
import { fakeServiceRoleKey, startFakeSupabase } from "./fake-supabase.mjs";
import { cardAtBookingFlows } from "./card-at-booking.e2e.mjs";
import { chargingFlows, TEST_JOB_SECRET } from "./charging.e2e.mjs";
import { stripeWebhookFlows } from "./stripe-webhooks.e2e.mjs";
import { startFakeStripe, TEST_CONNECT_WEBHOOK_SECRET, TEST_PUBLISHABLE_KEY, TEST_SECRET_KEY, TEST_WEBHOOK_SECRET } from "../stripe/fake-stripe.mjs";

const PORT = 3200;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOT_DIR ?? "screenshots/e2e";
const PASSWORD = "ping-test-2026";
mkdirSync(SHOTS, { recursive: true });

const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key-not-a-real-key-000000",
  NEXT_PUBLIC_SITE_URL: BASE,
  RESET_PASS_SECRET: "e2e-reset-pass-secret-not-a-real-one-0000",
  PING_DIST_DIR: ".next-e2e",
  // Register interest writes through the service-role client (lib/db/admin.ts).
  SUPABASE_SERVICE_ROLE_KEY: fakeServiceRoleKey(),
  // Stripe (payments PRs 3–4): TEST-shaped keys for the local fake Stripe only; Stripe is never reached.
  STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
  STRIPE_CONNECT_WEBHOOK_SECRET: TEST_CONNECT_WEBHOOK_SECRET,
  STRIPE_SECRET_KEY: TEST_SECRET_KEY,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: TEST_PUBLISHABLE_KEY,
  STRIPE_API_BASE: "http://127.0.0.1:12111",
  PING_JOB_SECRET: TEST_JOB_SECRET, // the charge job (payments PR 6)
};

// Anna's regular clean falls on today's weekday (see seed.sql), in London time.
const todayName = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long" }).format(new Date());

const ROLES = [
  {
    who: "anna.customer", lands: "/account",
    sees: ["Hello, Anna.", "12 Test Street", "Cleaner confirmed", `${todayName}s`, "Paid cleans with receipts"],
    never: ["8 Sample Road", "Whitehaven CA28", "You earn", "Vetting queue"],
  },
  {
    who: "ben.customer", lands: "/account",
    sees: ["Hello, Ben.", "8 Sample Road", "Finding your cleaner", "Nothing booked in yet"],
    never: ["12 Test Street", "4721"],
  },
  {
    who: "tara.cleaner", lands: "/work",
    sees: ["Top cleaner", "New jobs for you", "You earn £37.50", "CA14, CA15, CA28"],
    never: ["12 Test Street", "8 Sample Road", "Vetting queue"],
  },
  {
    who: "alex.cleaner", lands: "/work",
    sees: ["Approved cleaner", "Nothing booked today.", "A free day"],
    never: ["You earn £37.50", "12 Test Street"],
  },
  {
    who: "sam.applicant", lands: "/work",
    sees: ["Thanks for applying, Sam.", "Being checked", "Not sent yet"],
    never: ["New jobs for you", "You earn"],
  },
  {
    who: "admin", lands: "/admin",
    sees: ["Today at Ping", "Unclaimed jobs", "Vetting queue", "Recent changes"],
    never: ["Booking is switched off"],
  },
];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n    ${e.message.split("\n").join("\n    ")}`);
  }
}

console.log("e2e: building app against the test database…");
run("npx", ["next", "build"]);
const fake = await startFakeSupabase(54321, { siteUrl: BASE }); // the project's fixed Site URL
const fakeStripe = await startFakeStripe(12111);
// detached: its own process group, so we can stop npx *and* the Next server under it.
const app = spawn("npx", ["next", "start", "-p", String(PORT), "-H", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
const stopApp = () => { try { process.kill(-app.pid, "SIGTERM"); } catch {} };
process.on("exit", stopApp);
app.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { up = (await fetch(`${BASE}/login`)).ok; } catch {}
  if (up) break;
  await new Promise((r) => setTimeout(r, 500));
}

if (!up) { stopApp(); await fake.close(); throw new Error(`app did not start on ${BASE}`); }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome" });

async function signIn(page, who, password = PASSWORD) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(`${who}@ping.test`);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

try {
  // Public screens, for design review (the signed-in screens are captured per role below).
  for (const [path, name] of [["/", "holding"], ["/login", "login"]]) {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: width === 390 ? 2 : 1 });
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1200); // let entrance animations settle
      await page.screenshot({ path: `${SHOTS}/${name}-${width}.png`, fullPage: true });
      await page.close();
    }
  }

  console.log("e2e: signed out");
  await check("signed-out visitors are sent to sign-in, and come back afterwards", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/work`);
    assert.equal(new URL(page.url()).pathname, "/login");
    assert.equal(new URL(page.url()).searchParams.get("next"), "/work");
    await page.getByLabel("Email").fill("tara.cleaner@ping.test");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${BASE}/work`);
    await page.close();
  });
  await check("a wrong password gets a plain-English error and no session", async () => {
    const page = await browser.newPage();
    await signIn(page, "anna.customer", "wrong-password");
    await page.getByText("That email and password don't match").waitFor();
    await page.goto(`${BASE}/account`);
    assert.equal(new URL(page.url()).pathname, "/login");
    await page.close();
  });
  await check("a ?next= link can't send someone outside their own app", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/login?next=${encodeURIComponent("/admin")}`);
    await page.getByLabel("Email").fill("anna.customer@ping.test");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${BASE}/account`);
    await page.close();
  });

  for (const r of ROLES) {
    console.log(`e2e: ${r.who}`);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await check(`signs in and lands on ${r.lands}`, async () => {
      await signIn(page, r.who);
      await page.waitForURL(`${BASE}${r.lands}`, { timeout: 15_000 });
    });
    // Pages stream in behind a loading skeleton; wait for the real heading.
    await page.locator("main h1").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState("networkidle");
    const text = await page.locator("main").innerText().catch(() => "");
    if (process.env.E2E_DEBUG) console.log(text.slice(0, 600));
    await check("sees their own data", async () => {
      for (const s of r.sees) assert.ok(text.toLowerCase().includes(s.toLowerCase()), `expected to see "${s}"`);
    });
    await check("sees nobody else's", async () => {
      for (const s of r.never) assert.ok(!text.toLowerCase().includes(s.toLowerCase()), `must not see "${s}"`);
      assert.ok(!/went wrong|didn.t load/i.test(text), "page rendered an error state");
    });
    await check("is kept out of the other two apps", async () => {
      for (const other of ["/account", "/work", "/admin"].filter((p) => p !== r.lands)) {
        await page.goto(`${BASE}${other}`);
        assert.equal(new URL(page.url()).pathname, r.lands, `visiting ${other} should bounce to ${r.lands}`);
      }
    });
    await page.goto(`${BASE}${r.lands}`);
    await page.locator("main h1").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${SHOTS}/${r.who}-1440.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${SHOTS}/${r.who}-390.png`, fullPage: true });
    await check("signs out", async () => {
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL((u) => u.pathname === "/login");
      await page.goto(`${BASE}${r.lands}`);
      assert.equal(new URL(page.url()).pathname, "/login");
    });
    await ctx.close();
  }

  await authFlows({ browser, BASE, check, shots: process.env.SIGNUP_SHOT_DIR ?? SHOTS });
  await stripeWebhookFlows({ BASE, check, stripe: fakeStripe });
  // Payments 5: Alex sets up how he gets paid (and ends ready, as seeded).
  await cleanerPaymentsFlows({ browser, BASE, check, signIn, SHOTS, stripe: fakeStripe });
  // Track B's cleaner flows. Last, because they change the seeded jobs and visits.
  await cleanerFlows({ browser, BASE, check, signIn, SHOTS });
  // Payments 6: the clean Tara just completed is charged (after it, so there is one to charge).
  await chargingFlows({ browser, BASE, check, signIn, SHOTS, stripe: fakeStripe });
  await cardAtBookingFlows({ browser, BASE, check, signIn, SHOTS, stripe: fakeStripe });
  // Track C's admin console. After Track B's, because it approves, assigns and scores.
  await adminFlows({ browser, BASE, check, signIn, SHOTS });
} finally {
  await browser.close();
  stopApp();
  await fake.close();
  await fakeStripe.stop();
}

console.log(failures ? `\ne2e: ${failures} check(s) failed` : "\ne2e: all checks passed");
process.exit(failures ? 1 : 0);
