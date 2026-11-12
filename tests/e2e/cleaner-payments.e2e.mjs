// Payments PR 5: a cleaner sets up how they get paid, end to end through the real UI, the
// real database rules and a local stand-in for Stripe (never Stripe itself, never a real key).
// Runs before the other cleaner flows and leaves Alex ready to be paid, as the seed had him.
import assert from "node:assert/strict";
import pg from "pg";
import { stripeEvent, stripeSignature, TEST_CONNECT_WEBHOOK_SECRET } from "../stripe/fake-stripe.mjs";

const ALEX = "00000000-0000-4000-a000-000000000005";
const PHONE = { viewport: { width: 390, height: 844 }, locale: "en-GB", timezoneId: "Europe/London", deviceScaleFactor: 2 };

async function sql(text, params = []) {
  const db = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(text, params)).rows;
  } finally {
    await db.end();
  }
}
const alex = async () => (await sql(
  `select stripe_account_id as acct, stripe_charges_enabled as charges, stripe_payouts_enabled as payouts, stripe_details_submitted as details,
          private.cleaner_payable(id) as payable from public.cleaners where id = $1`, [ALEX]))[0];

export async function cleanerPaymentsFlows({ browser, BASE, check, signIn, SHOTS, stripe }) {
  console.log("e2e: cleaner payments set-up (payments 5)");
  // Alex hasn't started: no Stripe account yet.
  await sql(`update public.cleaners set stripe_account_id = null, stripe_charges_enabled = false, stripe_payouts_enabled = false,
               stripe_details_submitted = false, stripe_requirements_due = false, stripe_status_at = null where id = $1`, [ALEX]);
  const outcome = (o) => fetch(`${stripe.url}/__test/onboarding-outcome`, { method: "POST", body: JSON.stringify({ outcome: o }) });
  const shoot = async (page, name) => {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  };

  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  try {
    await signIn(page, "alex.cleaner");
    await page.waitForURL(`${BASE}/work`);

    await check("with no payments set-up the job board says why, and leads to it", async () => {
      await page.goto(`${BASE}/work/jobs`);
      await page.getByRole("heading", { name: "Set up how you get paid." }).waitFor();
      assert.equal(await page.locator("ol li").count(), 0, "no jobs listed");
      await shoot(page, "work-jobs-needs-payments-390");
      await page.getByRole("link", { name: "Set up payments" }).click();
      await page.waitForURL(`${BASE}/work/payments`);
    });

    await check("the payments screen says what's needed, and that ID and bank details go to Stripe, not Ping", async () => {
      await page.getByRole("heading", { name: "Set up how you get paid." }).waitFor();
      await page.getByText("Your ID and bank details go to Stripe, never to Ping.").waitFor();
      assert.equal(await page.locator("[data-payments-step]").getAttribute("data-payments-step"), "todo");
      const text = await page.locator("main").innerText();
      assert.doesNotMatch(text, /£|acct_/, "no prices and no Stripe ids on screen");
      await shoot(page, "work-payments-todo-390");
    });

    await check("leaving Stripe's form early keeps the account, isn't 'ready', and offers to carry on", async () => {
      await outcome("abandon");
      await page.getByRole("button", { name: "Set up payments" }).click();
      await page.waitForURL(`${BASE}/work/payments?back=1`);
      await page.getByRole("heading", { name: "Pick up where you left off." }).waitFor();
      await page.getByText("You left Stripe before the end. Nothing is lost.").waitFor();
      const a = await alex();
      assert.match(a.acct, /^acct_test/);
      assert.deepEqual({ details: a.details, payable: a.payable }, { details: false, payable: false });
      assert.equal(stripe.state.accounts.get(a.acct).settings.payouts.schedule.interval, "manual");
    });

    await check("form finished but Stripe still checking: told to wait, no button, still no jobs", async () => {
      await outcome("pending");
      const before = (await alex()).acct;
      await page.getByRole("button", { name: "Carry on with Stripe" }).click();
      await page.waitForURL(`${BASE}/work/payments?back=1`);
      await page.getByRole("heading", { name: "Stripe is checking your details." }).waitFor();
      assert.equal(await page.getByRole("button", { name: /Stripe|payments/ }).count(), 0);
      const a = await alex();
      assert.equal(a.acct, before, "the same Stripe account, not a second one");
      assert.deepEqual({ details: a.details, payable: a.payable }, { details: true, payable: false });
      await page.goto(`${BASE}/work/jobs`);
      await page.getByRole("heading", { name: "Stripe is checking your details." }).waitFor();
    });

    await check("Stripe's signed account.updated makes them ready; an unsigned or unknown one changes nothing", async () => {
      const { acct } = await alex();
      const post = async (ev, signature) => {
        const raw = JSON.stringify(ev);
        const res = await fetch(`${BASE}/api/stripe/connect-webhook`, {
          method: "POST", headers: { "content-type": "application/json", "stripe-signature": signature ?? stripeSignature(raw, TEST_CONNECT_WEBHOOK_SECRET) }, body: raw,
        });
        return res.status;
      };
      // A forged "you're enabled" with a bad signature: refused.
      assert.equal(await post(stripeEvent("account.updated", { id: acct, charges_enabled: true, payouts_enabled: true }, { account: acct }), "t=1,v1=00"), 400);
      // Properly signed, but Stripe itself still says "checking": the event's own claims are not believed.
      assert.equal(await post(stripeEvent("account.updated", { id: acct, charges_enabled: true, payouts_enabled: true }, { account: acct })), 200);
      assert.equal((await alex()).payable, false);
      // An account Ping never linked: acknowledged, nothing stored.
      await fetch(`${stripe.url}/__test/accounts/${acct}`, { method: "POST", body: JSON.stringify({ charges_enabled: true, payouts_enabled: true }) });
      assert.equal(await post(stripeEvent("account.updated", { id: acct }, { account: acct })), 200);
      assert.deepEqual(await alex(), { acct, charges: true, payouts: true, details: true, payable: true });
    });

    await check("ready: says so, explains how pay reaches their bank, and the job board opens", async () => {
      await page.goto(`${BASE}/work/payments`);
      await page.getByRole("heading", { name: "You're set up to be paid." }).waitFor();
      await page.getByRole("heading", { name: "How you get paid." }).waitFor();
      await shoot(page, "work-payments-ready-390");
      await page.getByRole("link", { name: "See new jobs" }).click();
      await page.waitForURL(`${BASE}/work/jobs`);
      await page.getByRole("heading", { name: "Cleans in your areas." }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "Set up how you get paid." }).count(), 0);
      await page.goto(`${BASE}/work/you`);
      await page.getByRole("link", { name: /Getting paid/ }).getByText("Ready").waitFor();
    });

    await check("an expired Stripe link makes a fresh one and carries straight on", async () => {
      await outcome("complete");
      const links = () => stripe.state.requests.filter((r) => r.path === "/v1/account_links").length;
      const before = links();
      await page.goto(`${BASE}/work/payments/continue`);
      await page.waitForURL(`${BASE}/work/payments?back=1`);
      assert.equal(links(), before + 1);
      assert.equal(stripe.state.accounts.size, 1, "still one Stripe account for Alex");
    });

    await check("on a desktop the screen holds up at 1440", async () => {
      const wide = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-GB", timezoneId: "Europe/London" });
      const p = await wide.newPage();
      await signIn(p, "alex.cleaner");
      await p.waitForURL(`${BASE}/work`);
      await p.goto(`${BASE}/work/payments`);
      await p.getByRole("heading", { name: "You're set up to be paid." }).waitFor();
      await shoot(p, "work-payments-ready-1440");
      await sql(`update public.cleaners set stripe_charges_enabled = false, stripe_payouts_enabled = false, stripe_details_submitted = false, stripe_status_at = null where id = $1`, [ALEX]);
      await p.reload();
      await p.getByRole("heading", { name: "Set up how you get paid." }).waitFor();
      await shoot(p, "work-payments-todo-1440");
      await sql(`update public.cleaners set stripe_charges_enabled = true, stripe_payouts_enabled = true, stripe_details_submitted = true, stripe_status_at = now() where id = $1`, [ALEX]);
      await wide.close();
    });
  } finally {
    await ctx.close();
  }

  await check("an applicant can't start set-up: a designed state, and the return routes do nothing for them", async () => {
    const c = await browser.newContext(PHONE);
    const p = await c.newPage();
    await signIn(p, "sam.applicant");
    await p.waitForURL(`${BASE}/work`);
    const accounts = stripe.state.accounts.size;
    await p.goto(`${BASE}/work/payments`);
    await p.getByRole("heading", { name: "Payments open once you're approved" }).waitFor();
    await p.goto(`${BASE}/work/payments/continue`);
    await p.waitForURL(`${BASE}/work/payments?retry=1`);
    assert.equal(stripe.state.accounts.size, accounts, "no Stripe account made for an applicant");
    await c.close();
  });
}
