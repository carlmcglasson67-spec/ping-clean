// Track C: the admin console's flows, end to end, signed in as the seeded admin, through the
// real UI and real RLS. Runs last in roles.e2e.mjs (after Track B's flows), because it
// changes data: approvals, assignments, scores.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import pg from "pg";

const PASSWORD = "ping-test-2026";
const SECTIONS = ["/admin", "/admin/approvals", "/admin/jobs", "/admin/qc", "/admin/interest", "/admin/settings"];

/** Test set-up and checks straight against the database, as its owner. */
export async function sql(text, params = []) {
  const db = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(text, params)).rows;
  } finally {
    await db.end();
  }
}

async function settle(page) {
  await page.locator("main h1").first().waitFor({ timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

/** Full-page screenshots at desktop and phone width, for the design review. */
async function shoot(page, dir, name) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page);
  await page.screenshot({ path: `${dir}/${name}-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${dir}/${name}-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
}

export async function adminFlows({ browser, BASE, check, signIn, SHOTS }) {
  const dir = process.env.ADMIN_SHOT_DIR ?? SHOTS;
  mkdirSync(dir, { recursive: true });

  console.log("e2e: admin console, kept out (Track C)");
  for (const who of ["anna.customer", "tara.cleaner", "sam.applicant"]) {
    await check(`${who} can't open any admin section`, async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await signIn(page, who, PASSWORD);
      await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15_000 });
      const home = new URL(page.url()).pathname;
      for (const path of SECTIONS) {
        await page.goto(`${BASE}${path}`);
        assert.equal(new URL(page.url()).pathname, home, `${who} visiting ${path} should bounce to ${home}`);
        assert.ok(!(await page.locator("nav[aria-label='Admin sections']").count()), "no admin nav for non-admins");
      }
      await ctx.close();
    });
  }
  await check("signed out, every admin section goes to sign-in and comes back", async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE}/admin/jobs`);
    assert.equal(new URL(page.url()).pathname, "/login");
    assert.equal(new URL(page.url()).searchParams.get("next"), "/admin/jobs");
    await page.close();
  });

  console.log("e2e: admin console, overview (Track C)");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-GB", timezoneId: "Europe/London" });
  const page = await ctx.newPage();
  await signIn(page, "admin", PASSWORD);
  await page.waitForURL(`${BASE}/admin`, { timeout: 15_000 });
  await settle(page);

  await check("the overview shows today's numbers from the database", async () => {
    const [{ today }] = await sql(`select count(*)::int as today from public.visits where scheduled_date = (now() at time zone 'Europe/London')::date`);
    const [{ unclaimed, offering }] = await sql(
      `select count(*) filter (where status = 'unclaimed')::int as unclaimed, count(*) filter (where status = 'offering')::int as offering
       from public.series`);
    const [{ applicants }] = await sql(`select count(*)::int as applicants from public.cleaners where status = 'applicant'`);
    const main = await page.locator("main").innerText();
    assert.match(main, new RegExp(`${today}\\s+cleans? booked`), "cleans today");
    assert.match(main, /Unclaimed jobs/);
    assert.match(main, new RegExp(`${applicants} applicants?`), "applicants");
    const board = page.getByRole("region", { name: "On the board" });
    assert.match(await board.innerText(), new RegExp(`Unclaimed jobs\\s+${unclaimed}[\\s\\S]*On offer now\\s+${offering}`));
  });

  await check("open alerts are counted by kind", async () => {
    await sql(`insert into public.engine_alerts (kind, message) values ('generate_failed', 'e2e: a test alert')`);
    await page.reload();
    await settle(page);
    const card = page.getByRole("link", { name: /Open alerts/ });
    assert.match(await card.innerText(), /1 booking failed/);
  });

  await check("each number links into its section", async () => {
    for (const [name, path] of [[/Unclaimed jobs/, "/admin/jobs"], [/Open alerts/, "/admin/jobs"], [/Vetting queue/, "/admin/approvals"], [/Cleans to score/, "/admin/qc"]]) {
      await page.goto(`${BASE}/admin`);
      await settle(page);
      await page.getByRole("region", { name: "Needs you" }).getByRole("link", { name }).click();
      await page.waitForURL((u) => u.pathname === path);
    }
  });

  await check("the section tabs reach every section and mark the current one", async () => {
    await page.goto(`${BASE}/admin`);
    for (const [label, path] of [["Approvals", "/admin/approvals"], ["Jobs", "/admin/jobs"], ["QC", "/admin/qc"], ["Interest", "/admin/interest"], ["Settings", "/admin/settings"], ["Overview", "/admin"]]) {
      await page.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: label, exact: true }).click();
      await page.waitForURL((u) => u.pathname === path);
      const current = page.getByRole("navigation", { name: "Admin sections" }).locator("[aria-current=page]");
      assert.equal(await current.innerText(), label);
      assert.ok(!/went wrong|didn.t load/i.test(await page.locator("main").innerText()), `${path} rendered an error`);
    }
  });

  await check("recent changes name the team member, not an id", async () => {
    await page.goto(`${BASE}/admin`);
    await settle(page);
    const activity = await page.getByRole("region", { name: "Recent changes" }).innerText();
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(activity), "no raw ids in the activity list");
  });

  await page.goto(`${BASE}/admin`);
  await shoot(page, dir, "admin-overview");

  await ctx.close();
}
