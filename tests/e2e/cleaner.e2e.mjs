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
const ANNA_TODAY = "00000000-0000-4000-e000-000000000002";
// A real 1x1 PNG, so the phone-side shrink (createImageBitmap → JPEG) has something to decode.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

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

    await tara.context().close();
  }

  console.log("e2e: the visit day (Track B)");
  {
    // Today's clean at Anna's: start it, tick and explain the checklist (with the signal
    // dropping), add before and after photos, and complete it.
    const ctx = await browser.newContext(PHONE);
    const tara = await ctx.newPage();
    await signIn(tara, "tara.cleaner");
    await tara.waitForURL(`${BASE}/work`);
    const rows = () => tara.locator("[data-item] button[aria-pressed]");

    await check("one tap starts today's clean and opens its checklist", async () => {
      await tara.goto(`${BASE}/work/today`);
      await tara.getByRole("button", { name: "Start the clean" }).click();
      await tara.waitForURL(`${BASE}/work/visit/${ANNA_TODAY}`, { timeout: 15_000 });
      await tara.getByRole("heading", { name: "Checklist" }).waitFor();
      const text = await tara.locator("main").innerText();
      assert.match(text, /clean 2 of 8/i, "block progress");
      assert.equal(await rows().count(), 11);
      const [v] = await sql(`select status from public.visits where id = $1`, [ANNA_TODAY]);
      assert.equal(v.status, "in_progress");
    });

    await check("a tick saves, and a couldn't-do needs a real reason", async () => {
      await rows().nth(0).click();
      await rows().nth(1).click();
      const third = tara.locator("[data-item]").nth(2);
      await third.getByRole("button", { name: "Couldn’t do" }).click();
      await third.getByRole("textbox").fill("...");
      assert.ok(await third.getByRole("button", { name: "Save reason" }).isDisabled(), "punctuation isn't a reason");
      await third.getByRole("textbox").fill("No access to the back bedroom");
      await third.getByRole("button", { name: "Save reason" }).click();
      await tara.getByText("Everything’s saved.").waitFor({ timeout: 15_000 });
      const got = await sql(`select done, skipped_reason from public.checklist_items where visit_id = $1 order by position limit 3`, [ANNA_TODAY]);
      assert.deepEqual(got.map((r) => [r.done, r.skipped_reason]), [[true, null], [true, null], [false, "No access to the back bedroom"]]);
    });

    await check("ticks made with no signal are kept, even if the page closes, and sent later", async () => {
      await ctx.setOffline(true);
      await rows().nth(3).click();
      await rows().nth(4).click();
      await tara.getByText(/Sending 2 ticks/).waitFor();
      await tara.screenshot({ path: `${SHOTS}/work-visit-offline-390.png`, fullPage: true });
      await tara.close(); // the phone kills the page while it's still offline
      await ctx.setOffline(false);
      const back = await ctx.newPage();
      await back.goto(`${BASE}/work/visit/${ANNA_TODAY}`);
      // The reopened page shows the kept ticks at once, then sends them.
      await back.waitForFunction(() => document.querySelectorAll('[data-item] button[aria-pressed="true"]').length === 4);
      let n = 0;
      for (let i = 0; i < 30 && n !== 4; i++) {
        n = (await sql(`select count(*)::int as n from public.checklist_items where visit_id = $1 and done`, [ANNA_TODAY]))[0].n;
        if (n !== 4) await new Promise((r) => setTimeout(r, 500));
      }
      assert.equal(n, 4, "the kept ticks reached the database");
      await back.getByText("Everything’s saved.").waitFor({ timeout: 15_000 });
      await back.close();
    });

    const page = await ctx.newPage();
    await page.goto(`${BASE}/work/visit/${ANNA_TODAY}`);
    await page.getByRole("heading", { name: "Checklist" }).waitFor();

    await check("complete is refused, in plain words, until the checklist is done", async () => {
      await page.getByRole("button", { name: "Complete this clean" }).click();
      await page.getByText("6 items are still to tick").waitFor({ timeout: 15_000 });
    });

    await check("then until there's a before and an after photo", async () => {
      const left = page.locator('[data-item][data-state="open"] button[aria-pressed]');
      while (await left.count()) {
        const before = await left.count();
        await left.first().click();
        await page.waitForFunction((n) => document.querySelectorAll('[data-item][data-state="open"]').length < n, before);
      }
      await page.getByText("Everything’s saved.").waitFor({ timeout: 15_000 });
      await page.getByRole("button", { name: "Complete this clean" }).click();
      await page.getByText("Add a before and an after photo.").waitFor({ timeout: 15_000 });
    });

    await check("photos are shrunk on the phone, sent to the private bucket and counted", async () => {
      await page.getByLabel("Take a before photo").setInputFiles({ name: "before.png", mimeType: "image/png", buffer: PNG });
      await page.getByLabel("Take an after photo").setInputFiles({ name: "after.png", mimeType: "image/png", buffer: PNG });
      await page.getByText("1 added").nth(1).waitFor();
      await page.getByText("Everything’s saved.").waitFor({ timeout: 20_000 });
      const got = await sql(
        `select ph.kind, o.owner = $2 as mine, (o.metadata ->> 'size')::int > 0 as has_bytes, ph.storage_path like '%.jpg' as jpeg
         from public.visit_photos ph join storage.objects o on o.name = ph.storage_path and o.bucket_id = 'visit-photos'
         where ph.visit_id = $1 order by ph.kind`,
        [ANNA_TODAY, TARA],
      );
      assert.deepEqual(got.map((r) => [r.kind, r.mine, r.has_bytes, r.jpeg]), [["before", true, true, true], ["after", true, true, true]]);
      await page.screenshot({ path: `${SHOTS}/work-visit-390.png`, fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({ path: `${SHOTS}/work-visit-1440.png`, fullPage: true });
      await page.setViewportSize(PHONE.viewport);
    });

    await check("complete goes through once everything's in, and counts the couldn't-do", async () => {
      await page.getByRole("button", { name: "Complete this clean" }).click();
      await page.getByText("Done. Thank you.").waitFor({ timeout: 15_000 });
      const [v] = await sql(`select status, couldnt_do_count from public.visits where id = $1`, [ANNA_TODAY]);
      assert.deepEqual({ ...v }, { status: "completed", couldnt_do_count: 1 });
      assert.ok((await page.locator("main").innerText()).includes("1 item marked"));
      await page.screenshot({ path: `${SHOTS}/work-visit-done-390.png`, fullPage: true });
      // Nothing is left on the phone once everything's sent.
      assert.equal(await page.evaluate((id) => localStorage.getItem(`ping-ticks-${id}`), ANNA_TODAY), null);
    });

    await check("another cleaner can't open this clean", async () => {
      const alex = await (await browser.newContext(PHONE)).newPage();
      await signIn(alex, "alex.cleaner");
      await alex.waitForURL(`${BASE}/work`);
      await alex.goto(`${BASE}/work/visit/${ANNA_TODAY}`);
      await alex.getByRole("heading", { name: "Nothing to clean here." }).waitFor();
      const html = await alex.content();
      for (const s of ["12 Test Street", "Side gate", "4721"]) assert.ok(!html.includes(s), `must not see "${s}"`);
      await alex.context().close();
    });
    await ctx.close();
  }

  console.log("e2e: calendar (Track B)");
  {
    // Tara now holds two blocks: Anna's weekly 8 (clean 2 done today) and Ben's fortnightly 4.
    const ctx = await browser.newContext(PHONE);
    const tara = await ctx.newPage();
    await signIn(tara, "tara.cleaner");
    await tara.waitForURL(`${BASE}/work`);
    const [ben] = await sql(`select min(scheduled_date)::text as first, count(*)::int as n from public.visits where series_id = $1`, [BEN_SERIES]);

    await check("this week's agenda shows time, town and place in the block", async () => {
      await tara.getByRole("link", { name: "Your calendar" }).click();
      await tara.waitForURL((u) => u.pathname === "/work/calendar");
      await tara.getByRole("link", { name: "Week" }).click();
      await tara.waitForURL((u) => u.searchParams.get("view") === "week");
      await tara.getByText("Workington").first().waitFor();
      const text = await tara.locator("main").innerText();
      assert.match(text, /9am\s+Workington\s+Clean 2 of 8 · Done/);
      await tara.screenshot({ path: `${SHOTS}/work-calendar-week-390.png`, fullPage: true });
    });

    await check("the month shows every clean of the claimed block, numbered", async () => {
      await tara.goto(`${BASE}/work/calendar?view=month&date=${ben.first}`);
      await tara.getByText("Clean 1 of 4").waitFor();
      assert.equal(ben.n, 4, "claiming booked the whole block");
      await tara.screenshot({ path: `${SHOTS}/work-calendar-month-390.png`, fullPage: true });
    });

    await check("no street address, access notes or key code anywhere in the calendar", async () => {
      for (const view of ["week", "month"]) {
        await tara.goto(`${BASE}/work/calendar?view=${view}`);
        const html = await tara.content();
        for (const secret of ["12 Test Street", "8 Sample Road", "CA14 9ZZ", "Side gate", "Ring the bell", "4721"]) {
          assert.ok(!html.includes(secret), `${view}: must not include "${secret}"`);
        }
      }
    });

    await check("on a desktop: a month grid and a week with real times, each clean opening the clean", async () => {
      await tara.setViewportSize({ width: 1440, height: 900 });
      await tara.goto(`${BASE}/work/calendar?view=month&date=${ben.first}`);
      await tara.getByRole("link", { name: /Whitehaven, clean 1 of 4/ }).last().waitFor();
      await tara.screenshot({ path: `${SHOTS}/work-calendar-month-1440.png`, fullPage: true });
      await tara.goto(`${BASE}/work/calendar?view=week`);
      await tara.getByRole("link", { name: /^9am, Workington, clean 2 of 8/ }).last().waitFor();
      await tara.screenshot({ path: `${SHOTS}/work-calendar-week-1440.png`, fullPage: true });
      await tara.getByRole("link", { name: /^9am, Workington, clean 2 of 8/ }).last().click();
      await tara.waitForURL(`${BASE}/work/visit/${ANNA_TODAY}`);
      await tara.getByText("Done. Thank you.").waitFor();
    });

    await check("a made-up date in the address bar just shows today", async () => {
      await tara.goto(`${BASE}/work/calendar?view=week&date=2026-02-31`);
      await tara.locator("main h1").waitFor();
      assert.ok(!/went wrong|didn.t load/i.test(await tara.locator("main").innerText()));
    });
    await ctx.close();
  }

  {
    const ctx = await browser.newContext(PHONE);
    const tara = await ctx.newPage();
    await signIn(tara, "tara.cleaner");
    await tara.waitForURL(`${BASE}/work`);
    await tara.goto(`${BASE}/work/today`);
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
