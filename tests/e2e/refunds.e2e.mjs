// Payments PR 10: the Ping team refunds a clean, end to end through the admin console, the
// real database rules and the fake Stripe. Runs after the payout flows, which leave Anna's
// clean today (Tara's) paid, £50 = £37.50 Tara + £12.50 Ping, and Tara already paid for it.
import assert from "node:assert/strict";
import pg from "pg";
import { stripeEvent, stripeSignature, TEST_WEBHOOK_SECRET } from "../stripe/fake-stripe.mjs";

const ANNA_TODAY = "00000000-0000-4000-e000-000000000002";

export async function refundFlows({ browser, BASE, check, signIn, SHOTS, stripe }) {
  console.log("e2e: refunds and chargebacks (payments 10)");
  const c = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await c.connect();
  const one = async (text, params = []) => (await c.query(text, params)).rows[0];
  const payment = () => one(`select id, status::text, refunded_pence, stripe_payment_intent_id as intent from public.payments where visit_id = $1 and kind = 'visit'`, [ANNA_TODAY]);
  const refunds = async () => (await c.query(`select r.status, r.amount_pence, r.cleaner_part_pence, r.ping_part_pence, r.reason, r.stripe_refund_id as re
                                                from public.refunds r join public.payments p on p.id = r.payment_id where p.visit_id = $1 order by r.created_at`, [ANNA_TODAY])).rows;
  const shoot = async (p, name) => { await p.evaluate(() => document.fonts.ready); await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-GB", timezoneId: "Europe/London" });
  const page = await ctx.newPage();
  try {
    const { id } = await payment();
    await signIn(page, "admin");
    await page.waitForURL(`${BASE}/admin`);

    await check("Payments lists the paid clean with who, when and how much, and leads to it", async () => {
      await page.getByRole("link", { name: "Payments", exact: true }).click();
      await page.waitForURL(`${BASE}/admin/payments`);
      await page.getByRole("heading", { name: "Every clean's money." }).waitFor();
      const row = page.locator(`[data-payment="${id}"]`);
      const text = await row.innerText();
      assert.match(text, /Anna/);
      assert.match(text, /Paid/);
      assert.match(text, /£50\.00/);
      assert.doesNotMatch(await page.locator("main").innerText(), /pi_|ch_|acct_|re_test/, "no Stripe ids on screen");
      await shoot(page, "admin-payments-1440");
      await row.click();
      await page.waitForURL(`${BASE}/admin/payments/${id}`);
    });

    await check("the refund form shows who will carry it before anything is sent, and won't take more than is left", async () => {
      await page.getByRole("heading", { name: "Refund this clean." }).waitFor();
      const send = page.getByRole("button", { name: /^Refund/ });
      assert.equal(await send.isDisabled(), true);
      await page.getByLabel("Amount to refund").fill("50.01");
      await page.getByText("Only £50.00 is left to refund.").waitFor();
      await page.getByLabel("Amount to refund").fill("10");
      await page.getByText("The clean wasn't right").click();
      assert.equal(await page.locator('[data-part="cleaner"]').innerText(), "£7.50");
      assert.equal(await page.locator('[data-part="ping"]').innerText(), "£2.50");
      await page.getByText("The cleaner has already been paid for this clean").waitFor();
      await shoot(page, "admin-payment-refund-form-1440");
      assert.equal(stripe.state.refunds.size, 0, "nothing sent yet");
    });

    await check("a shared part refund: one Stripe refund that reverses the cleaner's part, the page and the database agree", async () => {
      await page.getByRole("button", { name: "Refund £10.00" }).click();
      await page.getByText("£10.00 refunded. It reaches the customer's card in 5 to 10 days.").waitFor();
      const [re] = [...stripe.state.refunds.values()];
      const p = await payment();
      assert.deepEqual({ amount: re.amount, intent: re.payment_intent, reverse: re.__reverse_transfer, fee: re.__refund_application_fee }, { amount: 1000, intent: p.intent, reverse: true, fee: true });
      assert.deepEqual(await refunds(), [{ status: "succeeded", amount_pence: 1000, cleaner_part_pence: 750, ping_part_pence: 250, reason: "clean_quality", re: re.id }]);
      assert.deepEqual({ status: p.status, refunded: p.refunded_pence }, { status: "partially_refunded", refunded: 1000 });
      await page.getByText("Part refunded").first().waitFor();
      assert.equal(await page.locator("[data-refunded]").innerText(), "£10.00");
      await page.getByText("£7.50 from the cleaner, £2.50 from Ping.").waitFor();
      // Tara had already been paid: her paid row is untouched and the team is told.
      const po = await one(`select status::text, amount_pence from public.payouts where visit_id = $1`, [ANNA_TODAY]);
      assert.deepEqual(po, { status: "paid", amount_pence: 3750 });
      const { n } = await one(`select count(*)::int as n from public.engine_alerts where visit_id = $1 and kind = 'refund_after_payout' and resolved_at is null`, [ANNA_TODAY]);
      assert.equal(n, 1);
    });

    await check("Stripe's signed refund.updated changes nothing more; a forged amount and an unsigned one are refused", async () => {
      const [re] = [...stripe.state.refunds.values()];
      const post = async (ev, signature) => {
        const raw = JSON.stringify(ev);
        return (await fetch(`${BASE}/api/stripe/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature ?? stripeSignature(raw, TEST_WEBHOOK_SECRET) }, body: raw })).status;
      };
      const body = { id: re.id, object: "refund", amount: re.amount, currency: "gbp", status: "succeeded", failure_reason: null, payment_intent: re.payment_intent, metadata: re.metadata };
      assert.equal(await post(stripeEvent("refund.updated", body), "t=1,v1=00"), 400);
      assert.equal(await post(stripeEvent("refund.updated", body)), 200);
      assert.equal(await post(stripeEvent("refund.updated", { ...body, amount: 5000 })), 200);
      assert.equal(await post(stripeEvent("refund.failed", { ...body, id: "re_testSomeoneElses01" })), 200);
      assert.equal((await refunds()).length, 1);
      assert.deepEqual((({ status, refunded_pence }) => ({ status, refunded_pence }))(await payment()), { status: "partially_refunded", refunded_pence: 1000 });
    });

    await check("the rest as goodwill: Ping carries all of it, and the clean then can't be refunded again", async () => {
      await page.reload();
      await page.getByText("£40.00 is left to refund.").waitFor();
      await page.getByRole("button", { name: "All of it: £40.00" }).click();
      await page.getByText("Goodwill").click();
      assert.equal(await page.locator('[data-part="cleaner"]').innerText(), "£0.00");
      assert.equal(await page.locator('[data-part="ping"]').innerText(), "£40.00");
      await page.getByRole("button", { name: "Refund £40.00" }).click();
      await page.getByText("This clean has been refunded in full.").waitFor();
      const second = [...stripe.state.refunds.values()][1];
      assert.deepEqual({ amount: second.amount, reverse: second.__reverse_transfer, fee: second.__refund_application_fee }, { amount: 4000, reverse: false, fee: false });
      assert.deepEqual((({ status, refunded_pence }) => ({ status, refunded_pence }))(await payment()), { status: "refunded", refunded_pence: 5000 });
      assert.equal(await page.getByRole("button", { name: /^Refund/ }).count(), 0);
      await page.getByText("Ping carried all of it.").waitFor();
      await shoot(page, "admin-payment-refunded-1440");
    });

    await check("on a phone the payment page holds up", async () => {
      const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-GB", timezoneId: "Europe/London", deviceScaleFactor: 2 });
      const p = await phone.newPage();
      await signIn(p, "admin");
      await p.waitForURL(`${BASE}/admin`);
      await p.goto(`${BASE}/admin/payments/${id}`);
      await p.getByRole("heading", { name: "Refunds on this clean." }).waitFor();
      await shoot(p, "admin-payment-refunded-390");
      await p.goto(`${BASE}/admin/payments`);
      await p.getByRole("heading", { name: "Every clean's money." }).waitFor();
      await shoot(p, "admin-payments-390");
      await phone.close();
    });

    await check("nobody but the Ping team reaches Payments", async () => {
      for (const who of ["tara.cleaner", "anna.customer"]) {
        const other = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-GB", timezoneId: "Europe/London" });
        const p = await other.newPage();
        await signIn(p, who);
        await p.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
        await p.goto(`${BASE}/admin/payments/${id}`);
        await p.waitForLoadState("networkidle");
        assert.equal(new URL(p.url()).pathname.startsWith("/admin"), false, `${who} is sent away`);
        assert.equal(await p.getByRole("heading", { name: "Refund this clean." }).count(), 0);
        await other.close();
      }
    });
  } finally {
    await ctx.close();
    await c.end();
  }
}
