---
name: ping-money-rules
description: Ping Clean money and marketplace rules. Use whenever creating or changing anything that touches prices, commission, visits, payments, payouts, refunds, cancellations, Stripe or Stripe Connect.
---
# Ping money rules

1. Integer pence everywhere. Use lib/money helpers. No floats, no toFixed for money.
2. Every visit stores three amounts separately: price_pence, cleaner_earnings_pence,
   ping_fee_pence, and price = earnings + fee must hold. Add a DB check constraint.
3. Prices, commission, minimum hours, tier windows and cancellation rules come from the
   settings table. Never hard-code a number in app code.
4. Card is saved at booking (SetupIntent). Charge happens only when a visit is marked
   complete. Payout only after the dispute window ends.
5. Ping is an introducing agent: the customer buys the clean from the cleaner. Use Stripe
   Connect Express with application fees; never route the full amount through Ping's
   balance as Ping revenue.
6. Every money state change is idempotent (Stripe idempotency keys, unique constraints
   on payment and payout rows) and logged with actor, action, visit id and timestamp.
7. Stripe webhooks verify the signature and are the source of truth for payment status.
8. Test mode only. If you see a live key anywhere, stop and tell Carl.

Before reporting done, write a test that books, completes, charges and pays out one
visit, and show the three amounts it produced.
