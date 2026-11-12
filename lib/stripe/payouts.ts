import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/db/admin";
import { readStripeError } from "./charges";
import { getStripe } from "./server";

// Paying cleaners after the check period (payments PR 9). Stripe TEST mode only.
//
// The database decides who is due and is the only place a payout's state changes. This file
// only talks to Stripe and reports what it said:
//   * a bank payout leaves the CLEANER's own Stripe account (the Stripe-Account header): the
//     money was theirs from the moment the customer paid (ping-money-rules 5);
//   * never more than Stripe says has cleared in that account, so nothing fails for being early;
//   * one Stripe payout per batch, ever (idempotency key payout-batch:<id>);
//   * the Connect webhook is the source of truth (ping-money-rules 7).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYOUT_ID = /^po_[A-Za-z0-9_]{6,64}$/;
const ACCOUNT_ID = /^acct_[A-Za-z0-9]{6,64}$/;

type Db = ReturnType<typeof createAdminClient>;
export type PayoutOutcome = "paid" | "failed" | "in_transit";

/** Stripe's arrival_date is a Unix day; the database keeps a calendar date. */
const arrival = (po: Stripe.Payout): string | null =>
  typeof po.arrival_date === "number" ? new Date(po.arrival_date * 1000).toISOString().slice(0, 10) : null;

export function readPayout(po: Stripe.Payout): { outcome: PayoutOutcome; error: string | null } {
  if (po.status === "paid") return { outcome: "paid", error: null };
  if (po.status === "failed" || po.status === "canceled") {
    const code = po.failure_code && /^[a-z0-9_]{1,80}$/.test(po.failure_code) ? po.failure_code : po.status === "canceled" ? "canceled" : "payout_failed";
    return { outcome: "failed", error: code };
  }
  return { outcome: "in_transit", error: null }; // pending, in_transit, or anything Stripe adds later
}

async function record(db: Db, batchId: string, account: string, po: Stripe.Payout): Promise<string> {
  const { outcome, error } = readPayout(po);
  const saved = await db.rpc("stripe_payout_result", {
    p_batch: batchId, p_stripe_payout: po.id, p_account: account, p_outcome: outcome,
    p_amount: po.amount, p_arrival: arrival(po), p_error: error,
  });
  if (saved.error || typeof saved.data !== "string") throw new Error("couldn't record the payout result");
  return saved.data;
}

/** What has cleared in the cleaner's Stripe account and can go to their bank now, in pence. */
async function clearedPence(account: string): Promise<number> {
  const balance = await getStripe().balance.retrieve({}, { stripeAccount: account });
  return (balance.available ?? []).filter((b) => b.currency === "gbp").reduce((sum, b) => sum + b.amount, 0);
}

type Batch = { batch_id: string; cleaner_account_id: string; amount_pence: number; idempotency_key: string };

/** Sends one batch to Stripe and records that it was taken (or that Stripe said no). */
async function send(db: Db, b: Batch): Promise<"sent" | "returned"> {
  try {
    const po = await getStripe().payouts.create(
      { amount: b.amount_pence, currency: "gbp", metadata: { batch_id: b.batch_id } },
      { stripeAccount: b.cleaner_account_id, idempotencyKey: b.idempotency_key },
    );
    const saved = await db.rpc("payout_batch_sent", { p_batch: b.batch_id, p_stripe_payout: po.id, p_arrival: arrival(po) });
    if (saved.error || saved.data === "mismatch" || saved.data === "unknown") throw new Error("couldn't record the sent payout");
    return "sent";
  } catch (e) {
    const read = readStripeError(e);
    if (read.kind !== "refused") throw e; // not known whether Stripe has it: sent again later, same key
    const noted = await db.rpc("payout_batch_not_sent", { p_batch: b.batch_id, p_error: read.error });
    if (noted.error) throw new Error("couldn't record the refused payout");
    return "returned";
  }
}

export type PayoutRun = { cleaners: number; sent: number; waiting: number; paid: number; failed: number; errors: number };

/**
 * One run of the payout job. First it chases bank payouts with no final answer; then, for
 * each cleaner with earnings past their check period, it sends what has cleared at Stripe.
 * One cleaner going wrong never stops the others. Logs carry ids and outcomes only.
 */
export async function runPayoutJob(): Promise<PayoutRun> {
  const db = createAdminClient();
  const run: PayoutRun = { cleaners: 0, sent: 0, waiting: 0, paid: 0, failed: 0, errors: 0 };

  const open = await db.rpc("payout_batches_open");
  if (open.error) throw new Error("couldn't read the open bank payouts");
  for (const b of open.data ?? []) {
    try {
      if (b.mode === "send") {
        if ((await send(db, b)) === "sent") run.sent++;
        else run.waiting++;
      } else if (b.stripe_payout_id) {
        const po = await getStripe().payouts.retrieve(b.stripe_payout_id, {}, { stripeAccount: b.cleaner_account_id });
        const outcome = await record(db, b.batch_id, b.cleaner_account_id, po);
        if (outcome === "paid") run.paid++;
        else if (outcome === "failed") run.failed++;
        else if (outcome === "mismatch" || outcome === "unknown") run.errors++;
      }
    } catch {
      run.errors++;
      console.error(`payout job: bank payout ${b.batch_id} (${b.mode}) couldn't be sent or checked`);
    }
  }

  const due = await db.rpc("payout_due_cleaners");
  if (due.error) throw new Error("couldn't read who is due a payout");
  run.cleaners = (due.data ?? []).length;
  for (const c of due.data ?? []) {
    try {
      const cleared = await clearedPence(c.cleaner_account_id);
      const opened = cleared > 0 ? await db.rpc("payout_batch_open", { p_cleaner: c.cleaner_id, p_available_pence: cleared }) : { data: [], error: null };
      if (opened.error) throw new Error("couldn't open the bank payout");
      const batch = opened.data?.[0];
      if (!batch) {
        run.waiting++; // the card money hasn't cleared at Stripe yet: tomorrow
        continue;
      }
      if ((await send(db, batch)) === "sent") run.sent++;
      else run.waiting++;
    } catch {
      // A batch that was opened stays "created": payout_batches_open picks it up within the hour.
      run.errors++;
      console.error(`payout job: cleaner ${c.cleaner_id} couldn't be paid this run`);
    }
  }
  return run;
}

/**
 * payout.paid / payout.failed / payout.canceled (Connect endpoint). The batch is named in
 * the payout's metadata, which Ping set; the database still checks the payout id, the
 * account and the amount against that batch. Payouts that aren't Ping's are acknowledged
 * and ignored. A database failure throws, so Stripe retries.
 */
export async function onPayoutEvent(event: Stripe.Event): Promise<void> {
  const account = (event as { account?: string }).account;
  const po = event.data.object as Stripe.Payout;
  const batchId = po?.metadata?.batch_id;
  if (!account || !ACCOUNT_ID.test(account) || !po || !PAYOUT_ID.test(String(po.id)) || !batchId || !UUID.test(batchId)) {
    console.warn(`stripe: ${event.type} ${event.id} isn't one of Ping's bank payouts; ignored`);
    return;
  }
  // The event's own type wins over the status in its snapshot.
  const snapshot = { ...po, status: event.type === "payout.paid" ? "paid" : event.type === "payout.canceled" ? "canceled" : "failed" } as Stripe.Payout;
  const outcome = await record(createAdminClient(), batchId, account, snapshot);
  if (outcome === "mismatch" || outcome === "unknown") console.warn(`stripe: ${event.type} ${event.id}: ${outcome}; nothing recorded`);
}
