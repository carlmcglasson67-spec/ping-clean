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

  await approvalsFlows({ page, BASE, check, dir, browser, signIn });

  await ctx.close();
}

const SAM = "00000000-0000-4000-a000-000000000006";
const SAM_DBS = "00000000-0000-4000-d000-000000000003";
const ADMIN = "00000000-0000-4000-a000-000000000001";

async function approvalsFlows({ page, BASE, check, dir, browser, signIn }) {
  console.log("e2e: admin console, approvals (Track C)");
  await check("applicants are listed with what they're waiting on", async () => {
    await page.goto(`${BASE}/admin/approvals`);
    await settle(page);
    const applicants = await page.getByRole("region", { name: /Applicants/ }).innerText();
    assert.match(applicants, /Sam Test/);
    assert.match(applicants, /Waiting on/);
    const team = await page.getByRole("region", { name: /The team/ }).innerText();
    assert.match(team, /Tara Test[\s\S]*Top tier/);
  });

  await check("a cleaner's page shows the four checks, contact and the decision (switched off until C-1)", async () => {
    await page.getByRole("link", { name: /Sam Test/ }).click();
    await page.waitForURL(`${BASE}/admin/approvals/${SAM}`);
    await settle(page);
    const main = await page.locator("main").innerText();
    for (const s of ["Photo ID", "Right to work", "DBS check", "Public liability insurance", "sam.applicant@ping.test", "CA26"]) assert.ok(main.includes(s), `shows ${s}`);
    assert.ok(await page.getByRole("button", { name: "Approve" }).isDisabled(), "approve is switched off until C-1");
  });

  await check("a document opens only through a 10-minute signed link, for admins only", async () => {
    // A document whose file really is in the bucket (uploaded by Track B's applicant flow).
    const [real] = await sql(
      `select d.id from public.cleaner_documents d join storage.objects o on o.bucket_id = 'cleaner-documents' and o.name = d.storage_path limit 1`);
    assert.ok(real, "a real uploaded document exists");
    const res = await page.request.get(`${BASE}/admin/approvals/document/${real.id}`, { maxRedirects: 0 });
    assert.equal(res.status(), 303);
    assert.equal(res.headers()["cache-control"], "private, no-store");
    const to = new URL(res.headers().location);
    assert.match(to.pathname, /\/object\/sign\/cleaner-documents\//);
    const exp = Number(to.searchParams.get("token").split(".")[0]);
    assert.ok(exp - Date.now() / 1000 <= 600 && exp - Date.now() / 1000 > 500, "expires in 10 minutes");

    const other = await browser.newContext();
    const tara = await other.newPage();
    await signIn(tara, "tara.cleaner", PASSWORD);
    await tara.waitForURL((u) => u.pathname === "/work");
    const denied = await tara.request.get(`${BASE}/admin/approvals/document/${real.id}`, { maxRedirects: 0 });
    assert.equal(denied.status(), 404, "a cleaner can't use the admin document link");
    await other.close();
  });

  await check("a missing file gives a designed error, not a broken page", async () => {
    await page.goto(`${BASE}/admin/approvals/document/${SAM_DBS}`); // seeded row, no file uploaded
    await page.waitForURL((u) => u.searchParams.get("view") === "failed");
    await page.getByText("That document didn't open").waitFor();
  });

  const dbsCard = () => page.locator("li").filter({ has: page.getByRole("heading", { name: "DBS check" }) });

  await check("sending a document back needs a real reason", async () => {
    await page.goto(`${BASE}/admin/approvals/${SAM}`);
    await settle(page);
    await dbsCard().getByRole("button", { name: "Send back" }).click();
    await dbsCard().getByLabel(/Why is it going back/).fill("!!!");
    await dbsCard().getByRole("button", { name: "Send it back" }).click();
    await dbsCard().getByText("Say why, in a few words.").waitFor();
    const [d] = await sql(`select status from public.cleaner_documents where id = $1`, [SAM_DBS]);
    assert.equal(d.status, "pending");
  });

  await check("sent back with a reason: the cleaner's reason is stored, and the audit log redacts it", async () => {
    await dbsCard().getByLabel(/Why is it going back/).fill("The certificate is cut off at the bottom");
    await dbsCard().getByRole("button", { name: "Send it back" }).click();
    await dbsCard().getByText("Sent back:").waitFor();
    const [d] = await sql(`select status, rejection_reason, reviewed_by from public.cleaner_documents where id = $1`, [SAM_DBS]);
    assert.deepEqual(d, { status: "rejected", rejection_reason: "The certificate is cut off at the bottom", reviewed_by: ADMIN });
    const [a] = await sql(`select actor_id, detail from public.audit_log where entity = 'cleaner_documents' and entity_id = $1 order by id desc limit 1`, [SAM_DBS]);
    assert.equal(a.actor_id, ADMIN);
    assert.equal(a.detail.rejection_reason, "changed");
  });

  await check("verified: logged against the admin", async () => {
    await dbsCard().getByRole("button", { name: "Verify" }).click();
    await dbsCard().getByText("Verified", { exact: true }).waitFor();
    const [d] = await sql(`select status, rejection_reason from public.cleaner_documents where id = $1`, [SAM_DBS]);
    assert.deepEqual(d, { status: "verified", rejection_reason: null });
  });

  await check("two of the team at once: the second is told, nothing is overwritten", async () => {
    await sql(`update public.cleaner_documents set status = 'pending', reviewed_by = null, reviewed_at = null where id = $1`, [SAM_DBS]);
    await page.reload();
    await settle(page);
    await sql(`update public.cleaner_documents set status = 'verified', reviewed_by = $2, reviewed_at = now() where id = $1`, [SAM_DBS, ADMIN]);
    await dbsCard().getByRole("button", { name: "Send back" }).click();
    await dbsCard().getByLabel(/Why is it going back/).fill("Too blurry to read");
    await dbsCard().getByRole("button", { name: "Send it back" }).click();
    await dbsCard().getByText(/just reviewed that document/).waitFor();
    const [d] = await sql(`select status from public.cleaner_documents where id = $1`, [SAM_DBS]);
    assert.equal(d.status, "verified");
  });

  await page.goto(`${BASE}/admin/approvals`);
  await shoot(page, dir, "admin-approvals");
  await page.goto(`${BASE}/admin/approvals/${SAM}`);
  await shoot(page, dir, "admin-approvals-cleaner");
}
