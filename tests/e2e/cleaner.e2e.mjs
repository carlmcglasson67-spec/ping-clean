// Track B: the cleaner app's flows, end to end, through the real UI, real RLS and the
// real storage policies. Runs after the role checks in roles.e2e.mjs (it changes data:
// a new applicant, uploads), so the role checks always see the pristine seed.
import assert from "node:assert/strict";
import pg from "pg";

const PASSWORD = "ping-test-2026";
// A brand-new login, made here so the application can be tested from the very start.
const CASEY = { id: "00000000-0000-4000-a000-0000000000c1", email: "casey.new@ping.test" };
const TARA_DBS = "00000000-0000-4000-d000-000000000001";

// The smallest valid JPEG header is enough: the bucket, not the app, would judge content.
const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");

const TARA = "00000000-0000-4000-a000-000000000004";
const ALEX = "00000000-0000-4000-a000-000000000005";
const BEN_SERIES = "00000000-0000-4000-c000-000000000002";
const ANNA_SERIES = "00000000-0000-4000-c000-000000000001";

/** Test set-up and checks straight against the database, as its owner. */
async function sql(text, params = []) {
  const db = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(text, params)).rows;
  } finally {
    await db.end();
  }
}

async function createCasey() {
  const db = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
       values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, extensions.crypt($3, extensions.gen_salt('bf')), now(),
               '{"provider":"email"}', '{"full_name":"Casey New"}')
       on conflict (id) do nothing`,
      [CASEY.id, CASEY.email, PASSWORD],
    );
  } finally {
    await db.end();
  }
}

// A UK phone: 390px wide, British English, London time.
export const PHONE = { viewport: { width: 390, height: 844 }, locale: "en-GB", timezoneId: "Europe/London" };

export async function cleanerFlows({ browser, BASE, check, signIn, SHOTS }) {
  await createCasey();

  console.log("e2e: cleaner application (Track B)");
  {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await signIn(page, "casey.new");
    await page.waitForURL(`${BASE}/account`);

    await check("a customer can start a cleaner application", async () => {
      await page.goto(`${BASE}/work/apply`);
      await page.getByRole("heading", { name: "Your own cleaning round. None of the admin." }).waitFor();
      await page.screenshot({ path: `${SHOTS}/work-apply-390.png`, fullPage: true });
      await page.getByRole("button", { name: "Start my application" }).click();
      await page.waitForURL(`${BASE}/work/details`, { timeout: 15_000 });
    });

    await check("details are validated and saved", async () => {
      await page.getByLabel("Mobile number").fill("not a number");
      await page.getByRole("button", { name: "Save my details" }).click();
      await page.getByText("Add a mobile number we can call or text").waitFor();
      await page.getByLabel("Mobile number").fill("07700 900777");
      await page.getByRole("button", { name: "Save my details" }).click();
      await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
    });

    await check("the application shows what to do next", async () => {
      await page.goto(`${BASE}/work`);
      // The page streams in behind a skeleton: wait for the real heading.
      await page.getByRole("heading", { name: "Thanks for applying, Casey." }).waitFor();
      const text = await page.locator("main").innerText();
      assert.ok(text.includes("Send your documents"));
      assert.ok(!/New jobs for you|You earn/.test(text), "an applicant must not see jobs");
    });

    await check("insurance needs its cover end date before the file goes", async () => {
      await page.goto(`${BASE}/work/documents`);
      const card = page.locator("li").filter({ has: page.getByRole("heading", { name: "Public liability insurance" }) });
      await card.locator('input[type="file"]').setInputFiles({ name: "insurance.jpg", mimeType: "image/jpeg", buffer: JPEG });
      await card.getByText("Add the date your cover ends first").waitFor();
    });

    await check("a document uploads to the private bucket and shows as being checked", async () => {
      const card = page.locator("li").filter({ has: page.getByRole("heading", { name: "DBS check" }) });
      await card.locator('input[type="file"]').setInputFiles({ name: "dbs.jpg", mimeType: "image/jpeg", buffer: JPEG });
      await card.getByText("Being checked").waitFor({ timeout: 15_000 });
      await page.screenshot({ path: `${SHOTS}/work-documents-390.png`, fullPage: true });
    });

    await check("refuses files Ping can't take, in plain words", async () => {
      const card = page.locator("li").filter({ has: page.getByRole("heading", { name: "Photo ID" }) });
      await card.locator('input[type="file"]').setInputFiles({ name: "notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: JPEG });
      await card.getByText("Ping takes photos").waitFor();
    });

    await check("their own document opens through a short-lived signed link", async () => {
      const href = await page.getByRole("link", { name: "View what you sent" }).first().getAttribute("href");
      const r = await page.request.get(`${BASE}${href}`, { maxRedirects: 0 });
      assert.equal(r.status(), 303);
      const to = new URL(r.headers().location);
      assert.match(to.pathname, /^\/storage\/v1\/object\/sign\/cleaner-documents\/00000000-0000-4000-a000-0000000000c1\/dbs-/);
      assert.ok(Number(to.searchParams.get("token")?.split(".")[0]) * 1000 <= Date.now() + 600_000 + 5_000, "link lives 10 minutes at most");
      assert.equal((await page.request.get(to.toString())).status(), 200);
      assert.match(r.headers()["cache-control"] ?? "", /no-store/);
    });

    await check("someone else's document never opens", async () => {
      const r = await page.request.get(`${BASE}/work/documents/${TARA_DBS}`, { maxRedirects: 0 });
      assert.equal(r.status(), 303);
      assert.equal(new URL(r.headers().location).pathname + new URL(r.headers().location).search, "/work/documents?view=failed");
    });

    await page.goto(`${BASE}/work`);
    await page.screenshot({ path: `${SHOTS}/work-application-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `${SHOTS}/work-application-1440.png`, fullPage: true });
    await page.goto(`${BASE}/work/documents`);
    await page.screenshot({ path: `${SHOTS}/work-documents-1440.png`, fullPage: true });
    await ctx.close();
  }

  console.log("e2e: areas and working days (Track B)");
  {
    // Alex: Approved, CA22/CA25/CA28, Tuesdays and Thursdays.
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await signIn(page, "alex.cleaner");
    await page.waitForURL(`${BASE}/work`);

    await check("shows Ping's areas with their towns, and the cleaner's current choices", async () => {
      await page.goto(`${BASE}/work/areas`);
      await page.getByRole("heading", { name: "You choose where and when." }).waitFor();
      assert.ok(await page.getByRole("checkbox", { name: /CA28\s*Whitehaven/ }).isChecked());
      assert.ok(!(await page.getByRole("checkbox", { name: /CA14\s*Workington/ }).isChecked()));
      assert.ok(await page.getByRole("checkbox", { name: "Tuesday" }).isChecked());
      assert.ok(!(await page.getByRole("checkbox", { name: "Wednesday" }).isChecked()));
      assert.equal(await page.getByLabel("Tuesday start").inputValue(), "09:00");
      await page.screenshot({ path: `${SHOTS}/work-areas-390.png`, fullPage: true });
    });

    await check("a day that finishes before it starts is refused in plain words", async () => {
      await page.getByText("CA14", { exact: true }).click();
      await page.getByText("Wednesday", { exact: true }).click();
      await page.getByLabel("Wednesday start").selectOption("14:00");
      await page.getByLabel("Wednesday finish").selectOption("10:00");
      await page.getByRole("button", { name: "Save where and when I work" }).click();
      await page.getByText("each working day needs to finish after it starts").waitFor();
      assert.equal(await page.getByLabel("Wednesday start").inputValue(), "14:00", "a failed save keeps what they chose");
      assert.ok(await page.getByRole("checkbox", { name: /CA14/ }).isChecked());
    });

    await check("saves areas and days, and the home screen reflects them", async () => {
      await page.getByLabel("Wednesday finish").selectOption("15:30");
      await page.getByRole("button", { name: "Save where and when I work" }).click();
      await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
      await page.reload();
      assert.ok(await page.getByRole("checkbox", { name: /CA14/ }).isChecked());
      assert.equal(await page.getByLabel("Wednesday start").inputValue(), "14:00");
      assert.equal(await page.getByLabel("Wednesday finish").inputValue(), "15:30");
      await page.goto(`${BASE}/work`);
      await page.getByText("You cover CA14, CA22, CA25, CA28.").waitFor();
    });

    await check("an area Ping doesn't cover can't be slipped in from the browser", async () => {
      await page.goto(`${BASE}/work/areas`);
      const save = page.getByRole("button", { name: "Save where and when I work" });
      await save.evaluate((b) => {
        b.form.append(Object.assign(document.createElement("input"), { type: "hidden", name: "areas", value: "LA1" }));
      });
      await save.click();
      await page.getByText("isn't covered by Ping yet").waitFor();
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/work/areas`);
    await page.screenshot({ path: `${SHOTS}/work-areas-1440.png`, fullPage: true });
    await ctx.close();
  }

  console.log("e2e: job board and claiming (Track B)");
  {
    // Ben's block of 4 fortnightly Wednesday cleans in Whitehaven CA28 is on offer to Tara
    // (Top). Make Alex Top too and give him an offer, so two cleaners can race for it (the
    // board only shows what a cleaner could claim right now).
    await sql(`update public.cleaners set tier = 'top' where id = $1`, [ALEX]);
    await sql(
      `insert into public.job_offers (series_id, cleaner_id, tier, round, opens_at, status)
       values ($1, $2, 'top', 1, now() - interval '1 minute', 'open') on conflict do nothing`,
      [BEN_SERIES, ALEX],
    );
    const tara = await (await browser.newContext(PHONE)).newPage();
    const alex = await (await browser.newContext(PHONE)).newPage();
    await signIn(tara, "tara.cleaner");
    await signIn(alex, "alex.cleaner");
    await tara.waitForURL(`${BASE}/work`);
    await alex.waitForURL(`${BASE}/work`);

    await check("home counts the open jobs and leads to the board", async () => {
      await tara.getByRole("link", { name: "See the jobs" }).click();
      await tara.waitForURL(`${BASE}/work/jobs`);
    });

    await check("the board shows town, district, size, pets, day, time, hours and earnings only", async () => {
      const card = tara.getByRole("article").filter({ hasText: "Whitehaven" });
      await card.waitFor();
      const text = await card.innerText();
      for (const s of ["Whitehaven", "CA28", "2 bed", "1 bath", "No pets", "Every other Wednesday", "10am–2pm", "2 hours", "£30.00"]) {
        assert.ok(text.includes(s), `expected "${s}" on the card`);
      }
      // The true clean count and the projected last clean, from job_board().
      const [b] = await sql(
        `select private.block_capacity($1) as cleans, to_char(private.block_projected_end($1), 'FMDD Mon') as last`,
        [BEN_SERIES],
      );
      assert.ok(text.includes(`${b.cleans} cleans, last one ${b.last}`), `expected "${b.cleans} cleans, last one ${b.last}"`);
      const page = await tara.content(); // the whole document, RSC payload included
      for (const secret of ["8 Sample Road", "CA28 9ZZ", "Ring the bell", "Sample"]) {
        assert.ok(!page.includes(secret), `must not reach the browser before claim: "${secret}"`);
      }
      await tara.screenshot({ path: `${SHOTS}/work-jobs-390.png`, fullPage: true });
    });

    await check("first tap claims the whole regular clean", async () => {
      await alex.goto(`${BASE}/work/jobs`);
      await alex.getByRole("button", { name: /^Claim (this clean|these \d cleans)$/ }).waitFor();
      await tara.getByRole("button", { name: /^Claim (this clean|these \d cleans)$/ }).click();
      await tara.getByText(/It.s yours: 4 cleans, last one .+\. Every other Wednesday/).waitFor({ timeout: 15_000 });
      await tara.screenshot({ path: `${SHOTS}/work-jobs-claimed-390.png`, fullPage: true });
      const [s] = await sql(`select status, cleaner_id from public.series where id = $1`, [BEN_SERIES]);
      assert.deepEqual({ ...s }, { status: "claimed", cleaner_id: TARA });
    });

    await check("the second cleaner is told kindly that someone got there first", async () => {
      await alex.getByRole("button", { name: /^Claim (this clean|these \d cleans)$/ }).click();
      await alex.getByText("Another cleaner claimed this one first").waitFor({ timeout: 15_000 });
      assert.ok(!/went wrong|PC00\d|error/i.test(await alex.locator("main").innerText()), "no raw error");
      await alex.screenshot({ path: `${SHOTS}/work-jobs-taken-390.png`, fullPage: true });
      await alex.getByRole("button", { name: "Clear it from my list" }).click();
      await alex.getByText("No new jobs right now").waitFor();
      await alex.screenshot({ path: `${SHOTS}/work-jobs-empty-390.png`, fullPage: true });
    });

    await check("an applicant gets a designed state, not the board", async () => {
      const sam = await (await browser.newContext(PHONE)).newPage();
      await signIn(sam, "sam.applicant");
      await sam.waitForURL(`${BASE}/work`);
      await sam.goto(`${BASE}/work/jobs`);
      await sam.getByText("Jobs appear once you're approved").waitFor();
      await sam.context().close();
    });

    await tara.setViewportSize({ width: 1440, height: 900 });
    await tara.screenshot({ path: `${SHOTS}/work-jobs-claimed-1440.png`, fullPage: true });
    await tara.context().close();
    await alex.context().close();
  }

  console.log("e2e: today's jobs (Track B)");
  {
    // Tara holds Anna's weekly clean, which falls today: 12 Test Street, key code 4721.
    const tara = await (await browser.newContext(PHONE)).newPage();
    await signIn(tara, "tara.cleaner");
    await tara.waitForURL(`${BASE}/work`);

    await check("home leads to today's addresses", async () => {
      await tara.getByRole("link", { name: "Addresses and directions" }).click();
      await tara.waitForURL(`${BASE}/work/today`);
    });

    await check("a claimed job shows the full address, access notes and directions", async () => {
      await tara.getByRole("heading", { name: "12 Test Street" }).waitFor();
      const text = await tara.locator("main").innerText();
      for (const s of ["One clean today.", "9am–12pm", "Workington", "CA14 9ZZ", "Side gate, key in the safe", "One friendly dog", "You earn £37.50"]) {
        assert.ok(text.includes(s), `expected "${s}"`);
      }
      const href = await tara.getByRole("link", { name: "Directions" }).getAttribute("href");
      const url = new URL(href);
      assert.equal(url.host, "www.google.com");
      assert.equal(url.searchParams.get("destination"), "12 Test Street, Workington CA14 9ZZ");
    });

    await check("the key code stays hidden until tapped", async () => {
      assert.ok(!(await tara.locator("main").innerText()).includes("4721"));
      await tara.getByRole("button", { name: /Show key code/ }).click();
      await tara.getByText("4721").waitFor();
      await tara.screenshot({ path: `${SHOTS}/work-today-390.png`, fullPage: true });
      await tara.setViewportSize({ width: 1440, height: 900 });
      await tara.screenshot({ path: `${SHOTS}/work-today-1440.png`, fullPage: true });
      await tara.setViewportSize(PHONE.viewport);
    });

    await check("the page is never stored by the browser or a cache", async () => {
      const r = await tara.request.get(`${BASE}/work/today`);
      assert.match(r.headers()["cache-control"] ?? "", /no-store/);
    });

    await check("a cleaner without today's job never sees its address", async () => {
      const alex = await (await browser.newContext(PHONE)).newPage();
      await signIn(alex, "alex.cleaner");
      await alex.waitForURL(`${BASE}/work`);
      await alex.goto(`${BASE}/work/today`);
      await alex.getByText("A free day").waitFor();
      const html = await alex.content();
      for (const s of ["12 Test Street", "CA14 9ZZ", "Side gate", "4721"]) assert.ok(!html.includes(s), `must not see "${s}"`);
      await alex.screenshot({ path: `${SHOTS}/work-today-empty-390.png`, fullPage: true });
      await alex.context().close();
    });

    await check("the address goes the moment the job stops being theirs", async () => {
      await sql(`select private.reopen_series($1)`, [ANNA_SERIES]);
      await tara.reload();
      await tara.getByText("This clean is with the Ping office now").waitFor();
      const html = await tara.content();
      for (const s of ["12 Test Street", "CA14 9ZZ", "Side gate", "4721"]) assert.ok(!html.includes(s), `must be gone: "${s}"`);
      await tara.screenshot({ path: `${SHOTS}/work-today-reopened-390.png`, fullPage: true });
    });
    await tara.context().close();
  }

  {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    await signIn(page, "ben.customer");
    await page.waitForURL(`${BASE}/account`);
    await check("a customer with a booking running is told why they can't apply yet", async () => {
      await page.goto(`${BASE}/work/apply`);
      await page.getByRole("button", { name: "Start my application" }).click();
      await page.getByText("You've got a regular clean booked with Ping").waitFor();
      await page.goto(`${BASE}/work`);
      assert.equal(new URL(page.url()).pathname, "/account", "still a customer");
    });
    await ctx.close();
  }
}
