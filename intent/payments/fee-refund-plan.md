# Payments 12: refunding a late-cancellation fee

Follows payments 11 (PR #49). Closes the gap its security review found: a fee could only be
refunded in Stripe, where Ping wouldn't record it and the cleaner would still be paid.

## What changes
- The Ping team can refund all or part of a paid late-cancellation fee from admin Payments,
  the same screen and the same one-refund-at-a-time rules as a clean.
- Reasons for a fee:
  - **Fee waived** (new, `fee_waived`): the cleaner and Ping each give back their part, in the
    proportion the fee was split. For "they had a good reason" cases.
  - **Ping's mistake**, **Goodwill**, **Something else**: Ping carries all of it; the cleaner
    keeps their part.
- "The clean wasn't right" and "The cleaner didn't come" stay for cleans only; "Fee waived" is
  for fees only. The database refuses the wrong pairing (PC049), not just the form.
- Everything after the ask is the existing refund machinery unchanged: sent to Stripe once,
  cleaner's unpaid earnings held while it's on its way and reduced when it lands, audit row,
  alerts when Stripe says no.

## Database (needs Carl's sign-off)
`supabase/migrations/20261113110000_fee_refund.sql`: `refunds.reason` allows `fee_waived`;
`admin_refund` accepts `late_cancel` payments and checks the reason suits the kind.

## Not in this
A customer-facing refund email (still not built for cleans either).
