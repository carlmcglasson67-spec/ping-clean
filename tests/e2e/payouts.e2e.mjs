// Payments PR 9: a cleaner is paid after the check period, end to end against the running
// app, the real test database and the fake Stripe. Runs after the charging flows, which leave
// Anna's clean today (Tara's) paid: £50, of which £37.50 is Tara's.
import assert from "node:assert/strict";
import pg from "pg";
import { stripeEvent, stripeSignature, TEST_CONNECT_WEBHOOK_SECRET } from "../stripe/fake-stripe.mjs";
import { TEST_JOB_SECRET } from "./charging.e2e.mjs";

const TARA = "00000000-0000-4000-a000-000000000004";
const ANNA_TODAY = "00000000-0000-4000-e000-000000000002";
const PHONE = { viewport: { width: 390, height: 844 }, locale: "en-GB", timezoneId: "Europe/London", deviceScaleFactor: 2 };

export async function payoutFlows({ browser, BASE, check, signIn, SHOTS, stripe }) {
  console.log("e2e: paying cleaners (payments 9)");
  const c = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await c.connect();
  const one = async (text, params = []) => (await c.query(text, params)).rows[0];
  const payout = () => one(`select po.id, po.status::text, po.amount_pence, po.available_after > now() as checking, po.batch_id, po.stripe_payout_id as po, pay.status::text as payment
                              from public.payouts po join public.payments pay on pay.id = po.payment_id where po.visit_id = $1`, [ANNA_TODAY]);
  const runJob = async (secret = TEST_JOB_SECRET) => {
    const res = await fetch(`${BASE}/api/stripe/payouts-due`, { method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {} });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const { acct } = await one(`select stripe_account_id as acct from public.cleaners where id = $1`, [TARA]);
  const cleared = (available) => fetch(`${stripe.url}/__test/balance/${acct}`, { method: "POST", body: JSON.stringify({ available }) });

  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  const step = () => page.locator(`[data-earning-step]`).first().getAttribute("data-earning-step");
  const shoot = async (p, name) => { await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
  try {
    await check("the job's address lets nobody in without the secret, and takes POST only", async () => {
      assert.equal((await runJob("")).status, 401);
      assert.equal((await runJob("wrong-secret-wrong-secret-wrong-secret-0000")).status, 401);
      assert.equal((await fetch(`${BASE}/api/stripe/payouts-due`)).status, 405);
    });

    await check("the paid clean is Tara's earnings, in its check period: nothing goes to the bank yet", async () => {
      const p = await payout();
      assert.deepEqual({ status: p.status, amount: p.amount_pence, checking: p.checking, payment: p.payment }, { status: "pending", amount: 3750, checking: true, payment: "succeeded" });
      await cleared(10_000);
      const run = await runJob();
      assert.deepEqual(run, { status: 200, json: { cleaners: 0, sent: 0, waiting: 0, paid: 0, failed: 0, errors: 0 } });
      assert.equal(stripe.state.payouts.size, 0);

      await signIn(page, "tara.cleaner");
      await page.waitForURL(`${BASE}/work`);
      await page.getByRole("link", { name: "Your earnings, clean by clean" }).click();
      await page.waitForURL(`${BASE}/work/earnings`);
      await page.getByRole("heading", { name: "Your earnings." }).waitFor();
      assert.equal(await step(), "checking");
      assert.equal(await page.locator('[data-total="on-its-way"]').innerText(), "£37.50");
      const text = await page.locator("main").innerText();
      assert.match(text, /In its check period/);
      assert.doesNotMatch(text, /acct_|po_|pi_|declin|card failed/i, "no Stripe ids, nothing about the customer's card");
      await shoot(page, "work-earnings-checking-390");
    });

    await check("past the check period but not yet cleared at Stripe: it waits, and nothing fails", async () => {
      await c.query(`update public.payouts set available_after = now() - interval '1 minute' where visit_id = $1`, [ANNA_TODAY]);
      await cleared(0);
      const run = await runJob();
      assert.deepEqual(run.json, { cleaners: 1, sent: 0, waiting: 1, paid: 0, failed: 0, errors: 0 });
      assert.equal((await payout()).status, "pending");
      assert.equal(stripe.state.payouts.size, 0);
      await page.reload();
      assert.equal(await step(), "next_payout");
    });

    await check("once it has cleared, one bank payout leaves Tara's own Stripe account for exactly her earnings", async () => {
      await cleared(3750);
      const run = await runJob();
      assert.deepEqual(run.json, { cleaners: 1, sent: 1, waiting: 0, paid: 0, failed: 0, errors: 0 });
      const [po] = [...stripe.state.payouts.values()];
      const p = await payout();
      assert.deepEqual({ amount: po.amount, account: po.__account, batch: po.metadata.batch_id }, { amount: 3750, account: acct, batch: p.batch_id });
      assert.deepEqual({ status: p.status, po: p.po }, { status: "in_batch", po: po.id });
      // Running it again sends nothing more.
      assert.deepEqual((await runJob()).json, { cleaners: 0, sent: 0, waiting: 0, paid: 0, failed: 0, errors: 0 });
      assert.equal(stripe.state.payouts.size, 1);
      await page.reload();
      assert.equal(await step(), "sent");
      assert.match(await page.locator("main").innerText(), /Sent to your bank[\s\S]*Should reach your account on/);
    });

    await check("Stripe's signed payout.paid marks it paid; a forged amount, another account and a replay change nothing", async () => {
      const [po] = [...stripe.state.payouts.values()];
      const post = async (ev, signature) => {
        const raw = JSON.stringify(ev);
        const res = await fetch(`${BASE}/api/stripe/connect-webhook`, { method: "POST",
          headers: { "content-type": "application/json", "stripe-signature": signature ?? stripeSignature(raw, TEST_CONNECT_WEBHOOK_SECRET) }, body: raw });
        return res.status;
      };
      const body = { id: po.id, object: "payout", amount: po.amount, currency: "gbp", status: "paid", arrival_date: po.arrival_date, failure_code: null, metadata: po.metadata };
      assert.equal(await post(stripeEvent("payout.paid", body, { account: acct }), "t=1,v1=00"), 400);
      assert.equal(await post(stripeEvent("payout.paid", { ...body, amount: 999_999 }, { account: acct })), 200);
      assert.equal(await post(stripeEvent("payout.paid", body, { account: "acct_testSomeoneElse1" })), 200);
      assert.equal((await payout()).status, "in_batch", "neither the forged amount nor the wrong account marked it paid");
      const real = stripeEvent("payout.paid", body, { account: acct });
      assert.equal(await post(real), 200);
      assert.equal(await post(real), 200);
      assert.equal((await payout()).status, "paid");
      const { n } = await one(`select count(*)::int as n from public.payouts where visit_id = $1`, [ANNA_TODAY]);
      assert.equal(n, 1);
    });

    await check("Tara sees it paid, on her phone and at a desk; another cleaner sees none of it", async () => {
      await page.reload();
      assert.equal(await step(), "paid");
      assert.equal(await page.locator('[data-total="on-its-way"]').innerText(), "£0.00");
      await shoot(page, "work-earnings-paid-390");
      const wide = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-GB", timezoneId: "Europe/London" });
      const p = await wide.newPage();
      await signIn(p, "tara.cleaner");
      await p.waitForURL(`${BASE}/work`);
      await p.goto(`${BASE}/work/earnings`);
      await p.getByRole("heading", { name: "Clean by clean." }).waitFor();
      await shoot(p, "work-earnings-paid-1440");
      await wide.close();

      const other = await browser.newContext(PHONE);
      const a = await other.newPage();
      await signIn(a, "alex.cleaner");
      await a.waitForURL(`${BASE}/work`);
      await a.goto(`${BASE}/work/earnings`);
      await a.getByRole("heading", { name: "Nothing earned yet" }).waitFor();
      await other.close();
    });

    await check("a bank that says no: Tara is told, with one button to check her details", async () => {
      // As the bank's refusal leaves it (the database tests cover the path there).
      await c.query(`alter table public.payouts disable trigger user`);
      await c.query(`update public.payouts set status = 'failed', paid_at = null where visit_id = $1`, [ANNA_TODAY]);
      await c.query(`alter table public.payouts enable trigger user`);
      await page.reload();
      assert.equal(await step(), "bank_refused");
      await page.getByText("Your bank didn’t accept £37.50.").waitFor();
      await shoot(page, "work-earnings-bank-refused-390");
      await page.getByRole("link", { name: "Check my bank details" }).click();
      await page.waitForURL(`${BASE}/work/payments`);
      await c.query(`alter table public.payouts disable trigger user`);
      await c.query(`update public.payouts set status = 'paid', paid_at = now() where visit_id = $1`, [ANNA_TODAY]);
      await c.query(`alter table public.payouts enable trigger user`);
    });
  } finally {
    await ctx.close();
    await c.end();
  }
}
