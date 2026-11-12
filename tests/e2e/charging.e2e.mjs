// Payments PR 6: charging a completed clean, end to end against the running app (built for
// production), the real test database and the fake Stripe. Runs after the cleaner flows, in
// which Tara completed Anna's clean today with one "couldn't do" item.
import assert from "node:assert/strict";
import pg from "pg";
import { stripeEvent, stripeSignature, TEST_WEBHOOK_SECRET } from "../stripe/fake-stripe.mjs";

export const TEST_JOB_SECRET = "e2e-job-secret-not-a-real-one-000000000000";

const ADMIN = "00000000-0000-4000-a000-000000000001";
const ANNA_SERIES = "00000000-0000-4000-c000-000000000001";
const ANNA_TODAY = "00000000-0000-4000-e000-000000000002";

export async function chargingFlows({ BASE, check, stripe }) {
  console.log("e2e: charging a completed clean");
  const c = new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
  await c.connect();
  const sql = async (text, params) => (await c.query(text, params)).rows;
  const payment = async () => (await sql(
    `select id, status::text, attempts::int, amount_pence, application_fee_pence, cleaner_amount_pence, stripe_payment_intent_id as intent, last_error_code as error
     from public.payments where visit_id = $1 and kind = 'visit'`, [ANNA_TODAY]))[0];
  const alerts = async () => (await sql(`select kind, resolved_at is null as open from public.engine_alerts
     where visit_id = $1 and kind in ('charge_held', 'charge_blocked', 'payment_needs_customer', 'payment_failed') order by kind`, [ANNA_TODAY]));
  const runJob = async (secret = TEST_JOB_SECRET) => {
    const res = await fetch(`${BASE}/api/stripe/charge-due`, { method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {} });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const setCard = async (behaviour) => {
    const [{ pm }] = await sql(`select stripe_payment_method_id as pm from public.series_billing where series_id = $1`, [ANNA_SERIES]);
    await fetch(`${stripe.url}/__test/payment_methods`, { method: "POST", body: JSON.stringify({ id: pm, customer: "cus_testE2EAnna01", behaviour }) });
    return pm;
  };
  const intents = () => [...stripe.state.paymentIntents.values()];

  try {
    await check("the job's address lets nobody in without the secret, and takes POST only", async () => {
      assert.equal((await runJob("")).status, 401);
      assert.equal((await runJob("e2e-job-secret-not-a-real-one-00000000000X")).status, 401);
      assert.equal((await fetch(`${BASE}/api/stripe/charge-due`)).status, 405);
      assert.equal(intents().length, 0, "nothing was charged");
    });

    await check("a clean with a \"couldn't do\" item is held for the Ping team, not charged", async () => {
      assert.equal(await payment(), undefined);
      assert.deepEqual(await alerts(), [{ kind: "charge_held", open: true }]);
      assert.deepEqual((await runJob()).json, { claimed: 0, succeeded: 0, failed: 0, needsCustomer: 0, waiting: 0, errors: 0 });
    });

    await check("the admin charges it; a declined card is a failed try, due again in a day, and no money moved", async () => {
      await c.query("begin");
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN, role: "authenticated" })]);
      await c.query(`set local role authenticated`);
      await c.query(`select public.admin_charge_visit($1)`, [ANNA_TODAY]);
      await c.query("commit");
      await setCard("decline");

      const run = await runJob();
      assert.deepEqual(run, { status: 200, json: { claimed: 1, succeeded: 0, failed: 1, needsCustomer: 0, waiting: 0, errors: 0 } });
      const p = await payment();
      assert.deepEqual({ status: p.status, attempts: p.attempts, error: p.error }, { status: "failed", attempts: 1, error: "insufficient_funds" });
      assert.equal(intents().length, 1);
      assert.equal(intents()[0].id, p.intent);
      assert.equal(intents()[0].status, "requires_payment_method");
      const [{ hours }] = await sql(`select round(extract(epoch from next_retry_at - created_at) / 3600)::int as hours from public.payments where id = $1`, [p.id]);
      assert.equal(hours, 24);
      assert.deepEqual((await runJob()).json.claimed, 0, "not retried before it's due");
    });

    await check("the retry confirms the same PaymentIntent: the cleaner's account as destination, Ping's fee split off, the three amounts adding up", async () => {
      await setCard("ok"); // the customer sorted their card
      await sql(`update public.payments set next_retry_at = now() - interval '1 minute' where visit_id = $1`, [ANNA_TODAY]);
      const run = await runJob();
      assert.deepEqual(run.json, { claimed: 1, succeeded: 1, failed: 0, needsCustomer: 0, waiting: 0, errors: 0 });

      const p = await payment();
      const [v] = await sql(`select price_pence, cleaner_earnings_pence, ping_fee_pence, cleaner_id from public.visits where id = $1`, [ANNA_TODAY]);
      const [{ acct }] = await sql(`select stripe_account_id as acct from public.cleaners where id = $1`, [v.cleaner_id]);
      assert.deepEqual({ status: p.status, attempts: p.attempts, error: p.error }, { status: "succeeded", attempts: 2, error: null });
      assert.equal(intents().length, 1, "one PaymentIntent for the payment, ever");
      const pi = intents()[0];
      assert.deepEqual(
        { amount: pi.amount, fee: pi.application_fee_amount, destination: pi.transfer_data.destination, seller: pi.on_behalf_of, status: pi.status, payment: pi.metadata.payment_id },
        { amount: v.price_pence, fee: v.ping_fee_pence, destination: acct, seller: acct, status: "succeeded", payment: p.id });
      assert.equal(p.amount_pence, p.cleaner_amount_pence + p.application_fee_pence);
      assert.deepEqual([p.amount_pence, p.cleaner_amount_pence, p.application_fee_pence], [v.price_pence, v.cleaner_earnings_pence, v.ping_fee_pence]);
      console.log(`      charged: price ${p.amount_pence}p = cleaner ${p.cleaner_amount_pence}p + Ping fee ${p.application_fee_pence}p`);
      assert.deepEqual(await alerts(), [{ kind: "charge_held", open: false }]);
    });

    await check("Stripe's webhook confirms it; a replay, a late failure and a forged amount change nothing", async () => {
      const post = async (ev) => {
        const raw = JSON.stringify(ev);
        const res = await fetch(`${BASE}/api/stripe/webhook`, { method: "POST",
          headers: { "content-type": "application/json", "stripe-signature": stripeSignature(raw, TEST_WEBHOOK_SECRET) }, body: raw });
        return { status: res.status, json: await res.json().catch(() => null) };
      };
      const pi = intents()[0];
      const ok = stripeEvent("payment_intent.succeeded", pi);
      assert.deepEqual(await post(ok), { status: 200, json: { received: true, handled: true } });
      assert.deepEqual(await post(ok), { status: 200, json: { received: true, duplicate: true } });
      assert.equal((await post(stripeEvent("payment_intent.payment_failed", { ...pi, status: "requires_payment_method", last_payment_error: { code: "card_declined" } }))).status, 200);
      assert.equal((await post(stripeEvent("payment_intent.succeeded", { ...pi, amount: 1 }))).status, 200);
      assert.equal((await payment()).status, "succeeded");
      assert.deepEqual((await alerts()).filter((a) => a.open), [{ kind: "charge_blocked", open: true }], "the forged amount was flagged for the team");
      await sql(`update public.engine_alerts set resolved_at = now() where visit_id = $1 and kind = 'charge_blocked'`, [ANNA_TODAY]);
    });
  } finally {
    await c.end();
  }
}
