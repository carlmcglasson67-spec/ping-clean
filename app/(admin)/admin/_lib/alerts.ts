// The engine's alerts in the Ping team's words: what happened and what to do about it.
// Kinds come from the engine_alerts check constraint (supabase/migrations/…_blocks.sql).

export type AlertKind =
  | "visit_needs_cover"
  | "visit_no_show"
  | "visit_unfinished"
  | "block_stalled"
  | "block_overlap"
  | "block_closed"
  | "release_failed"
  | "generate_failed"
  | "payment_failed"
  | "payment_needs_customer"
  | "charge_held"
  | "charge_blocked"
  | "payout_failed"
  | "payout_stuck"
  | "refund_failed"
  | "refund_after_payout"
  | "payment_disputed"
  | "visit_cancelled_late";

export const ALERT_KIND: Record<AlertKind, { label: string; short: string; todo: string; urgent: boolean }> = {
  visit_needs_cover: {
    label: "Needs cover today",
    short: "Needs cover",
    todo: "A block went back on the board with a clean booked for today. Find cover, or call the customer.",
    urgent: true,
  },
  visit_no_show: {
    label: "Clean missed",
    short: "Missed",
    todo: "A booked clean passed without being started. Check with the cleaner and the customer.",
    urgent: true,
  },
  visit_unfinished: {
    label: "Clean never finished",
    short: "Unfinished",
    todo: "A clean was started but never marked complete. Check what happened with the cleaner.",
    urgent: true,
  },
  block_stalled: {
    label: "Block stalled",
    short: "Stalled",
    todo: "The block's dates have passed with cleans never booked. Agree with the customer, then end it or put it back on the board.",
    urgent: false,
  },
  block_overlap: {
    label: "Block cut short",
    short: "Cut short",
    todo: "This block ran into the next one booked at the same home. Agree with the customer what happens to the lost cleans.",
    urgent: false,
  },
  block_closed: {
    label: "Block closed by Ping",
    short: "Closed",
    todo: "The block had no cleans left to give, so it was closed. Check whether the customer wants to book again.",
    urgent: false,
  },
  release_failed: {
    label: "Offers didn't go out",
    short: "Offers failed",
    todo: "The engine couldn't offer this job to cleaners. Assign it by hand, and tell the main session.",
    urgent: false,
  },
  generate_failed: {
    label: "Cleans weren't booked",
    short: "Booking failed",
    todo: "The nightly job couldn't book this block's cleans. Tell the main session.",
    urgent: false,
  },
  payment_failed: {
    label: "Payment failed",
    short: "Payment failed",
    todo: "The customer's card couldn't be charged and there are no tries left. Contact the customer, and agree what happens to the rest of the block.",
    urgent: true,
  },
  payment_needs_customer: {
    label: "Customer must confirm payment",
    short: "Needs customer",
    todo: "The customer's bank wants them to confirm this payment. Ask them to confirm it; nothing is retried without them.",
    urgent: true,
  },
  charge_held: {
    label: "Charge held",
    short: "Held",
    todo: "This clean had \"couldn't do\" items, so the customer hasn't been charged. Check it, then charge it or leave it.",
    urgent: false,
  },
  charge_blocked: {
    label: "Charge can't go ahead",
    short: "Blocked",
    todo: "A charge is waiting on something that isn't the customer's fault (often the cleaner's Stripe set-up). Read the message, sort it, and it goes through on its own.",
    urgent: true,
  },
  payout_failed: {
    label: "Cleaner's bank payout failed",
    short: "Payout failed",
    todo: "A cleaner's bank didn't accept their pay, or Stripe wouldn't send it. Ask the cleaner to check their bank details under Getting paid; it's sent again once they have.",
    urgent: true,
  },
  payout_stuck: {
    label: "Cleaner's bank payout needs checking",
    short: "Payout stuck",
    todo: "A bank payout didn't match Ping's record or never reached Stripe. Don't pay the cleaner by hand. Check their Stripe account and tell the main session.",
    urgent: true,
  },
  refund_failed: {
    label: "Refund didn't go through",
    short: "Refund failed",
    todo: "A refund the team asked for didn't reach the customer. Open the clean under Payments and try again; if it fails twice, tell the main session.",
    urgent: true,
  },
  refund_after_payout: {
    label: "Refund after the cleaner was paid",
    short: "Refund after pay",
    todo: "The cleaner's part of a refund comes out of their next earnings at Stripe. Let the cleaner know why their next payout is smaller.",
    urgent: false,
  },
  payment_disputed: {
    label: "Chargeback",
    short: "Chargeback",
    todo: "A customer's bank has disputed a payment. Answer it in Stripe before its deadline, with the clean's photos and checklist from QC.",
    urgent: true,
  },
  visit_cancelled_late: {
    label: "Cancelled at short notice",
    short: "Late cancel",
    todo: "A customer cancelled a clean inside the notice period. Ring or text the cleaner so they don't travel; the app shows them but doesn't notify them yet.",
    urgent: true,
  },
};

export const ALERT_ORDER = Object.keys(ALERT_KIND) as AlertKind[];

export function alertKind(kind: string): AlertKind | null {
  return kind in ALERT_KIND ? (kind as AlertKind) : null;
}
