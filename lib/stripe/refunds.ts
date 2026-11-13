import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/db/admin";
import { readStripeError } from "./charges";
import { getStripe } from "./server";

// Refunds and chargebacks (payments PR 10). Stripe TEST mode only.
//
// The database decides everything: whether a payment can be refunded, how much, and who
// carries it (public.admin_refund, admins only). This file sends what the database says to
// Stripe, once (key refund:<id>), and reports back what Stripe said.
//   * shared with the cleaner: reverse_transfer + refund_application_fee, so Stripe takes the
//     cleaner's part back from their balance and Ping's part from its fee, in proportion;
//   * carried by Ping alone: neither, so the cleaner's money is untouched (plan, appendix A).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUND_ID = /^re_[A-Za-z0-9_]{6,64}$/;
const INTENT_ID = /^pi_[A-Za-z0-9_]{6,64}$/;

type Db = ReturnType<typeof createAdminClient>;
type ToSend = { refund_id: string; payment_intent_id: string; amount_pence: number; shared: boolean; idempotency_key: string };
export type RefundOutcome = "succeeded" | "failed" | "pending";

export function readRefund(re: Stripe.Refund): { outcome: RefundOutcome; error: string | null } {
  if (re.status === "succeeded") return { outcome: "succeeded", error: null };
  if (re.status === "failed" || re.status === "canceled") {
    const reason = typeof re.failure_reason === "string" && /^[a-z0-9_]{1,80}$/.test(re.failure_reason) ? re.failure_reason : re.status === "canceled" ? "canceled" : "refund_failed";
    return { outcome: "failed", error: reason };
  }
  return { outcome: "pending", error: null }; // pending, requires_action
}

async function record(db: Db, refundId: string, re: Stripe.Refund): Promise<string> {
  const { outcome, error } = readRefund(re);
  const saved = await db.rpc("stripe_refund_result", {
    p_refund: refundId, p_stripe_refund: re.id, p_outcome: outcome, p_amount: re.amount, p_error: error,
  });
  if (saved.error || typeof saved.data !== "string") throw new Error("couldn't record the refund result");
  return saved.data;
}

/**
 * Sends one refund to Stripe and records the answer. A refusal (Stripe says it can't be
 * refunded) fails the refund and releases the cleaner's earnings. If Stripe can't be reached
 * the refund stays "on its way" and the hourly job sends it again with the same key.
 */
async function send(db: Db, r: ToSend): Promise<string> {
  let re: Stripe.Refund;
  try {
    re = await getStripe().refunds.create(
      {
        payment_intent: r.payment_intent_id,
        amount: r.amount_pence,
        reverse_transfer: r.shared,
        refund_application_fee: r.shared,
        metadata: { refund_id: r.refund_id },
      },
      { idempotencyKey: r.idempotency_key },
    );
  } catch (e) {
    const read = readStripeError(e);
    if (read.kind !== "refused") throw e;
    const saved = await db.rpc("stripe_refund_result", { p_refund: r.refund_id, p_stripe_refund: null, p_outcome: "failed", p_amount: r.amount_pence, p_error: read.error });
    if (saved.error) throw new Error("couldn't record the refused refund");
    return "failed";
  }
  return record(db, r.refund_id, re);
}

/** Right after the admin asks: 'succeeded' | 'pending' | 'failed' | 'unsent' (the job will send it). */
export async function sendRefund(refundId: string): Promise<"succeeded" | "pending" | "failed" | "unsent"> {
  if (!UUID.test(refundId)) return "unsent";
  const db = createAdminClient();
  try {
    const found = await db.rpc("refund_to_send", { p_refund: refundId });
    const r = found.data?.[0];
    if (found.error || !r || !INTENT_ID.test(r.payment_intent_id)) return "unsent";
    const outcome = await send(db, r);
    return outcome === "succeeded" || outcome === "already" ? "succeeded" : outcome === "failed" ? "failed" : outcome === "pending" ? "pending" : "unsent";
  } catch {
    console.error(`refunds: refund ${refundId} couldn't be sent; the job will send it`);
    return "unsent";
  }
}

/** The hourly job: refunds that never reached Stripe. One going wrong never stops the rest. */
export async function resendRefunds(): Promise<{ sent: number; errors: number }> {
  const db = createAdminClient();
  const run = { sent: 0, errors: 0 };
  const list = await db.rpc("refunds_unsent");
  if (list.error) throw new Error("couldn't read the unsent refunds");
  for (const r of list.data ?? []) {
    try {
      await send(db, r);
      run.sent++;
    } catch {
      run.errors++;
      console.error(`refunds: refund ${r.refund_id} couldn't be sent this run`);
    }
  }
  return run;
}

/**
 * refund.created / refund.updated / refund.failed (platform endpoint). The refund is named in
 * the metadata Ping set; the database checks the Stripe refund id and the amount against it.
 * Refunds made by hand in Stripe's dashboard carry no such name: acknowledged, ignored, and
 * logged so the team knows the app doesn't show them.
 */
export async function onRefundEvent(event: Stripe.Event): Promise<void> {
  const re = event.data.object as Stripe.Refund;
  const refundId = re?.metadata?.refund_id;
  if (!re || !REFUND_ID.test(String(re.id)) || !refundId || !UUID.test(refundId)) {
    console.warn(`stripe: ${event.type} ${event.id} isn't a refund Ping made; ignored`);
    return;
  }
  const snapshot = event.type === "refund.failed" ? ({ ...re, status: "failed" } as Stripe.Refund) : re;
  const outcome = await record(createAdminClient(), refundId, snapshot);
  if (outcome === "mismatch" || outcome === "unknown") console.warn(`stripe: ${event.type} ${event.id}: ${outcome}; nothing recorded`);
}

/**
 * charge.dispute.created / charge.dispute.closed (platform endpoint): a chargeback. Found by
 * the dispute's PaymentIntent. Closed as "won" only when Stripe says won; a warning that was
 * closed without money moving is treated as won too; everything else is lost.
 */
export async function onDisputeEvent(event: Stripe.Event): Promise<void> {
  const d = event.data.object as Stripe.Dispute;
  const pi = typeof d?.payment_intent === "string" ? d.payment_intent : d?.payment_intent?.id;
  if (!pi || !INTENT_ID.test(pi)) {
    console.warn(`stripe: ${event.type} ${event.id} names no payment; ignored`);
    return;
  }
  const outcome = event.type === "charge.dispute.created" ? "opened" : d.status === "won" || d.status === "warning_closed" ? "won" : "lost";
  const saved = await createAdminClient().rpc("stripe_dispute", { p_payment_intent: pi, p_outcome: outcome });
  if (saved.error) throw new Error("couldn't record the dispute"); // Stripe retries
  if (saved.data === "unknown") console.warn(`stripe: ${event.type} ${event.id}: not one of Ping's payments; nothing recorded`);
}
