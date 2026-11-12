// TEST-ONLY Stripe stand-in. Ping's tests never talk to Stripe and never hold a real key.
//
//  * Webhook events, signed exactly as Stripe signs them
//    (https://docs.stripe.com/webhooks/signature: "t=<unix>,v1=<HMAC-SHA256(secret, `${t}.${body}`)>").
//  * A small fake Stripe API for the calls Ping makes, grown PR by PR:
//      PR 4: POST /v1/customers, POST /v1/setup_intents, GET /v1/payment_methods/:id
//      PR 9: GET /v1/balance, POST /v1/payouts, GET /v1/payouts/:id on a connected account
//      PR 5: POST /v1/accounts, GET /v1/accounts/:id, POST /v1/account_links (Connect Express).
//            The link it returns is a page on the fake that "completes" Stripe's form.
//      PR 6: POST /v1/payment_intents (off-session destination charges), POST …/:id/confirm,
//            GET …/:id. What the card does is set per payment method with the test control
//            (behaviour: "ok" | "decline" | "auth"), like Stripe's test cards.
//    It needs a test-shaped key (Bearer sk_test_…) and honours Idempotency-Key like Stripe:
//    the same key returns the same response. Test controls under /__test/.
import { createHmac, randomBytes } from "node:crypto";
import http from "node:http";

/** Test signing secrets, shaped like Stripe's. */
export const TEST_WEBHOOK_SECRET = "whsec_" + "e2eTestSigningSecretNotReal000000";
export const TEST_CONNECT_WEBHOOK_SECRET = "whsec_" + "e2eTestConnectSecretNotReal00000";
/** A test-mode secret key for the fake (not a real Stripe key). */
export const TEST_SECRET_KEY = "sk_test_" + "fakeStripeForPingTestsOnly0000";
export const TEST_PUBLISHABLE_KEY = "pk_test_" + "fakeStripeForPingTestsOnly0000";

