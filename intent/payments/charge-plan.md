# Plan: charge when a clean is complete (payments plan, build step 5)

Follows `intent/payments/plan.md` (signed off 8 Nov 2026). Stripe TEST mode only.

## What this PR does

1. **Complete → "to charge".** `complete_visit` writes the payment row (pending) in the same
   step as the clean being marked complete. The amounts are the clean's own three amounts.
   A free clean (price 0) writes nothing.
2. **"Couldn't do" items.** `couldnt_do_rule` is still empty, so its rule doesn't run: a clean
   with "couldn't do" items is **not charged automatically**. The Ping team gets an alert and
   charges it with one function (`admin_charge_visit`). Set the rule to "charge in full" in
   settings and those cleans charge like any other.
3. **The charge job.** Every minute the database checks whether anything is due and, if so,
   calls one signed address on the app (`/api/stripe/charge-due`). That handler:
   - takes the due charges, one copy at a time (row locks, so two runs can't charge twice);
   - makes one destination charge per payment: the customer's saved card, the cleaner's
     Stripe account as the destination and seller ("on behalf of"), Ping's fee split off;
   - one PaymentIntent per payment row, ever (idempotency key `payment:<id>`); a retry
     confirms the same PaymentIntent again (`payment:<id>:confirm:<attempt>`).
4. **Stripe's answer.** The job records what Stripe said straight away, and the webhook
   (`payment_intent.succeeded` / `payment_failed` / `requires_action` / `canceled`) records it
   again. Both go through one database function that checks the PaymentIntent, amount, fee
   and destination match the row, and only moves the payment along its state map. The
   webhook is the source of truth; a late or replayed event changes nothing.
5. **Failed charges.** Retried on Carl's schedule (`payment_retry_hours`, 24 h and 72 h after
   the charge was first due). After the last try: `failed_final` and an alert for the team.
   With no schedule set: straight to the team.
6. **The bank wants the customer to confirm.** The payment waits as `requires_action` and the
   team is alerted. Nothing is retried behind the customer's back.
7. **Things that aren't the customer's fault** (the cleaner's Stripe account stopped being
   ready, a charge that got stuck, Stripe's answer not matching the row): the charge waits
   and the team is alerted. It doesn't use up the customer's retries.

## What it does not do (next PRs)

- The customer's "confirm your payment" and "update your card" pages, and telling the
  customer about a failed charge (no customer messages exist yet). Until then the team sees
  the alert and contacts them.
- **Pausing the rest of the block** after the last failed try. Nothing pauses a block yet
  (`TODO(pause)` in the engine): what happens to a paused block's cleans has never been
  decided. The alert says to sort it by hand.
- Payout rows and bank payouts (build step 6), refunds and the admin's retry button (step 7).

## One change to how the repo says things run

CLAUDE.md says background work never runs in the Next.js app. The engine's jobs already run
inside the database on pg_cron, and that stays true here: **the database decides what is due
and when**. But the database can't talk to Stripe, and the Stripe client (test-key guard,
fake for tests) lives in the app. So the Stripe call itself is a signed request handler in
`app/api/stripe/`, next to the webhooks. CLAUDE.md gets one line saying so.

## Data changes (needs Carl's sign-off)

- `payments.charge_started_at` (when the current try was sent). Not readable by customers.
- Four new alert kinds: `charge_held`, `charge_blocked`, `payment_needs_customer`,
  `payment_failed`. One open alert per clean and kind.
- `complete_visit` changed (adds the payment row). New functions: `admin_charge_visit`
  (admins), `charge_claim`, `charge_not_sent`, `stripe_payment_result` (server only).
- A cron entry `ping-charge-visits` (every minute), where pg_cron exists.

## What Carl sets up (test mode)

1. Vercel: `PING_JOB_SECRET` (32+ random characters), Preview and Production.
2. Supabase Vault: `ping_charge_job_url` (`https://<site>/api/stripe/charge-due`) and
   `ping_job_secret` (the same value). Without them the job does nothing.
3. Stripe webhook (Ping's own account endpoint): add `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `payment_intent.requires_action`,
   `payment_intent.canceled`.

## Tests

- Database: complete → one pending payment with the clean's amounts; "couldn't do" → alert,
  no payment, admin charges; claim locks and moves to processing; no card; cleaner not
  ready; result function refuses mismatches, ignores stale failures, never goes backwards;
  retry schedule and final failure; server-only grants per role.
- Unit: reading Stripe's answers and errors.
- End to end (fake Stripe): complete a clean → job charges → webhook confirms; a declined
  card; a card that needs confirming; the job address refuses a wrong secret.
