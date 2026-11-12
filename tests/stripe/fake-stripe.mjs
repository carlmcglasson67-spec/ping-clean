// TEST-ONLY Stripe stand-in. Ping's tests never talk to Stripe and never hold a real key.
//
//  * Webhook events, signed exactly as Stripe signs them
//    (https://docs.stripe.com/webhooks/signature: "t=<unix>,v1=<HMAC-SHA256(secret, `${t}.${body}`)>").
//  * A small fake Stripe API for the calls Ping makes, grown PR by PR:
//      PR 4: POST /v1/customers, POST /v1/setup_intents, GET /v1/payment_methods/:id
//      PR 5: POST /v1/accounts, GET /v1/accounts/:id, POST /v1/account_links (Connect Express).
//            The link it returns is a page on the fake that "completes" Stripe's form.
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
      if (path === "/__test/requests") return send(res, 200, state.requests);
      if (path === "/__test/reset" && req.method === "POST") {
        for (const m of [state.customers, state.setupIntents, state.paymentMethods, state.accounts, state.idempotent]) m.clear();
        state.requests.length = 0;
        return send(res, 200, {});
      }

      // ---------- the API
      const auth = String(req.headers.authorization ?? "");
      if (!/^Bearer (sk|rk)_test_/.test(auth)) return error(res, 401, "Invalid API Key provided", "authentication_error");
      const idem = req.headers["idempotency-key"] ? String(req.headers["idempotency-key"]) : null;
      state.requests.push({ method: req.method, path, idempotencyKey: idem });
      if (req.method === "POST" && idem && state.idempotent.has(idem)) return send(res, 200, state.idempotent.get(idem));
      const remember = (body) => { if (req.method === "POST" && idem) state.idempotent.set(idem, body); return send(res, 200, body); };
      const b = req.method === "POST" ? parseForm(raw) : {};

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
