// A customer cancels a clean, then the rest of their block, in a real browser against the
// running app and the real test database. Runs last: it ends Anna's block.
import assert from "node:assert/strict";
import pg from "pg";

const ANNA_SERIES = "00000000-0000-4000-c000-000000000001";

export async function customerCancelFlows({ browser, BASE, check, signIn, SHOTS }) {
  console.log("e2e: a customer cancels a clean");
  const c = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await c.connect();
  const sql = async (text, params) => (await c.query(text, params)).rows;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const scheduled = () => sql(`select id, scheduled_date::text as day from public.visits where series_id = $1 and status = 'scheduled' order by scheduled_date`, [ANNA_SERIES]);
  /** The page's answer after a cancel: the green note, or the red one (shown in the failure, so it says why). */
  const answer = async (expected) => {
    const note = page.locator("main").locator('[role="status"], [role="alert"]').filter({ hasText: /\S/ }).first();
    await note.waitFor();
    assert.equal((await note.innerText()).trim(), expected);
  };
  const label = (ymd) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
  try {
    // The admin settings flow before this changed the numbers; put Carl's notice back, with a test late fee.
    await sql(`update public.settings set cancel_notice_hours = 24, late_cancel_fee_pence = 1500`);
    // By now the earlier flows have used Anna's block up, so give it three more cleans to come
    // (copies of one of its own cleans, so prices and the cleaner are the block's real ones).
    await sql(`update public.series s set status = 'claimed', end_reason = null, offering_since = null,
                      cleaner_id = coalesce(s.cleaner_id, (select v.cleaner_id from public.visits v where v.series_id = s.id and v.cleaner_id is not null limit 1))
                where s.id = $1 and s.status <> 'claimed'`, [ANNA_SERIES]);
    for (const days of [9, 16, 23]) {
      await sql(
        `insert into public.visits
         select (jsonb_populate_record(null::public.visits, to_jsonb(v) || jsonb_build_object(
                   'id', gen_random_uuid(), 'scheduled_date', (now() at time zone 'Europe/London')::date + $2::int, 'status', 'scheduled',
                   'started_at', null, 'completed_at', null, 'cancelled_at', null, 'cancelled_by', null, 'cancel_reason', null,
                   'couldnt_do_count', 0, 'late_cancel_fee_pence', 0))).*
           from (select * from public.visits where series_id = $1 and cleaner_id is not null order by scheduled_date limit 1) v`, [ANNA_SERIES, days]);
    }
    const before = await scheduled();
    assert.ok(before.length >= 3, `Anna needs three cleans still to come for this flow (has ${before.length})`);
    // The first one becomes a clean at short notice: tomorrow, from midnight (always under 24 hours away).
    const late = before[0];
    const free = before.at(-1);
    await sql(`update public.visits set scheduled_date = (now() at time zone 'Europe/London')::date + 1, window_start = '00:00', window_end = '04:00' where id = $1`, [late.id]);
    const [{ day: lateDay }] = await sql(`select scheduled_date::text as day from public.visits where id = $1`, [late.id]);

    await check("the booking lists the block's cleans; cancelling with notice says it's free, and asks before doing it", async () => {
      await signIn(page, "anna.customer");
      await page.waitForURL((u) => u.pathname === "/account");
      await page.goto(`${BASE}/account/booking/${ANNA_SERIES}`);
      await page.getByRole("heading", { name: "Your cleans" }).waitFor();
      await page.getByRole("button", { name: `Cancel the clean on ${label(free.day)}` }).click();
      const ask = page.getByRole("group", { name: `Cancel the clean on ${label(free.day)}?` });
      await ask.waitFor();
      assert.match(await ask.innerText(), /It’s free: there’s more than 24 hours’ notice\./);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${SHOTS}/account-cancel-free-1440.png`, fullPage: true });

      await ask.getByRole("button", { name: "Keep it" }).click();
      assert.equal((await scheduled()).length, before.length, "nothing was cancelled by asking");

      await page.getByRole("button", { name: `Cancel the clean on ${label(free.day)}` }).click();
      await page.getByRole("button", { name: "Yes, cancel this clean" }).click();
      await answer("Cancelled. Nothing is charged for that clean.");
      const [v] = await sql(`select status::text, cancel_reason, late_cancel_fee_pence as fee from public.visits where id = $1`, [free.id]);
      assert.deepEqual(v, { status: "cancelled", cancel_reason: "customer", fee: 0 });
      assert.equal((await sql(`select 1 from public.engine_alerts where visit_id = $1 and kind = 'cancelled_late'`, [free.id])).length, 0);
    });

    await check("at short notice it says so, with the late fee, before she confirms; the office is told to ring the cleaner", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: `Cancel the clean on ${label(lateDay)}` }).click();
      const ask = page.getByRole("group", { name: `Cancel the clean on ${label(lateDay)}?` });
      await ask.waitFor();
      assert.match(await ask.innerText(), /Your cleaner has less than 24 hours’ notice\. A late cancellation fee of £15\.00 applies\./);
      await page.screenshot({ path: `${SHOTS}/account-cancel-late-390.png`, fullPage: true });
      await ask.getByRole("button", { name: "Yes, cancel this clean" }).click();
      await answer("Cancelled. We’ll let your cleaner know straight away.");

      const [v] = await sql(`select status::text, cancel_reason, late_cancel_fee_pence as fee from public.visits where id = $1`, [late.id]);
      assert.deepEqual(v, { status: "cancelled", cancel_reason: "customer_late", fee: 1500 });
      const alerts = await sql(`select message from public.engine_alerts where visit_id = $1 and kind = 'cancelled_late' and resolved_at is null`, [late.id]);
      assert.equal(alerts.length, 1);
      assert.match(alerts[0].message, /Ring the cleaner.*late fee of £15\.00 is due/);
      assert.equal((await sql(`select 1 from public.payments where visit_id = $1`, [late.id])).length, 0, "no fee is taken from the card");
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    await check("the cleaner sees the cancelled clean as not going ahead", async () => {
      const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await other.newPage();
      try {
        await signIn(p, "tara.cleaner");
        await p.waitForURL((u) => u.pathname.startsWith("/work"));
        await p.goto(`${BASE}/work/visit/${late.id}`);
        await p.locator("main").waitFor();
        const text = await p.locator("main").innerText();
        assert.doesNotMatch(text, /Start this clean|Start clean/i);
        assert.match(text, /cancel|not going ahead|isn.t going ahead/i);
      } finally { await other.close(); }
    });

    await check("\"Cancel the rest of my cleans\" ends the block, and finished cleans stay as they were", async () => {
      const left = (await scheduled()).length;
      const [{ n: done }] = await sql(`select count(*)::int as n from public.visits where series_id = $1 and status = 'completed'`, [ANNA_SERIES]);
      await page.goto(`${BASE}/account/booking/${ANNA_SERIES}`);
      assert.ok(left >= 1, "one clean is still to come");
      await page.getByRole("button", { name: "Cancel the rest of my cleans" }).click();
      const ask = page.getByRole("group", { name: "Cancel the rest of your cleans?" });
      await ask.waitFor();
      assert.match(await ask.innerText(), /Cleans already finished stay as they are\./);
      await ask.getByRole("button", { name: "Yes, cancel them" }).click();
      await answer("Your remaining cleans are cancelled. You’re welcome back any time.");

      const [s] = await sql(`select status::text, end_reason from public.series where id = $1`, [ANNA_SERIES]);
      assert.deepEqual(s, { status: "ended", end_reason: "Cancelled by the customer" });
      assert.equal((await scheduled()).length, 0);
      const [{ n: stillDone }] = await sql(`select count(*)::int as n from public.visits where series_id = $1 and status = 'completed'`, [ANNA_SERIES]);
      assert.equal(stillDone, done);
      await page.reload();
      await page.getByRole("heading", { name: "Your cleans" }).waitFor();
      assert.equal(await page.getByRole("button", { name: /^Cancel/ }).count(), 0, "nothing left to cancel");
      await page.screenshot({ path: `${SHOTS}/account-cancel-ended-1440.png`, fullPage: true });
    });
  } finally {
    await ctx.close();
    await c.end();
  }
}
