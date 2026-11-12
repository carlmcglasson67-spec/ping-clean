# Plan: pay cleaners after the check period (payments plan, build step 6)

Follows `intent/payments/plan.md` (signed off 8 Nov 2026: C14 daily payouts, 72 h check
period, cleaners paid only from what's collected). Stripe TEST mode only.

## What this PR does

1. **A paid clean becomes "earnings waiting".** The moment a clean's payment succeeds, one
   payout row is written for the cleaner: their earnings for that clean, available after the
   clean's completion time plus `dispute_window_hours` (Carl's setting). No payment, no
   payout row: cleaners are paid only from what was collected.
2. **Once a day, what's past the check period goes to the bank.** At about 6 in the morning
   the database asks the app to pay out. For each cleaner with earnings past their check
   period, the app:
   - asks Stripe how much of the cleaner's balance has cleared (card money takes a few days
     to clear at Stripe; Ping can't speed that up);
   - puts the oldest earnings that fit into one bank payout (a "batch");
   - sends one Stripe payout from the cleaner's own Stripe account to their bank
     (key `payout-batch:<id>`, so it can never be sent twice).
   Earnings that haven't cleared at Stripe simply wait for the next day. Nothing fails.
3. **Stripe's answer.** `payout.paid` / `payout.failed` on the Connect webhook mark the batch
   and its cleans. The job also asks Stripe about any payout it hasn't heard back on, hourly.
   The database checks the payout id, the cleaner's account and the amount before anything
   changes.
4. **A bank that says no.** The cleans go to "failed", the team gets an alert, and the cleaner
   sees "your bank didn't accept it" with a button to check their details with Stripe. Once
   Stripe tells Ping the account has changed, the next daily run tries again by itself.
5. **The cleaner sees where every pound is.** A new Earnings screen: each finished clean and
   its state (waiting for the customer's payment · being checked until a date · on its way ·
   sent, arriving a date · paid · bank said no), with totals.

## What it does not do (next PR)

- Refunds, chargebacks, cancellations and no-shows, and holding a cleaner's earnings because
  of one (build step 7). A clean whose payment stops being "succeeded" (refunded, disputed)
  is already never put in a batch: the database refuses it.
- An admin screen for payouts. The team sees failures as alerts.

## Data changes (needs Carl's sign-off)

- No new tables. One new column: `payout_batches.sent_at`.
- Two new alert kinds: `payout_failed`, `payout_stuck`.
- A trigger on payments (writes the payout row when a payment first succeeds).
- New server-only functions: `payout_due_cleaners`, `payout_batch_open`, `payout_batch_sent`,
  `payout_batch_not_sent`, `payout_batches_open`, `stripe_payout_result`.
- A cron entry `ping-pay-cleaners` (hourly; new payouts only in the 6 o'clock hour), where
  pg_cron exists. It uses the same Vault secrets as the charge job. No new set-up.
