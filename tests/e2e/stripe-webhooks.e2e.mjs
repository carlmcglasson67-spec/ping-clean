// Payments PR 3: Stripe webhooks, end to end against the running app (built for production)
// and the real test database. Events are signed exactly as Stripe signs them, with TEST secrets.
import assert from "node:assert/strict";
import pg from "pg";
import { stripeEvent, stripeSignature, TEST_CONNECT_WEBHOOK_SECRET, TEST_WEBHOOK_SECRET } from "../stripe/fake-stripe.mjs";

const db = () => new pg.Client({ connectionString: process.env.PING_TEST_DATABASE_URL });
async function eventRow(id) {
  const c = db(); await c.connect();
  try {
    const { rows } = await c.query(`select type, account, processed_at is not null as handled from private.stripe_events where event_id = $1`, [id]);
    return rows[0] ?? null;
  } finally { await c.end(); }
}

export async function stripeWebhookFlows({ BASE, check }) {
  console.log("e2e: Stripe webhooks");
  const post = async (path, ev, { secret = TEST_WEBHOOK_SECRET, signature, body } = {}) => {
    const raw = body ?? JSON.stringify(ev);
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signature ?? stripeSignature(raw, secret) },
      body: raw,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  await check("a signed test-mode event is checked, recorded once, and a replay does nothing", async () => {
    const ev = stripeEvent("customer.created", { id: "cus_testE2E0001", object: "customer" });
    const first = await post("/api/stripe/webhook", ev);
    assert.deepEqual(first, { status: 200, json: { received: true, handled: false } });
    assert.deepEqual(await eventRow(ev.id), { type: "customer.created", account: null, handled: true });
    const again = await post("/api/stripe/webhook", ev);
    assert.deepEqual(again, { status: 200, json: { received: true, duplicate: true } });
  });

  await check("bad, stale, live-mode and wrong-endpoint events are refused and never recorded", async () => {
    const cases = [
      ["wrong secret", "/api/stripe/webhook", stripeEvent("customer.created", {}), { secret: TEST_CONNECT_WEBHOOK_SECRET }],
      ["no signature", "/api/stripe/webhook", stripeEvent("customer.created", {}), { signature: "" }],
      ["a 10-minute-old signature", "/api/stripe/webhook", stripeEvent("customer.created", {}), { timestamp: Math.floor(Date.now() / 1000) - 600 }],
      ["live mode", "/api/stripe/webhook", stripeEvent("customer.created", {}, { livemode: true }), {}],
      ["a Connect event on the platform endpoint", "/api/stripe/webhook", stripeEvent("account.updated", {}, { account: "acct_testE2E00001" }), {}],
      ["a platform event on the Connect endpoint", "/api/stripe/connect-webhook", stripeEvent("customer.created", {}), { secret: TEST_CONNECT_WEBHOOK_SECRET }],
    ];
    for (const [why, path, ev, opts] of cases) {
      const raw = JSON.stringify(ev);
      const signature = opts.signature ?? (opts.timestamp ? stripeSignature(raw, TEST_WEBHOOK_SECRET, opts.timestamp) : undefined);
      const r = await post(path, ev, { ...opts, signature, body: raw });
      assert.equal(r.status, 400, `${why}: expected 400, got ${r.status}`);
      assert.equal(await eventRow(ev.id), null, `${why}: must not be recorded`);
    }
  });

  await check("a cleaner's Connect event is checked with the Connect secret and recorded with its account", async () => {
    const ev = stripeEvent("account.updated", { id: "acct_testE2E00001", object: "account" }, { account: "acct_testE2E00001" });
    const r = await post("/api/stripe/connect-webhook", ev, { secret: TEST_CONNECT_WEBHOOK_SECRET });
    assert.equal(r.status, 200);
    assert.deepEqual(await eventRow(ev.id), { type: "account.updated", account: "acct_testE2E00001", handled: true });
  });

  await check("the webhook routes answer POST only", async () => {
    const res = await fetch(`${BASE}/api/stripe/webhook`);
    assert.equal(res.status, 405);
  });
}
