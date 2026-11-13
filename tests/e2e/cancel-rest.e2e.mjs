// Cancel the rest of my cleans. Anna cancels everything still to come in a block: one clean
// is at short notice (a fee, shown before she confirms), the other is free; the block ends.
// Against the running app and the real test database. Uses its own copy of Anna's block
// (Tara's, £50 = £37.50 + £12.50) so nothing the earlier flows left behind gets in the way.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const ANNA_SERIES = "00000000-0000-4000-c000-000000000001";
const ANNA_TODAY = "00000000-0000-4000-e000-000000000002";
const PHONE = { viewport: { width: 390, height: 844 }, locale: "en-GB", timezoneId: "Europe/London", deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1440, height: 900 }, locale: "en-GB", timezoneId: "Europe/London" };

export async function cancelRestFlows({ browser, BASE, check, signIn, SHOTS }) {
  console.log("e2e: cancelling the rest of a block");
  const c = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await c.connect();
  const one = async (text, params = []) => (await c.query(text, params)).rows[0];
  const shoot = async (p, name) => { await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
  const before = await one(`select cancel_notice_hours as n, late_cancel_fee_pence as f, late_cancel_split as s from public.settings`);
  const settings = async (n, f, s) => {
    await c.query(`alter table public.settings disable trigger user`);
    await c.query(`update public.settings set cancel_notice_hours = $1, late_cancel_fee_pence = $2, late_cancel_split = $3`, [n, f, s]);
    await c.query(`alter table public.settings enable trigger user`);
  };

  const SERIES = randomUUID();
  const { tara } = await one(`select cleaner_id as tara from public.visits where id = $1`, [ANNA_TODAY]);
  await c.query(`alter table public.series disable trigger user`);
  await c.query(
    `insert into public.series
     select (jsonb_populate_record(s, jsonb_build_object('id', $2::uuid, 'client_request_id', gen_random_uuid(), 'status', 'claimed', 'cleaner_id', $3::uuid, 'end_reason', null))).*
       from public.series s where s.id = $1`, [ANNA_SERIES, SERIES, tara]);
  await c.query(`alter table public.series enable trigger user`);
  const add = async (when) => (await one(
    `insert into public.visits (series_id, customer_id, cleaner_id, scheduled_date, window_start, window_end, duration_minutes, price_pence, cleaner_earnings_pence, ping_fee_pence)
     select $2::uuid, customer_id, cleaner_id, ((now() + $3::interval) at time zone 'Europe/London')::date,
            ((now() + $3::interval) at time zone 'Europe/London')::time(0), '23:59:59', duration_minutes, price_pence, cleaner_earnings_pence, ping_fee_pence
       from public.visits where id = $1 returning id`, [ANNA_TODAY, SERIES, when])).id;
  const SOON = await add("5 hours");
  const LATER = await add("15 days");
  await settings(24, 1500, "same_as_clean");

  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  try {
    await signIn(page, "anna.customer");
    await page.waitForURL(`${BASE}/account`);

    await check("the booking page offers it, and the next screen says what it costs before anything happens", async () => {
      await page.goto(`${BASE}/account/booking/${SERIES}`);
      await page.getByRole("link", { name: "Cancel the rest of my cleans" }).click();
      await page.waitForURL(`${BASE}/account/booking/${SERIES}/cancel`);
      await page.getByRole("heading", { name: /Cancelling now costs £15/ }).waitFor();
      const text = await page.locator("main").innerText();
      assert.match(text, /Short notice/i);
      assert.match(text, /All 2 cleans still to come will be cancelled/);
      assert.match(text, /One is close enough/);
      assert.equal(await page.locator("[data-cancel-quote]").getAttribute("data-cancel-quote"), "1500");
      const s = await one(`select status::text from public.series where id = $1`, [SERIES]);
      assert.equal(s.status, "claimed", "looking changes nothing");
      await shoot(page, "account-cancel-rest-390");
      const desk = await browser.newContext({ ...DESK, storageState: await ctx.storageState() });
      const wide = await desk.newPage();
      await wide.goto(`${BASE}/account/booking/${SERIES}/cancel`);
      await wide.getByRole("heading", { name: /Cancelling now costs/ }).waitFor();
      await shoot(wide, "account-cancel-rest-1440");
      await desk.close();
    });

    await check("if the fee changed while the page was open, nothing is cancelled and she's told", async () => {
      await settings(24, 2000, "same_as_clean");
      await page.getByRole("button", { name: /Cancel them and pay £15/ }).click();
      await page.getByRole("alert").filter({ hasText: /cost of cancelling has changed/ }).waitFor();
      const n = await one(`select count(*)::int as n from public.visits where series_id = $1 and status = 'cancelled'`, [SERIES]);
      assert.equal(n.n, 0);
      await page.getByRole("heading", { name: /Cancelling now costs £20/ }).waitFor();
    });

    await check("confirmed: both cleans cancelled, the fee is on the late one only, the block ends, the office is told", async () => {
      await page.getByRole("button", { name: /Cancel them and pay £20/ }).click();
      await page.waitForURL(`${BASE}/account?cancelled=block-fee`);
      await page.locator('[data-cancelled="block-fee"]').waitFor();
      const s = await one(`select status::text, end_reason from public.series where id = $1`, [SERIES]);
      assert.equal(s.status, "ended");
      const soon = await one(`select status::text, cancel_reason, late_cancel_fee_pence as fee from public.visits where id = $1`, [SOON]);
      const later = await one(`select status::text, cancel_reason, late_cancel_fee_pence as fee from public.visits where id = $1`, [LATER]);
      assert.deepEqual(soon, { status: "cancelled", cancel_reason: "customer_late", fee: 2000 });
      assert.deepEqual(later, { status: "cancelled", cancel_reason: "customer", fee: 0 });
      const pay = await one(`select amount_pence, cleaner_amount_pence, application_fee_pence from public.payments where visit_id = $1 and kind = 'late_cancel'`, [SOON]);
      assert.deepEqual(pay, { amount_pence: 2000, cleaner_amount_pence: 1500, application_fee_pence: 500 });
      const alerts = await one(`select count(*) filter (where kind = 'block_closed')::int as closed, count(*) filter (where kind = 'visit_cancelled_late')::int as late
                                  from public.engine_alerts where series_id = $1 and resolved_at is null`, [SERIES]);
      assert.deepEqual(alerts, { closed: 1, late: 1 });
    });

    await check("an ended block can't be cancelled again, and another customer can't see the page at all", async () => {
      await page.goto(`${BASE}/account/booking/${SERIES}/cancel`);
      await page.getByRole("heading", { name: "This block has already ended." }).waitFor();
      await page.goto(`${BASE}/account/booking/${SERIES}`);
      assert.equal(await page.getByRole("link", { name: "Cancel the rest of my cleans" }).count(), 0);
      const other = await browser.newContext(PHONE);
      const ben = await other.newPage();
      await signIn(ben, "ben.customer");
      await ben.waitForURL(`${BASE}/account`);
      await ben.goto(`${BASE}/account/booking/${SERIES}/cancel`);
      const seen = await ben.locator("body").innerText();
      assert.doesNotMatch(seen, /Your block|Still to come|already ended|Cancel the rest/i, "nothing about Anna's block is shown");
      assert.equal(await ben.locator("[data-cancel-quote]").count(), 0);
      await other.close();
    });
  } finally {
    // The copy goes away quietly: its fee is never charged and its alerts are settled.
    await settings(before.n, before.f, before.s).catch(() => {});
    await c.query(`update public.payments set status = 'failed' where visit_id in (select id from public.visits where series_id = $1) and status = 'pending'`, [SERIES]).catch(() => {});
    await c.query(`update public.engine_alerts set resolved_at = now() where series_id = $1 and resolved_at is null`, [SERIES]).catch(() => {});
    await c.end();
    await ctx.close().catch(() => {});
  }
}
