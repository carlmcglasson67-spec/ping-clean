# Plan: refunds and chargebacks (payments plan, build step 7, part one)

Follows `intent/payments/plan.md` (signed off 8 Nov 2026: step-by-step 4, C9, appendix A).
Stripe TEST mode only. Late-cancellation fees, "couldn't get in" and card-expiry reminders
are the next PRs; they don't touch this.

## Refunds (the Ping team only)

1. On a new **Payments** page in the admin console, the team opens a paid clean and refunds
   all or part of it, picking why. The reason decides who carries it (plan, step 4):
   - **The clean wasn't right** / **the cleaner didn't come**: the cleaner and Ping carry it
     in the same proportion as the clean was split.
   - **Ping's mistake** / **goodwill** / **other**: Ping carries all of it. The cleaner's
     earnings aren't touched.
2. The split is worked out in whole pence in the database and stored on the refund:
   Ping's part = the refund × Ping's fee ÷ the price, rounded to the nearest penny; the
   cleaner's part is the rest. The two always add up to the refund.
3. One refund at a time per payment. While it's with Stripe, the cleaner's earnings for that
   clean are held so they can't go to the bank mid-refund.
4. The app sends it to Stripe once (`refund:<id>`), as the plan's appendix A says: shared
   refunds reverse the cleaner's part and refund Ping's fee in proportion; Ping-only refunds
   touch neither.
5. Stripe's answer (straight away, and again by webhook) settles it in one step:
   - the payment shows part refunded or refunded;
   - the cleaner's earnings for that clean drop by their part (or are cancelled if nothing is
     left), then carry on to the bank as normal;
   - if they'd **already been paid** for that clean, Stripe takes their part from their next
     earnings. The payout job only ever sends what has cleared in their Stripe balance, so
     this needs nothing new; the team gets an alert saying so (C9).
6. If Stripe refuses or later fails a refund, nothing changes on the payment, the cleaner's
   earnings are released, and the team is told.

7. Whatever order things happen in (the bank had refused the cleaner's payout, a refund lands
   while their pay is with the bank, Stripe takes a refund back), the cleaner's unpaid
   earnings for the clean are put back on exactly "their part, less their part of refunds
   that succeeded", so they can never be left on a figure that blocks their other pay.
8. A refund Stripe hasn't answered on is asked about hourly; after a day a person looks.

## Chargebacks (the customer's bank takes the money back)

- **Opened:** the payment shows disputed, the cleaner's unpaid earnings for that clean are
  held, and the team gets an urgent alert (Stripe gives a deadline for evidence; the clean's
  photos and checklist are the evidence).
- **Won:** the payment stands again and the earnings are released.
- A refund that settles while a chargeback is open is recorded, but the payment keeps showing
  disputed until the chargeback is decided.
- **Lost:** the payment shows lost, unpaid earnings for that clean are cancelled, and the
  team is told. Ping carries a lost chargeback (C9). The cleaner's part is still sitting in
  their Stripe balance at that point; taking it back is a manual step in Stripe for now, and
  the alert says so.

## Data changes (needs Carl's sign-off)

- No new tables or columns.
- Three new alert kinds: `refund_failed`, `refund_after_payout`, `payment_disputed`.
- The payout guard now allows a cleaner's earnings to be less than their part of the payment
  by exactly what refunds took, and lets a part-refunded clean go to the bank.
- The payment state map gains one move (disputed to refunded).
- Two of PR 9's functions are replaced (`fail_batch`, `payout_batch_open`) so earnings coming
  back from a bank payout are put right.
- New functions: `admin_refund` (admin only), and server-only `refund_to_send`,
  `refunds_open`, `stripe_refund_result`, `stripe_dispute`.

## Not in this PR

- Telling the customer by email (Stripe shows the refund on their statement in 5 to 10 days).
- Automatic dispute evidence. The alert points the team at the clean.
- Late-cancellation fees, no-access decisions, card-expiry reminders.
