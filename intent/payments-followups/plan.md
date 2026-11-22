# Payments follow-ups (#44, and one item of #60)

Left over from the independent review of payments PRs 6 to 8 and card at booking (#44), plus
"the charge and payout jobs fail quietly" from #60. None allows a wrong or double charge.
Stripe TEST mode only. Two new migrations; no old one is edited.

- `supabase/migrations/20261122092000_payments_followups.sql` (#44, items 1 to 5)
- `supabase/migrations/20261122092100_job_call_alerts.sql` (#60)

## 1. A retry lost to a network error read as a fresh decline

**Today.** A retry confirms the same PaymentIntent. If the confirm is lost on the way to
Stripe, the payment stays `processing`; ten minutes later the job's check (`charge_claim`
mode `check`) re-reads the PaymentIntent, which still shows the *previous* try's decline, and
records it as a new failed try. The check also overwrites `charge_started_at`, so nothing
remembers when the lost try was sent.

**Change.**
- `payments.try_sent_at` (when the current try was sent; set only when a try is sent, never by
  the check) and `payments.try_by_customer` (the current try was the customer's own "Pay
  now"). Server-only columns, like `charge_started_at`: not in the column grants.
- `charge_claim` (create / retry / resend) and `customer_pay_begin` set both. The check leaves
  them alone.
- The job's check asks Stripe for the PaymentIntent with its latest charge. When Stripe says
  "failed", the job first calls the new `charge_try_lost(payment, latest_charge_created)`:
  if that charge is older than the try, the try never reached the card. The database gives
  the try back and the job sends the same try again (same attempt number) under a NEW Stripe
  idempotency key, so Stripe can never replay an old answer. A customer's lost try isn't
  counted as a decline: the payment returns to its schedule, but the try is not given back
  (their next "Pay now" never reuses a key). `charge_claim` returns `try_sent_at` and the
  check passes it back: a newer try than the one the check looked at is never judged. Only
  within three days of the charge first falling due, so it can never loop.
- `stripe_payment_result`'s "older try" test compares with `try_sent_at`, not the re-check time.

## 2. A spurious "confirm your payment" email

**Today.** When the customer presses "Pay now" and their bank asks them to confirm, the page
shows the bank's step. Stripe's `payment_intent.requires_action` webhook then arrives and
emails them "Your bank needs you to confirm a payment" while they're doing it.

**Change.** `stripe_payment_result`: a `requires_action` for a try that is the customer's own
and under ten minutes old is left as it is (`processing`, as the pay page records it). If
they walk away, the job's check finds it after ten minutes and the email and alert go then.

## 3. A limit on Stripe calls from the pay page

**Change.** `private.customer_stripe_calls` (one row per customer and kind: the hour's window
and its count; RLS on, no policies, no grants) and `public.customer_stripe_call(customer,
kind)`, server only. It counts the call and says whether it may go ahead, atomically, in the
database (Vercel runs many instances, so nothing in memory):

| kind | covers | limit |
| --- | --- | --- |
| `card_form` | "Use a different card" (a new SetupIntent each time) | 6 an hour |
| `check` | checking a payment after the bank's step, confirming a new card | 30 an hour |

`lib/stripe/pay.ts` asks before each Stripe call. Over the limit the page says, in plain words,
to give it a few minutes. "Pay now" already has its own limit (ten tries per payment).

## 4. The cleaner is told about a hold

**Change.** Three emails to the cleaner, through the same outbox as the customer's
(`private.customer_notices`, the Resend sender in `lib/notify/email.ts`, one email per event
by `dedupe`): the block is on hold (don't go), it's back on, it has ended. They never say why
(the cleaner must not learn the customer's card failed): only the town and the day of the
week, and a link to the cleaner app. `notices_claim` now also returns the block's town and
day.

## 5. A late card webhook overwriting a newer card

**Change.** `private.customer_billing.card_setup_at` (when Stripe made the SetupIntent that saved
the customer's current card). `stripe_card_saved` takes the SetupIntent's `created` time: an
older one never replaces the customer's card (it still gives a block that has no card yet
its card) and answers `older`.

## #60. The jobs failing quietly

**Change.** `private.job_calls` keeps the pg_net request id of each job's last call. On every
cron tick, before anything else, `kick_charge_job` / `kick_payout_job` read that call's answer
from `net._http_response`. Anything but 200 (a 401, a redirect, a timeout, no answer after ten
minutes) raises an office alert `job_call_failed`; a 200 closes it. A Vault value that's
missing or mistyped (`not_set_up`) while work is due raises the same alert, which closes as
soon as the set-up is right. One open alert per job (a unique index). An error while reading
the last answer is itself an alert and never stops the job. The two job handlers now stop at
50 seconds, inside pg_net's 55-second wait.

## Tests

- Unit: lost try (charge_try_lost is called with the latest charge's time; a returned try is
  sent again), the rate limit on each pay-page action, cleaner email wording (no reason, no
  amount), the SetupIntent's created time reaching the database.
- Database: every rule above, each role denied the new functions and tables.
- End to end: the pay page's "give it a few minutes" message.
