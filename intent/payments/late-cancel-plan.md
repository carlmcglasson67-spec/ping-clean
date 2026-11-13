# Plan: cancelling a clean, and the late-cancellation fee (payments plan, step 5)

Follows `intent/payments/plan.md` (signed off 8 Nov 2026: step 5, C2, C3, C4, appendix A).
Stripe TEST mode only.

## Why this is more than a fee

A customer can't cancel a single clean at all today: the only way out is the office ending
the whole block. So this PR builds cancelling first, and the fee on top.

## What the customer gets

- On My cleans, each upcoming clean has **Cancel this clean**.
- The next screen says exactly what it costs before they confirm:
  - **Free** with more notice than Carl's notice period (`cancel_notice_hours`, 24).
  - **The late-cancellation fee** inside it, if Carl has set one (`late_cancel_fee_pence`).
    Until he sets a fee, a late cancellation is free too: "if a setting is empty, the rule
    that needs it doesn't run" (plan).
  - **No fee if no cleaner had taken the block yet** (C4): nobody lost a booked slot.
- The fee they were shown is the fee they're charged: if it changed between the two screens
  (they sat on the page past the cut-off), they're shown the new figure and asked again.
- A cancelled clean isn't replaced. The block has one clean fewer.
- A clean can't be cancelled once its time has started.

## The fee

- Never more than the clean itself would have cost.
- Split with the cleaner as Carl's setting says (`late_cancel_split`):
  the same proportion as the clean, or a fixed share. Cleaner's part = fee × share, rounded
  down to the penny; Ping takes the rest, so the pence always add up (appendix A).
- It's charged to the saved card by the same job as a clean, with the same retries, the same
  "pay it yourself" page and the same hold if it's never paid.
- Once paid, the cleaner's part becomes earnings like any other, after the check period.

## Who is told

- The cleaner sees the clean as cancelled in their app.
- A late cancellation raises an alert for the office (the cleaner has lost a slot at short
  notice and nothing texts them yet).

## Data changes (needs Carl's sign-off)

- No new tables or columns.
- One new alert kind: `visit_cancelled_late`.
- New functions for the customer: `cancel_visit_quote`, `cancel_visit` (their own cleans only).
- The charge job, the pay-it-yourself page, the unpaid-booking check and the payout trigger
  learn that a payment can be a late-cancellation fee. The payment guard checks a fee is
  exactly the fee recorded on its cancelled clean.

## Not in this PR

- Refunding a fee from the admin Payments page (it lists fees; refunds stay cleans-only).
- "The cleaner couldn't get in" decisions, and card-expiry reminders.
- Texting or emailing the cleaner.
