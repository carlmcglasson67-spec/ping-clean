# Plan: after the last failed try (payments, follows charge-plan.md)

Carl's decisions, 12 Nov 2026:

1. **The block goes on hold.** The cleaner is told not to go. Cleans that fall while it's on
   hold are skipped and never charged. It comes back on the moment the customer pays.
2. **Seven days.** Still unpaid after 7 days (`settings.payment_pause_days`): the block ends,
   the cleaner is freed up and the team is told. The unpaid clean is still owed.
3. **Email.** The customer is emailed about a failed payment, a payment their bank wants
   confirmed, the block going on hold and the block ending.

## This PR (database and the cleaner's screens)

- `payment_failed_now`: after the last try, pauses the block (when
  `failed_payment_pauses_block` is on) and records why in `private.series_holds`. The cleaner
  can see the block is paused, never why.
- `start_visit` refuses a held clean with a clear "don't go" (PC017). The cleaner's Today and
  clean screens say "On hold. Don't go."
- `stripe_payment_result`: a success takes the block off hold, unless another clean in the
  block is still unpaid for good. Cleans whose day passed on hold become `skipped`
  (`cancel_reason = payment_hold`). The block does not get longer to make up for them.
- Nightly `run_payment_holds`: skips passed cleans, ends blocks past the limit.
- `private.customer_notices`: an outbox, one row per email, written in the same step as the
  thing it's about, once each. `notices_claim` / `notice_sent` for the sender.

## Next PR

- The sender (Resend) and the cron kick for waiting emails.
- The customer's page the emails link to: pay now (with the bank's confirmation step when
  asked) and use a different card. The card form doesn't exist anywhere in the app yet, so
  it is built there and reused at checkout.

## Not decided, left as is

- A held block's cleaner keeps the address and key code while it's on hold (up to 7 days).
- A clean booked for the same day the block comes back on stays booked.
- Customers can't pause a block themselves; only a failed payment does.
