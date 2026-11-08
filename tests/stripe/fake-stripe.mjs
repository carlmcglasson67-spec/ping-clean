// TEST-ONLY Stripe helpers. Ping's tests never talk to Stripe and never hold a real key.
//
// This PR (payments 3) needs only webhook events, signed exactly as Stripe signs them
// (https://docs.stripe.com/webhooks/signature: "t=<unix>,v1=<HMAC-SHA256(secret, `${t}.${body}`)>").
// The fake Stripe API server (customers, SetupIntents, PaymentIntents, Connect accounts,
// payouts, refunds) is added here PR by PR, as each one starts calling Stripe.
import { createHmac, randomBytes } from "node:crypto";

/** A test signing secret, shaped like Stripe's. */
export const TEST_WEBHOOK_SECRET = "whsec_" + "e2eTestSigningSecretNotReal000000";
export const TEST_CONNECT_WEBHOOK_SECRET = "whsec_" + "e2eTestConnectSecretNotReal00000";

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