/** The Stripe-Signature header for a raw body. */
export function stripeSignature(body, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const v1 = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${v1}`;
}

/** A Stripe event object (test mode unless told otherwise). */
export function stripeEvent(type, object, { account, livemode = false, id } = {}) {
  return {
    id: id ?? `evt_test_${randomBytes(12).toString("hex")}`,
    object: "event",
    api_version: "2026-09-30.endive",
    created: Math.floor(Date.now() / 1000),
    type,
    livemode,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
    ...(account ? { account } : {}),
  };
}

const rid = (prefix) => `${prefix}_test${randomBytes(10).toString("hex")}`;

/** Stripe's form encoding (a[b]=1&c[0]=x) back into objects. */
function parseForm(raw) {
  const out = {};
  for (const [key, value] of new URLSearchParams(raw)) {
    const parts = key.replace(/\]/g, "").split("[");
    let at = out;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) at[p] = value;
      else at = at[p] ??= /^\d+$/.test(parts[i + 1]) ? [] : {};
    });
  }
  return out;
}

/** Starts the fake Stripe API. Returns { url, stop, state }. */
export function startFakeStripe(port = 12111) {
  const state = {
    customers: new Map(),
    setupIntents: new Map(),
    paymentMethods: new Map(),
    accounts: new Map(),
    paymentIntents: new Map(),
    payouts: new Map(),
    balances: new Map(),    // connected account id → available pence (GBP)
    idempotent: new Map(), // key → response body
    onboardingOutcome: "complete",
    requests: [],           // { method, path, idempotencyKey }
  };
  const send = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const error = (res, status, message, type = "invalid_request_error") => send(res, status, { error: { type, message } });

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const path = url.pathname;
      // ---------- test controls
      if (path === "/__test/payment_methods" && req.method === "POST") {
        const b = JSON.parse(raw || "{}");
        const pm = { id: b.id ?? rid("pm"), object: "payment_method", type: "card", customer: b.customer ?? null,
          card: { brand: b.brand ?? "visa", last4: b.last4 ?? "4242", exp_month: b.exp_month ?? 12, exp_year: b.exp_year ?? 2030 } };
        // What a charge on this card does: "ok", "decline" (no funds) or "auth" (the bank wants the customer).
        Object.defineProperty(pm, "__behaviour", { value: b.behaviour ?? state.paymentMethods.get(pm.id)?.__behaviour ?? "ok", enumerable: false, writable: true });
        state.paymentMethods.set(pm.id, pm);
        return send(res, 200, pm);
      }
      // Set what an account can do, as Stripe's checks would: { charges_enabled, payouts_enabled, … }.
      const setAcct = path.match(/^\/__test\/accounts\/(acct_[A-Za-z0-9]+)$/);
      if (setAcct && req.method === "POST") {
        const acct = state.accounts.get(setAcct[1]);
        if (!acct) return error(res, 404, "No such account");
        const b = JSON.parse(raw || "{}");
        const { currently_due, past_due, ...flags } = b;
        Object.assign(acct, flags);
        if (currently_due) acct.requirements.currently_due = currently_due;
        if (past_due) acct.requirements.past_due = past_due;
        return send(res, 200, acct);
      }
      // Stands in for Stripe's hosted form: opening the link "finishes" set-up (unless
      // ?outcome=pending or =abandon), then sends the cleaner back like Stripe does.
      const form = path.match(/^\/__test\/onboarding\/(acct_[A-Za-z0-9]+)$/);
      if (form && req.method === "GET") {
        const acct = state.accounts.get(form[1]);
        if (!acct) return error(res, 404, "No such account");
        const outcome = url.searchParams.get("outcome") ?? state.onboardingOutcome;
        if (outcome !== "abandon") {
          acct.details_submitted = true;
          acct.requirements.currently_due = [];
          if (outcome !== "pending") { acct.charges_enabled = true; acct.payouts_enabled = true; }
        }
        res.writeHead(302, { location: acct.__return_url });
        return res.end();
      }
      if (path === "/__test/onboarding-outcome" && req.method === "POST") {
        state.onboardingOutcome = JSON.parse(raw || "{}").outcome ?? "complete";
        return send(res, 200, {});
      }
      const bank = path.match(/^\/__test\/payment_intents\/(pi_[A-Za-z0-9_]+)\/bank$/);
      if (bank && req.method === "POST") {
        const pi = state.paymentIntents.get(bank[1]);
        if (!pi) return error(res, 404, "No such payment_intent");
        if (JSON.parse(raw || "{}").ok === false) Object.assign(pi, { status: "requires_payment_method", payment_method: null, next_action: null,
          last_payment_error: { type: "card_error", code: "payment_intent_authentication_failure", message: "Authentication failed." } });
        else Object.assign(pi, { status: "succeeded", amount_received: pi.amount, latest_charge: rid("ch"), next_action: null, last_payment_error: null });
        return send(res, 200, pi);
      }
      const setSeti = path.match(/^\/__test\/setup_intents\/(seti_[A-Za-z0-9_]+)$/);
      if (setSeti && req.method === "POST") {
        const si = state.setupIntents.get(setSeti[1]);
        if (!si) return error(res, 404, "No such setup_intent");
        Object.assign(si, JSON.parse(raw || "{}"));
        return send(res, 200, si);
      }
      // What has cleared in a connected account: { available: pence }.
      const bal = path.match(/^\/__test\/balance\/(acct_[A-Za-z0-9]+)$/);
      if (bal && req.method === "POST") {
        state.balances.set(bal[1], Number(JSON.parse(raw || "{}").available ?? 0));
        return send(res, 200, {});
      }
      // The bank's answer on a payout: { status: "paid" | "failed", failure_code }.
      const setPo = path.match(/^\/__test\/payouts\/(po_[A-Za-z0-9_]+)$/);
      if (setPo && req.method === "POST") {
        const po = state.payouts.get(setPo[1]);
        if (!po) return error(res, 404, "No such payout");
        Object.assign(po, JSON.parse(raw || "{}"));
        return send(res, 200, po);
      }
      if (path === "/__test/requests") return send(res, 200, state.requests);
      if (path === "/__test/reset" && req.method === "POST") {
        for (const m of [state.customers, state.setupIntents, state.paymentMethods, state.accounts, state.paymentIntents, state.payouts, state.balances, state.idempotent]) m.clear();
        state.requests.length = 0;
        return send(res, 200, {});
      }

      // ---------- the API
      const auth = String(req.headers.authorization ?? "");
      if (!/^Bearer (sk|rk)_test_/.test(auth)) return error(res, 401, "Invalid API Key provided", "authentication_error");
      const idem = req.headers["idempotency-key"] ? String(req.headers["idempotency-key"]) : null;
      const onAccount = req.headers["stripe-account"] ? String(req.headers["stripe-account"]) : null;
      state.requests.push({ method: req.method, path, idempotencyKey: idem, ...(onAccount ? { account: onAccount } : {}) });
      // Like Stripe: the same key gets the same answer back, an error included.
      if (req.method === "POST" && idem && state.idempotent.has(idem)) { const was = state.idempotent.get(idem); return send(res, was.status, was.body); }
      const remember = (body, status = 200) => { if (req.method === "POST" && idem) state.idempotent.set(idem, { status, body }); return send(res, status, body); };
      const b = req.method === "POST" ? parseForm(raw) : {};

      // ---------- PR 9: a connected account's balance and bank payouts (Stripe-Account header)
      if (path === "/v1/balance" && req.method === "GET") {
        if (!onAccount) return error(res, 400, "The fake only reads a connected account's balance");
        return send(res, 200, { object: "balance", livemode: false, available: [{ amount: state.balances.get(onAccount) ?? 0, currency: "gbp" }], pending: [{ amount: 0, currency: "gbp" }] });
      }
      if (path === "/v1/payouts" && req.method === "POST") {
        if (!onAccount || !/^acct_/.test(onAccount)) return remember({ error: { type: "invalid_request_error", code: "account_invalid", message: "No such connected account" } }, 400);
        const amount = Number(b.amount);
        if (b.currency !== "gbp" || !Number.isInteger(amount) || amount <= 0) return error(res, 400, "Invalid payout");
        const have = state.balances.get(onAccount) ?? 0;
        if (amount > have) return remember({ error: { type: "invalid_request_error", code: "balance_insufficient", message: "You have insufficient funds in your Stripe account for this transfer." } }, 400);
        state.balances.set(onAccount, have - amount);
        const po = { id: rid("po"), object: "payout", amount, currency: "gbp", status: "in_transit", method: "standard", livemode: false,
          arrival_date: Math.floor(Date.now() / 1000) + 2 * 86400, failure_code: null, metadata: b.metadata ?? {}, __account: onAccount };
        state.payouts.set(po.id, po);
        return remember(po);
      }
      const payout = path.match(/^\/v1\/payouts\/(po_[A-Za-z0-9_]+)$/);
      if (payout && req.method === "GET") {
        const found = state.payouts.get(payout[1]);
        return found && found.__account === onAccount ? send(res, 200, found) : error(res, 404, `No such payout: '${payout[1]}'`);
      }

      if (path === "/v1/customers" && req.method === "POST") {
        const c = { id: rid("cus"), object: "customer", email: b.email ?? null, name: b.name ?? null, metadata: b.metadata ?? {}, livemode: false };
        state.customers.set(c.id, c);
        return remember(c);
      }
      if (path === "/v1/setup_intents" && req.method === "POST") {
        if (!b.customer || !state.customers.has(b.customer)) return error(res, 400, "No such customer");
        const id = rid("seti");
        const si = { id, object: "setup_intent", client_secret: `${id}_secret_${randomBytes(8).toString("hex")}`, customer: b.customer,
          usage: b.usage ?? "off_session", allowed_payment_method_types: b.allowed_payment_method_types ?? null, payment_method_types: b.allowed_payment_method_types ?? ["card"], status: "requires_payment_method",
          payment_method: null, metadata: b.metadata ?? {}, livemode: false };
        state.setupIntents.set(id, si);
        return remember(si);
      }
      const seti = path.match(/^\/v1\/setup_intents\/(seti_[A-Za-z0-9_]+)$/);
      if (seti && req.method === "GET") {
        const found = state.setupIntents.get(seti[1]);
        return found ? send(res, 200, found) : error(res, 404, `No such setup_intent: '${seti[1]}'`);
      }
      if (path === "/v1/accounts" && req.method === "POST") {
        if (b.type !== "express" || b.country !== "GB") return error(res, 400, "The fake only makes GB Express accounts");
        const a = { id: `acct_test${randomBytes(8).toString("hex")}`, object: "account", type: "express", country: "GB", email: b.email ?? null,
          default_currency: b.default_currency ?? "gbp", business_type: b.business_type ?? null, business_profile: b.business_profile ?? {},
          capabilities: Object.fromEntries(Object.keys(b.capabilities ?? {}).map((k) => [k, "inactive"])),
          charges_enabled: false, payouts_enabled: false, details_submitted: false,
          requirements: { currently_due: ["individual.first_name", "external_account"], past_due: [], disabled_reason: "requirements.past_due" },
          settings: b.settings ?? {}, metadata: b.metadata ?? {} };
        state.accounts.set(a.id, a);
        return remember(a);
      }
      const acct = path.match(/^\/v1\/accounts\/(acct_[A-Za-z0-9]+)$/);
      if (acct && req.method === "GET") {
        const found = state.accounts.get(acct[1]);
        return found ? send(res, 200, found) : error(res, 404, `No such account: '${acct[1]}'`);
      }
      if (path === "/v1/account_links" && req.method === "POST") {
        const found = state.accounts.get(b.account);
        if (!found) return error(res, 400, "No such account");
        if (b.type !== "account_onboarding" || !b.return_url || !b.refresh_url) return error(res, 400, "account_onboarding needs return_url and refresh_url");
        found.__return_url = b.return_url;
        found.__refresh_url = b.refresh_url;
        return send(res, 200, { object: "account_link", created: Math.floor(Date.now() / 1000), expires_at: Math.floor(Date.now() / 1000) + 300,
          url: `http://127.0.0.1:${port}/__test/onboarding/${found.id}` });
      }
      // ---------- PaymentIntents: off-session destination charges, as Ping makes them
      const attempt = (pi, pmId) => {
        const card = state.paymentMethods.get(pmId);
        if (!card) return remember({ error: { type: "invalid_request_error", code: "resource_missing", message: `No such PaymentMethod: '${pmId}'` } }, 400);
        pi.payment_method = pmId;
        const behaviour = card.__behaviour ?? "ok";
        if (behaviour === "ok") {
          Object.assign(pi, { status: "succeeded", amount_received: pi.amount, latest_charge: rid("ch"), last_payment_error: null });
          return remember({ ...pi });
        }
        if (behaviour === "auth" && pi.__present) {
          Object.assign(pi, { status: "requires_action", last_payment_error: null, next_action: { type: "use_stripe_sdk" } });
          return remember({ ...pi });
        }
        const code = behaviour === "auth" ? "authentication_required" : "card_declined";
        const decline_code = behaviour === "auth" ? "authentication_required" : "insufficient_funds";
        Object.assign(pi, { status: "requires_payment_method", payment_method: null, latest_charge: rid("ch"),
          last_payment_error: { type: "card_error", code, decline_code, message: "Your card was declined." } });
        return remember({ error: { type: "card_error", code, decline_code, message: "Your card was declined.", payment_intent: { ...pi } } }, 402);
      };
      if (path === "/v1/payment_intents" && req.method === "POST") {
        const amount = Number(b.amount), fee = Number(b.application_fee_amount);
        const dest = b.transfer_data?.destination;
        if (!Number.isInteger(amount) || amount <= 0 || b.currency !== "gbp") return error(res, 400, "Invalid amount or currency");
        if (b.confirm !== "true" || !b.customer || !b.payment_method) return error(res, 400, "The fake only takes confirmed charges on a saved card");
        // Off-session (the job) or with the customer present (use_stripe_sdk: "Pay now"), never neither.
        if ((b.off_session === "true") === (b.use_stripe_sdk === "true")) return error(res, 400, "Say whether the customer is present: off_session or use_stripe_sdk");
        if (!/^acct_[A-Za-z0-9]{6,64}$/.test(dest ?? "") || b.on_behalf_of !== dest) return error(res, 400, "The fake only takes destination charges made on the destination's behalf");
        if (!Number.isInteger(fee) || fee < 0 || fee > amount) return error(res, 400, "Invalid application_fee_amount");
        const id = rid("pi");
        const pi = { id, object: "payment_intent", __present: b.use_stripe_sdk === "true", amount, amount_received: 0, currency: "gbp", customer: b.customer, payment_method: null,
          application_fee_amount: fee, on_behalf_of: dest, transfer_data: { destination: dest }, latest_charge: null,
          last_payment_error: null, status: "requires_confirmation", client_secret: `${id}_secret_${randomBytes(8).toString("hex")}`,
          metadata: b.metadata ?? {}, created: Math.floor(Date.now() / 1000), livemode: false };
        state.paymentIntents.set(id, pi);
        return attempt(pi, b.payment_method);
      }
      const confirm = path.match(/^\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)\/confirm$/);
      if (confirm && req.method === "POST") {
        const pi = state.paymentIntents.get(confirm[1]);
        if (!pi) return error(res, 404, `No such payment_intent: '${confirm[1]}'`);
        if (pi.status === "succeeded") return error(res, 400, "This PaymentIntent has already succeeded");
        if ((b.off_session === "true") === (b.use_stripe_sdk === "true")) return error(res, 400, "Say whether the customer is present: off_session or use_stripe_sdk");
        pi.__present = b.use_stripe_sdk === "true";
        return attempt(pi, b.payment_method ?? pi.payment_method);
      }
      const intent = path.match(/^\/v1\/payment_intents\/(pi_[A-Za-z0-9_]+)$/);
      if (intent && req.method === "GET") {
        const found = state.paymentIntents.get(intent[1]);
        return found ? send(res, 200, found) : error(res, 404, `No such payment_intent: '${intent[1]}'`);
      }
      const pm = path.match(/^\/v1\/payment_methods\/([A-Za-z0-9_]+)$/);
      if (pm && req.method === "GET") {
        const found = state.paymentMethods.get(pm[1]);
        return found ? send(res, 200, found) : error(res, 404, `No such PaymentMethod: '${pm[1]}'`);
      }
      return error(res, 404, `Unrecognized request URL (${req.method}: ${path})`);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () =>
    resolve({ url: `http://127.0.0.1:${port}`, state, stop: () => new Promise((r) => server.close(() => r())) })));
}
