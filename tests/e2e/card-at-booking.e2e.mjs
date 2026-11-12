// Saving a card at booking, end to end against the running app, the real test database and
// the fake Stripe. Stripe's own card fields can't load here (they come from Stripe's
// servers), so the card itself is "typed in" through the fake, and Stripe's webhook says so.
import assert from "node:assert/strict";
import pg from "pg";
import { stripeEvent, stripeSignature, TEST_WEBHOOK_SECRET } from "../stripe/fake-stripe.mjs";

const BEN = "00000000-0000-4000-a000-000000000003";
const ANNA_SERIES = "00000000-0000-4000-c000-000000000001";

export async function cardAtBookingFlows({ browser, BASE, check, signIn, SHOTS, stripe }) {
  console.log("e2e: saving a card at booking");
  const c = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await c.connect();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  try {
    const { rows: [{ id: series }] } = await c.query(`select id from public.series where customer_id = $1 and status <> 'ended' order by created_at limit 1`, [BEN]);

    await check("a customer with a block and no card is asked for one, on My cleans and on the booking", async () => {
      await signIn(page, "ben.customer");
      await page.waitForURL((u) => u.pathname === "/account");
      const banner = page.getByRole("region", { name: "Save your card" });
      await banner.waitFor();
      await banner.getByRole("link", { name: "Add your card" }).click();
      await page.waitForURL((u) => u.pathname === `/account/booking/${series}`);
      await page.getByRole("heading", { name: "Save your card to finish booking." }).waitFor();
      assert.match(await page.locator("main").innerText(), /Nothing is taken today\./);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${SHOTS}/account-booking-needs-card-1440.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${SHOTS}/account-booking-needs-card-390.png`, fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    await check("\"Add your card\" opens a Stripe card set-up for that block, taking no money", async () => {
      const before = stripe.state.setupIntents.size;
      await page.getByRole("button", { name: "Add your card" }).click();
      await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));
      for (let i = 0; i < 40 && stripe.state.setupIntents.size === before; i++) await page.waitForTimeout(100);
      const si = [...stripe.state.setupIntents.values()].at(-1);
      assert.equal(stripe.state.setupIntents.size, before + 1);
      assert.deepEqual({ usage: si.usage, series: si.metadata.series_id, profile: si.metadata.profile_id }, { usage: "off_session", series, profile: BEN });
      assert.equal(stripe.state.paymentIntents.size > 0 && [...stripe.state.paymentIntents.values()].some((p) => p.customer === si.customer), false, "no charge was made");
    });

    await check("once Stripe says the card is saved, the booking says so and the reminders go", async () => {
      const si = [...stripe.state.setupIntents.values()].at(-1);
      const card = await (await fetch(`${stripe.url}/__test/payment_methods`, { method: "POST",
        body: JSON.stringify({ customer: si.customer, brand: "visa", last4: "4242", exp_month: 4, exp_year: 2031 }) })).json();
      const raw = JSON.stringify(stripeEvent("setup_intent.succeeded", { ...si, status: "succeeded", payment_method: card.id }));
      const res = await fetch(`${BASE}/api/stripe/webhook`, { method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": stripeSignature(raw, TEST_WEBHOOK_SECRET) }, body: raw });
      assert.equal(res.status, 200);

      await page.goto(`${BASE}/account/booking/${series}`);
      await page.getByRole("heading", { name: "Card saved" }).waitFor();
      const text = await page.locator("main").innerText();
      assert.match(text, /Visa ending 4242\. Nothing is charged until a clean is finished\./);
      assert.doesNotMatch(text, /Save your card to finish booking/);
      await page.screenshot({ path: `${SHOTS}/account-booking-card-saved-1440.png`, fullPage: true });

      await page.goto(`${BASE}/account`);
      await page.locator("main h1").first().waitFor();
      assert.equal(await page.getByRole("region", { name: "Save your card" }).count(), 0);

      await page.goto(`${BASE}/account/book`);
      await page.getByText("We’ll use your Visa ending 4242.").waitFor();
    });

    await check("a customer who already has a card isn't asked again on another block", async () => {
      const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const p = await other.newPage();
      try {
        await signIn(p, "anna.customer");
        await p.waitForURL((u) => u.pathname === "/account");
        assert.equal(await p.getByRole("region", { name: "Save your card" }).count(), 0);
        await p.goto(`${BASE}/account/booking/${ANNA_SERIES}`);
        await p.getByRole("heading", { name: "Card saved" }).waitFor();
        assert.match(await p.locator("main").innerText(), /Mastercard ending 4444/);
      } finally { await other.close(); }
    });
  } finally {
    await ctx.close();
    await c.end();
  }
}
