// Payments PR 11: a customer cancels a clean. In good time it's free; inside the notice
// period there's a fee, shown before they confirm, charged to their card, and the cleaner is
// paid their part. Against the running app, the real test database and the fake Stripe.
// Runs after the refund flows. Anna's cleans are Tara's: £50 = £37.50 + £12.50.
import assert from "node:assert/strict";
import pg from "pg";
import { TEST_JOB_SECRET } from "./charging.e2e.mjs";

const ANNA_SERIES = "00000000-0000-4000-c000-000000000001";
const ANNA_TODAY = "00000000-0000-4000-e000-000000000002";
const PHONE = { viewport: { width: 390, height: 844 }, locale: "en-GB", timezoneId: "Europe/London", deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1440, height: 900 }, locale: "en-GB", timezoneId: "Europe/London" };

export async function lateCancelFlows({ browser, BASE, check, signIn, SHOTS, stripe }) {
  console.log("e2e: cancelling a clean, and the late-cancellation fee (payments 11)");
  const c = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await c.connect();
  const one = async (text, params = []) => (await c.query(text, params)).rows[0];
  const settings = async (noticeHours, feePence) => {
    await c.query(`alter table public.settings disable trigger user`);
    await c.query(`update public.settings set cancel_notice_hours = $1, late_cancel_fee_pence = $2, late_cancel_split = $3`, [noticeHours, feePence, feePence ? "same_as_clean" : null]);
    await c.query(`alter table public.settings enable trigger user`);
  };
  const visit = (id) => one(`select status::text, cancel_reason, late_cancel_fee_pence as fee, cleaner_id is not null as cleaner from public.visits where id = $1`, [id]);
  const feePayment = (id) => one(`select id, status::text, amount_pence, cleaner_amount_pence, application_fee_pence from public.payments where visit_id = $1 and kind = 'late_cancel'`, [id]);
  const shoot = async (p, name) => { await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
  const before = await one(`select cancel_notice_hours as n, late_cancel_fee_pence as f, late_cancel_split as s from public.settings`);

  // By now the earlier flows have used up Anna's seeded cleans, so two more of the same block
  // (Tara's, same price and split) are put in the diary: one in three weeks, one next week.
  const add = async (days) => (await one(
    `insert into public.visits (series_id, customer_id, cleaner_id, scheduled_date, window_start, window_end, duration_minutes, price_pence, cleaner_earnings_pence, ping_fee_pence)
     select series_id, customer_id, cleaner_id, scheduled_date + $2::int, window_start, window_end, duration_minutes, price_pence, cleaner_earnings_pence, ping_fee_pence
       from public.visits where id = $1 returning id`, [ANNA_TODAY, days])).id;
  const LATER = await add(21);
  const ANNA_NEXT = await add(7);
  // The earlier flows leave Anna's block back on the board. A fee needs a cleaner holding it.
  const seriesBefore = await one(`select status::text, cleaner_id from public.series where id = $1`, [ANNA_SERIES]);
  const holdSeries = async (status, cleaner) => {
    await c.query(`alter table public.series disable trigger user`);
    await c.query(`update public.series set status = $2, cleaner_id = $3 where id = $1`, [ANNA_SERIES, status, cleaner]);
    await c.query(`alter table public.series enable trigger user`);
  };
  const { tara: taraId } = await one(`select cleaner_id as tara from public.visits where id = $1`, [ANNA_TODAY]);
  await settings(24, null);
  const [{ pm }] = (await c.query(`select stripe_payment_method_id as pm from public.series_billing where series_id = $1`, [ANNA_SERIES])).rows;
  await fetch(`${stripe.url}/__test/payment_methods`, { method: "POST", body: JSON.stringify({ id: pm, customer: "cus_testE2EAnna01", behaviour: "ok" }) });

  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  try {
    await signIn(page, "anna.customer");
    await page.waitForURL(`${BASE}/account`);

    await check("each coming clean can be cancelled from My cleans; in good time it's free and says until when", async () => {
      await page.locator(`[data-cancel="${LATER}"]`).click();
      await page.waitForURL(`${BASE}/account/clean/${LATER}/cancel`);
      await page.getByRole("heading", { name: "Cancel this clean?" }).waitFor();
      const text = await page.locator("main").innerText();
      assert.match(text, /Free to cancel/i);
      assert.match(text, /nothing is charged/);
      assert.match(text, /stays free to cancel until/);
      assert.equal(await page.locator("[data-cancel-quote]").getAttribute("data-cancel-quote"), "0");
      await shoot(page, "account-cancel-free-390");
    });

    await check("'Keep this clean' changes nothing", async () => {
      await page.getByRole("link", { name: "Keep this clean" }).click();
      await page.waitForURL(`${BASE}/account`);
      assert.equal((await visit(LATER)).status, "scheduled");
    });

    await check("cancelling in good time: the clean is cancelled, nothing is charged, and My cleans says so", async () => {
      await page.goto(`${BASE}/account/clean/${LATER}/cancel`);
      await page.getByRole("button", { name: "Cancel this clean" }).click();
      await page.waitForURL(`${BASE}/account?cancelled=free`);
      await page.getByText("That clean is cancelled. Nothing is charged for it.").waitFor();
      assert.deepEqual(await visit(LATER), { status: "cancelled", cancel_reason: "customer", fee: 0, cleaner: true });
      assert.equal(await feePayment(LATER), undefined);
      assert.equal(await page.locator(`[data-cancel="${LATER}"]`).count(), 0);
      const { n } = await one(`select count(*)::int as n from public.engine_alerts where visit_id = $1`, [LATER]);
      assert.equal(n, 0, "the office isn't alerted about an in-time cancellation");
    });

    await check("a cancelled clean can't be cancelled twice, and someone else's clean isn't found", async () => {
      await page.goto(`${BASE}/account/clean/${LATER}/cancel`);
      await page.getByRole("heading", { name: "This clean can’t be cancelled now." }).waitFor();
      assert.equal(await page.getByRole("button", { name: /Cancel/ }).count(), 0);
      const { id: bens } = await one(`select v.id from public.visits v join public.profiles p on p.id = v.customer_id where p.full_name ilike 'Ben%' limit 1`);
      await page.goto(`${BASE}/account/clean/${bens}/cancel`);
      await page.waitForLoadState("networkidle");
      assert.equal(await page.locator("[data-cancel-quote]").count(), 0);
      assert.equal(await page.getByRole("button", { name: /Cancel/ }).count(), 0);
      assert.equal((await one(`select status::text from public.visits where id = $1`, [bens])).status !== "cancelled", true);
    });

    await check("inside the notice period the fee is shown before anything happens", async () => {
      await settings(24 * 60, 1500); // 60 days' notice, so next week's clean is "late"
      await page.goto(`${BASE}/account/clean/${ANNA_NEXT}/cancel`);
      if (seriesBefore.status !== "claimed") {
        // Nobody holds the block: short notice, but nothing to pay.
        await page.getByRole("heading", { name: "Cancel this clean?" }).waitFor();
        assert.match(await page.locator("main").innerText(), /short notice, but there’s nothing to pay/);
        await holdSeries("claimed", taraId);
        await page.reload();
      }
      await page.getByRole("heading", { name: "Cancelling now costs £15.00." }).waitFor();
      assert.match(await page.locator("main").innerText(), /Short notice/i);
      await page.getByRole("button", { name: "Cancel and pay £15.00" }).waitFor();
      await shoot(page, "account-cancel-fee-390");
      const wide = await browser.newContext({ ...DESK, storageState: await ctx.storageState() });
      const wp = await wide.newPage();
      await wp.goto(`${BASE}/account/clean/${ANNA_NEXT}/cancel`);
      await wp.getByRole("heading", { name: "Cancelling now costs £15.00." }).waitFor();
      await shoot(wp, "account-cancel-fee-1440");
      await wide.close();
      assert.equal((await visit(ANNA_NEXT)).status, "scheduled");
    });

    await check("if the fee changes after the page loaded, nothing is cancelled and the new figure is shown", async () => {
      await settings(24 * 60, 2000);
      await page.getByRole("button", { name: "Cancel and pay £15.00" }).click();
      await page.getByRole("alert").filter({ hasText: "The cost of cancelling has changed" }).waitFor();
      assert.equal((await visit(ANNA_NEXT)).status, "scheduled");
      assert.equal(await feePayment(ANNA_NEXT), undefined);
      await page.getByRole("button", { name: "Cancel and pay £20.00" }).waitFor();
    });

    await check("cancelling late: the clean is cancelled with the fee they agreed, split like the clean, and the office is told", async () => {
      await page.getByRole("button", { name: "Cancel and pay £20.00" }).click();
      await page.waitForURL(`${BASE}/account?cancelled=fee`);
      await page.getByText("The late-cancellation fee will be charged to your card.").waitFor();
      assert.deepEqual(await visit(ANNA_NEXT), { status: "cancelled", cancel_reason: "customer_late", fee: 2000, cleaner: true });
      const p = await feePayment(ANNA_NEXT);
      assert.deepEqual({ s: p.status, a: p.amount_pence, c: p.cleaner_amount_pence, f: p.application_fee_pence }, { s: "pending", a: 2000, c: 1500, f: 500 });
      const { n } = await one(`select count(*)::int as n from public.engine_alerts where visit_id = $1 and kind = 'visit_cancelled_late' and resolved_at is null`, [ANNA_NEXT]);
      assert.equal(n, 1);
      await shoot(page, "account-cancelled-fee-390");
    });

    await check("the charge job takes the fee from Anna's card as a destination charge, and Tara's part becomes her earnings", async () => {
      const intentsBefore = stripe.state.paymentIntents.size;
      const res = await fetch(`${BASE}/api/stripe/charge-due`, { method: "POST", headers: { authorization: `Bearer ${TEST_JOB_SECRET}` } });
      const json = await res.json();
      assert.equal(json.succeeded, 1, JSON.stringify(json));
      assert.equal(stripe.state.paymentIntents.size, intentsBefore + 1);
      const pi = [...stripe.state.paymentIntents.values()].at(-1);
      assert.deepEqual({ amount: pi.amount, fee: pi.application_fee_amount }, { amount: 2000, fee: 500 });
      const p = await feePayment(ANNA_NEXT);
      assert.equal(p.status, "succeeded");
      const po = await one(`select status::text, amount_pence from public.payouts where payment_id = $1`, [p.id]);
      assert.deepEqual(po, { status: "pending", amount_pence: 1500 });
    });
    await ctx.close();

    const tara = await browser.newContext(PHONE);
    const tp = await tara.newPage();
    await check("Tara sees her part of the fee in her earnings, said plainly, and the clean is off her day", async () => {
      await signIn(tp, "tara.cleaner");
      await tp.waitForURL(`${BASE}/work`);
      await tp.goto(`${BASE}/work/earnings`);
      const row = tp.locator("[data-late-cancel]");
      await row.waitFor();
      const text = await row.innerText();
      assert.match(text, /Cancelled by the customer at short notice/);
      assert.match(text, /£15\.00/);
      assert.doesNotMatch(text, /£20\.00/, "the customer's fee isn't the cleaner's business");
      await shoot(tp, "work-earnings-late-cancel-390");
    });
    await tara.close();

    const admin = await browser.newContext(DESK);
    const ap = await admin.newPage();
    await check("the office sees the late cancellation as an alert and the fee in Payments", async () => {
      await signIn(ap, "admin");
      await ap.waitForURL(`${BASE}/admin`);
      await ap.goto(`${BASE}/admin/jobs`);
      await ap.getByText("Cancelled at short notice").first().waitFor();
      await ap.goto(`${BASE}/admin/payments`);
      const p = await feePayment(ANNA_NEXT);
      const row = ap.locator(`[data-payment="${p.id}"]`);
      const text = await row.innerText();
      assert.match(text, /Late cancellation fee/);
      assert.match(text, /£20\.00/);
      await ap.getByRole("heading", { name: "Every clean's money." }).waitFor();
      await ap.waitForLoadState("networkidle");
      await shoot(ap, "admin-payments-late-cancel-1440");
      await row.click();
      await ap.waitForURL(`${BASE}/admin/payments/${p.id}`);
      assert.doesNotMatch(await ap.locator("main").innerText(), /pi_|ch_|acct_/);
    });

    await check("the office waives half the fee: only fee reasons are offered, both give back their part, and Tara's earnings drop to match", async () => {
      const p = await feePayment(ANNA_NEXT);
      await ap.getByRole("heading", { name: "Refund this fee." }).waitFor();
      const main = await ap.locator("main").innerText();
      assert.match(main, /Fee waived/);
      assert.doesNotMatch(main, /The clean wasn't right|The cleaner didn't come/);
      await ap.getByLabel("Amount to refund").fill("10");
      await ap.getByText("Fee waived").click();
      assert.equal(await ap.locator('[data-part="cleaner"]').innerText(), "£7.50");
      assert.equal(await ap.locator('[data-part="ping"]').innerText(), "£2.50");
      await shoot(ap, "admin-payment-fee-refund-form-1440");
      const sentBefore = stripe.state.refunds.size;
      await ap.getByRole("button", { name: "Refund £10.00" }).click();
      await ap.getByText("£10.00 refunded. It reaches the customer's card in 5 to 10 days.").waitFor();
      assert.equal(stripe.state.refunds.size, sentBefore + 1);
      const re = [...stripe.state.refunds.values()].at(-1);
      assert.equal(re.amount, 1000);
      const r = await one(`select status, cleaner_part_pence as c, ping_part_pence as g, reason from public.refunds where payment_id = $1`, [p.id]);
      assert.deepEqual(r, { status: "succeeded", c: 750, g: 250, reason: "fee_waived" });
      const after = await one(`select pay.status::text as pay, pay.refunded_pence as back, po.status::text as po, po.amount_pence as owed
                                 from public.payments pay join public.payouts po on po.payment_id = pay.id where pay.id = $1`, [p.id]);
      assert.deepEqual(after, { pay: "partially_refunded", back: 1000, po: "pending", owed: 750 });
      const { n } = await one(`select count(*)::int as n from public.audit_log a join public.refunds r on r.id = a.entity_id
                                where r.payment_id = $1 and a.entity = 'refunds' and a.action = 'insert' and a.actor_id = '00000000-0000-4000-a000-000000000001'`, [p.id]);
      assert.ok(n >= 1, "the refund is in the audit log against the admin");
    });
    await admin.close();
  } finally {
    await holdSeries(seriesBefore.status, seriesBefore.cleaner_id).catch(() => {});
    await c.query(`alter table public.settings disable trigger user`);
    await c.query(`update public.settings set cancel_notice_hours = $1, late_cancel_fee_pence = $2, late_cancel_split = $3`, [before.n, before.f, before.s]);
    await c.query(`alter table public.settings enable trigger user`);
    await c.query(`update public.engine_alerts set resolved_at = now() where kind = 'visit_cancelled_late' and resolved_at is null`);
    await c.end();
    await ctx.close().catch(() => {});
  }
}
