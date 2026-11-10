# Plan: payments (Phase 5)

Status: **plan only, for Carl's sign-off.** No migrations, no app code, no Stripe keys until
Carl signs this off. Live payments stay off until Kate signs off the agent model, VAT and the
cleaner terms. Every money number below is a **setting that starts empty (NULL)**. Ping won't
charge, pay out or retry on a rule that hasn't been set, and nothing here invents a figure.

---

## Part 1: in plain English

### The idea in one paragraph

The customer buys each clean **from the cleaner**, and Ping introduces them and takes a fee
(the introducing-agent model). The plan:
- The customer's card is saved when they book. Nothing is taken then.
- When the cleaner marks a clean complete, the card is charged that clean's price.
- The charge goes **straight into the cleaner's own Stripe account**, with Ping's fee split
  off automatically. It never sits in Ping's account as Ping's money.
- The cleaner's share stays in their Stripe balance until the dispute window has passed.
  Then Ping releases it to their bank.
- If something goes wrong (a refund, a late cancellation, a failed card, a no-show), there's
  a clear rule for each, and a person (the admin) decides anything a rule can't.

### How Stripe is set up

- **Ping has one Stripe account, the "platform".** Cleaners each get a **Stripe Connect
  Express** account, set up through a short Stripe form from the cleaner app (ID, bank
  details). Stripe does the identity checks, not Ping.
- **Each charge is a "destination charge" made on the cleaner's behalf.** The customer's
  card is charged the visit price. Stripe moves it to the cleaner's account and passes
  Ping's fee back to Ping. The three amounts already stored on every visit (price, cleaner
  earnings, Ping fee) are exactly what Stripe moves.
- **Who is the seller ("merchant of record")?** With "on behalf of" set, **the cleaner is
  the seller** on the customer's statement and in Stripe's records. Ping is the platform
  that introduced them. That matches the agency model, but it's Kate's call (question K1).
- **Ping still carries the risk.** With Express accounts, Stripe holds the platform
  responsible if a refund or chargeback can't be taken back from a cleaner. That's a
  business risk, not a legal role, and it's why the dispute window and the refund rules
  matter.
- **Why not "separate charges and transfers"?** That's the other Stripe option: charge into
  Ping's account, then pay the cleaner later.
  - It makes timing easy, but the customer's whole payment sits in Ping's account until the
    cleaner is paid.
  - That looks like Ping selling the clean and holding the cleaner's money. That's the
    opposite of the agency model, and could bring in rules about holding other people's
    money.
  - So I recommend destination charges, and holding the *cleaner's* balance in *their*
    account until the window passes (manual payouts, see the appendix).

### VAT and the legal model: questions for Kate, not answers

The plan doesn't decide these. It's built so either answer works:
- whether Ping charges VAT on its fee only, or could be treated as selling the whole clean
- whether the cleaner or Ping issues the receipt, and what it must say
- how the late-cancellation fee is treated
- how long payment records must be kept (which is another reason never to delete them)

See the K questions at the end.

### What happens, step by step

1. **Saving a card at booking.** Checkout's step 5 is a placeholder today. It becomes
   Stripe's card form.
   - Ping creates (once per customer) a Stripe "customer" and a "SetupIntent". That saves the
     card for later charges without taking any money.
   - Stripe may ask the customer to confirm with their bank (3-D Secure) there and then,
     which makes later charges smoother.
   - The booking shows "Card saved" only when Stripe confirms it to Ping directly (the
     webhook), never just because the browser says so.
2. **Charging when a clean is complete.** When the cleaner presses Complete and it succeeds,
   a "to charge" row is written in the same step. A background job picks it up within a
   minute and charges the saved card.
   - **The customer isn't there,** so this is an "off-session" charge. Usually it just
     works.
   - **If the bank wants the customer to confirm** (strong customer authentication), the
     charge pauses. The customer gets a message with a link to a Ping page where they
     confirm. Nothing is retried behind their back.
3. **Paying the cleaner.** Each visit's earnings wait in the cleaner's Stripe balance until
   the **dispute window** has passed. A daily job then pays out everything that's cleared,
   in one bank payment. The cleaner app shows "waiting", "on its way" and "paid".
4. **Refunds** (admin only). Full or part.
   - The admin picks *why*, and that decides who carries it:
     - **the clean's fault:** the money comes back from the cleaner and Ping in proportion
     - **Ping's fault:** Ping carries it all
     - **goodwill**
   - A refund before payout comes out of the waiting balance. After payout, Stripe takes it
     from the cleaner's next earnings, and if there aren't any, Ping is left covering it
     (question C9).
5. **Late cancellation.** If a customer cancels or skips a clean inside the notice period,
   they're charged the late-cancellation fee. The cleaner gets their share and Ping the
   rest. Nothing is charged if no cleaner had taken the block yet (recommended; question C4).
6. **No-shows.**
   - **The cleaner didn't come:** the customer is never charged. The admin offers a
     replacement or rebooks, and records the no-show against the cleaner.
   - **The cleaner came but couldn't get in:** the admin decides, with the cleaner's
     evidence, whether the late-cancellation fee applies (question C6).
7. **"Couldn't do" items.** The visit is flagged for quality checks already. The
   recommendation is to charge as normal, and let the admin make a part refund during the
   dispute window if it's justified (question C5).
8. **Failed charges** (declined card, no funds).
   - The customer is told and asked to update their card.
   - Ping retries on the schedule Carl sets (question C7).
   - After the last try, the admin is alerted and the rest of the block is paused until it's
     sorted.
   - Whether the cleaner is still paid for a clean the customer never paid for is question
     C8.
9. **Card expiry.** A nightly check spots cards that will expire before the next clean and
   asks the customer to update them, a set number of days ahead (question C12). Stripe also
   updates some cards automatically when banks reissue them.
10. **Cleaners must finish Stripe set-up before they can take work.** A cleaner whose Stripe
    account can't receive money yet won't be offered blocks and can't claim them. Otherwise a
    clean could be done with nowhere for the money to go. The cleaner app shows "Finish
    setting up payments" until Stripe says they're ready (question C10).

### Fixing issue #12 first (note 1)

- Ending a block early (`close_block`) **deletes** the block's future visits. Once money rows
  exist, that delete would fail, or worse, lose money history.
- The fix: **never delete a visit**. Ending a block marks its future visits *cancelled*
  (stamped with when and why).
- The database will also refuse to delete any visit that has a payment or payout row, and
  there'll be a test that tries.
- This is the first, small PR, before any Stripe code.

### Numbers Carl sets (all start empty)

| Setting | What it means | Already in the database? |
|---|---|---|
| `dispute_window_hours` | How long after a clean before the cleaner's earnings can be paid out | yes |
| `cancel_notice_hours` | Cancelling with less notice than this counts as late | yes |
| `late_cancel_fee_pence` | The late-cancellation fee | yes |
| `late_cancel_cleaner_share_bps` | The cleaner's share of that fee | yes |
| `couldnt_do_rule` | Charge in full, or hold the charge for the admin, when items were "couldn't do" | new |
| `no_access_rule` | When the cleaner couldn't get in: no charge, the late-cancel fee, or the admin decides | new |
| `payment_retry_hours` | When to retry a failed charge (a list of delays) | new |
| `card_expiry_notice_days` | How many days before the next clean to ask for a new card | new |

If a setting is empty, the rule that needs it doesn't run, and the admin is told instead:
- **with no retry schedule,** a failed charge goes straight to the admin
- **with no dispute window,** nothing is paid out; booking already refuses to start without one

---

## Part 2: build plan (small PRs, in order)

| # | PR | What | Needs |
|---|---|---|---|
| 0 | **Never delete visits** (issue #12 note 1) | `close_block` cancels instead of deleting; a trigger refuses to delete visits with money rows; tests. | Carl's OK (changes a function) |
| 1 | **Money schema** | The tables and columns in the appendix, all with RLS and tests per role. New settings, all empty. | **Carl's schema sign-off** |
| 2 | **Stripe plumbing** | A server-only Stripe client that refuses any key not starting `sk_test_`/`rk_test_` and any live-mode event. A fake Stripe for tests. The webhook receivers, with signature checks and the event log. | Test keys in Vercel and Supabase |
| 3 | **Card saved at booking** (A-4) | One Stripe customer per Ping customer; SetupIntent; Track A puts Stripe's card form in checkout step 5; "Card saved" from the webhook. | PR 2 |
| 4 | **Cleaner payments set-up** | Connect Express onboarding links from the cleaner app (Track B screens); `account.updated` keeps "ready to be paid" current; offers and claims need it. | PR 2, Connect turned on |
| 5 | **Charge on completion** | `complete_visit` writes the "to charge" row; the charge job; the customer's confirm-your-payment page (Track A); failed charges, retries and alerts. | PR 3, 4 |
| 6 | **Payouts** | The daily payout job after the dispute window; payout webhooks; earnings states in the cleaner app (Track B). | PR 5 |
| 7 | **Refunds, disputes, cancellations, no-shows** | Admin refunds (full or part, with the reason deciding who carries it); chargebacks; the customer's cancel/skip with the late fee (doesn't exist yet); no-show and no-access handling; card-expiry reminders. | PR 5, 6 |
| 8 | **Proof** | The money-rules test (book, complete, charge, pay out one visit, show the three amounts), the whole journey in e2e against the fake, then a run on the Vercel preview with Stripe test cards. | all |

Tracks: Track A builds the card form, the confirm-payment page and receipts. Track B builds
the payments set-up and earnings screens. Track C builds the refund and failed-payment queues.
The main session builds everything else.

### What Carl sets up in Stripe (test mode only)

1. **A Stripe account for the business that runs Ping.** Which company that is goes to Kate
   (K1). Business details, the bank account for Ping's fees, statement name "PING CLEAN".
2. **Connect: on.**
   - Platform type: marketplace.
   - Account type: **Express**.
   - Country: United Kingdom.
   - Connect branding: logo and colours from `public/brand/`.
   - The platform profile questions: Ping introduces customers to self-employed cleaners and
     takes a fee.
3. **Test-mode API keys.** Publishable `pk_test_…` and secret `sk_test_…`. These go in Vercel
   (Preview and Production) and in Supabase function secrets. **Never a live key until Kate
   signs off.**
4. **Two webhook endpoints** (test mode), each with its own signing secret: one for Ping's
   own account events and one for "Connected accounts" events. I'll give you the exact URLs
   and event list in PR 2.
5. **Radar:** leave the default rules on.
6. **Emails:** turn off Stripe's own payment receipts until Kate has approved what a receipt
   must say (K4). Ping will send its own.

### Testing (no live keys, ever)

- **Unit and database tests:** a fake Stripe in `tests/`, like the fake Supabase. It answers
  the handful of Stripe calls Ping makes, and sends correctly signed test webhooks.
- **End-to-end:** the same fake, covering the whole journey:
  - card saved
  - clean done and charged
  - confirm-your-payment
  - failure and retry
  - refund
  - payout after the window
- **On the preview:** real Stripe *test* mode with Stripe's test cards (a normal card, one
  that needs bank confirmation, one that's declined) and Stripe's test bank details for
  cleaners.
- **Guards:** the existing `check-secrets` blocks live keys in the repo. The Stripe client
  refuses a live key at start-up. Webhooks refuse live-mode events.

---

## Part 3: open questions

### For Carl (C)

1. **C1. Dispute window.** Recommended: **72 hours** after the clean is completed. Customers
   spot problems within a day or two, and cleaners still get paid within the week. Stored as
   `dispute_window_hours`.
2. **C2. Late-cancellation notice.** Recommended: **24 hours**. It's the common
   cleaning-industry norm and easy to explain. Stored as `cancel_notice_hours`.
3. **C3. Late-cancellation fee, and the cleaner's share.** Your numbers; I won't suggest a
   figure.
   - For the share, I recommend **the same split as a normal clean**. It's consistent, easy
     to explain to both sides, and the cleaner keeps most of it.
   - Stored as `late_cancel_fee_pence` and `late_cancel_cleaner_share_bps`.
4. **C4. Late cancellation when no cleaner had taken the block yet.** Recommended: **no
   fee**. Nobody lost a booked slot, and charging would make Ping the seller of that fee.
5. **C5. "Couldn't do" items.** Recommended: **charge in full; the admin can part-refund
   during the dispute window.** Most "couldn't do" reasons are on the customer's side (no
   hoover, room locked), and holding every flagged charge would delay cleaners' pay.
6. **C6. The cleaner couldn't get in.** Recommended: **the admin decides, using the
   cleaner's photo or message as evidence; if charged, it's the late-cancellation fee.**
   It's rare, and a person should judge it.
7. **C7. Failed charges.** Recommended: **retry after 24 hours and again after 72 hours,
   tell the customer each time, then alert the admin and pause the rest of the block.**
   Most failures are temporary (payday, a card swap), and two tries keeps it from feeling
   like chasing.
8. **C8. If a customer never pays, is the cleaner still paid?** Recommended for V1: **the
   cleaner is paid from what's collected, and the admin can choose to pay a goodwill amount
   from Ping.** Under the agency model the debt is the customer's to the cleaner, but you
   may want to guarantee pay to attract cleaners. This is a business choice.
9. **C9. Refund after the cleaner has been paid, with no later earnings to take it from.**
   Recommended: **Ping covers it, and it's logged against the cleaner for the admin to
   review.** Stripe takes it from Ping anyway, and the dispute window makes it rare.
10. **C10. Stripe set-up before taking work.** Recommended: **yes, required before a cleaner
    is offered or can claim a block.** Otherwise a finished clean has nowhere to send the
    money.
11. **C11. Who pays Stripe's card fees?** Recommended: **Ping, out of its fee.** The cleaner
    sees exactly their earnings, and it's simplest to explain. The alternative is taking
    them from the cleaner's share.
12. **C12. Card-expiry reminder.** Recommended: **14 days before the next clean.** That gives
    time for two reminders. Stored as `card_expiry_notice_days`.
13. **C13. One saved card per customer, or one per block?** Recommended: **one per customer,
    reused for every block, changeable at any time.** It's how people expect it to work, and
    it fixes A-4's "a second booking makes a second Stripe customer".
14. **C14. Payout rhythm.** Recommended: **daily**, for everything past the window. It's
    simple and cleaners like quick pay. (Stripe itself may hold the first payouts for a new
    account for a few days.)

### For Kate (K)

1. **K1.** Does the introducing-agent model hold with Stripe's set-up?
   - The **cleaner** would be the seller of each clean (charges made "on behalf of" their
     Stripe account).
   - Ping takes an application fee.
   - Which Ping company owns the Stripe platform account?
2. **K2. VAT on Ping's fee.** Is it VAT on the fee only, or is there any risk Ping is treated
   as supplying the whole clean (for example because Ping sets the price)? When must Ping
   register?
3. **K3.** How is the **late-cancellation fee** treated: the cleaner's income, Ping's, or
   compensation (outside VAT)?
4. **K4. Receipts.** Who issues them, and what must they show (the cleaner's name, "on behalf
   of", Ping's fee)?
5. **K5. Cleaner terms.** These need to cover:
   - Stripe's Connected Account Agreement
   - refunds and chargebacks taken from their earnings
   - the dispute-window hold
   - self-employed status
6. **K6. Record keeping.** How long must payment records be kept? The plan never deletes
   visits, payments or refunds, and keeps them even if an account is closed.
7. **K7.** Any rules for Ping holding the cleaner's earnings in **their** Stripe balance until
   the dispute window ends?

---

## Appendix: technical detail

### A. Stripe calls

- **Customer:** one per Ping customer. `customers.create` with idempotency key
  `profile:<id>:customer`, `metadata.profile_id`.
- **Card:** `setup_intents.create` with `usage: "off_session"`, `customer`,
  `metadata.series_id`, key `series:<id>:setup`. On success, the payment method becomes the
  customer's default.
- **Charge:**

  ```
  payment_intents.create(
    amount = visits.price_pence, currency = "gbp",
    customer, payment_method, off_session = true, confirm = true,
    on_behalf_of = cleaners.stripe_account_id,
    transfer_data.destination = cleaners.stripe_account_id,
    application_fee_amount = visits.ping_fee_pence,
    metadata.visit_id, metadata.payment_id
  )
  ```

  - Idempotency key `payment:<payment id>`; one PaymentIntent per payment row, ever.
  - A retry **confirms the same PaymentIntent again**, with key
    `payment:<id>:confirm:<attempt>`. It never makes a new one.
  - `authentication_required` → status `requires_action`, and the customer confirms with the
    PaymentIntent's client secret on `/account/pay/<payment id>`.
- **Connected accounts:**
  - `accounts.create(type: "express", country: "GB", capabilities: card_payments + transfers,
    settings.payouts.schedule.interval: "manual")`, key `cleaner:<id>:account`.
  - `account_links.create` for onboarding and returning to update details.
  - Manual payouts keep cleared earnings in the cleaner's balance until Ping releases them.
- **Payout:** `payouts.create` on the connected account (`Stripe-Account` header) for the sum
  of that cleaner's cleared visits. Key `payout-batch:<batch id>`.
- **Refund:** `refunds.create(payment_intent, amount, reverse_transfer: true,
  refund_application_fee: true)` when the cleaner and Ping share it, in proportion.
  - When Ping carries it alone: `reverse_transfer: false`, `refund_application_fee: false`.
  - Key `refund:<refund id>`.
- **Late-cancel fee:** the same as a charge, with `amount = fee` and
  `application_fee_amount = fee − cleaner share`.
  - Cleaner share = `floor(fee × bps / 10000)`; Ping takes the remainder, so pence always add
    up.
  - Not charged when no cleaner is assigned (C4).

### B. Where the code runs

- **Next.js (server only):**
  - SetupIntent creation and onboarding links (a person is waiting)
  - reading the customer's own payment status
- **Supabase Edge Functions** (CLAUDE.md: background work lives there, on pg_cron):
  - `stripe-webhook-platform` and `stripe-webhook-connect`
  - `charge-visits` (every minute)
  - `pay-out` (daily)
  - `card-expiry` (nightly)
- All Stripe writes to the database go through security-definer functions called with the
  service role. No browser ever writes a money row.

### C. Data changes (PR 1, needs sign-off)

- **`private.customer_billing`**: one row per customer.
  - `customer_id` (pk, profiles), `stripe_customer_id` (unique),
    `default_payment_method_id`, `card_brand`, `card_last4`, `card_exp_month`,
    `card_exp_year`, `updated_at`.
  - RLS on, no direct grants.
  - The customer reads brand, last 4 digits and expiry only, through a function.
  - `series_billing` keeps "the card this block is charged to" (`stripe_payment_method_id`),
    and `stripe_customer_id` moves here (C13).
- **`cleaners`**: add `stripe_charges_enabled`, `stripe_payouts_enabled`,
  `stripe_details_submitted`, `stripe_requirements_due` (all booleans, default false) and
  `stripe_status_at`.
  - Written only from `account.updated`.
  - `private.cleaner_payable(id)` = charges and payouts enabled; used by
    `eligible_cleaners`, `claim_series` and `admin_assign_series` (C10).
- **`payments`** (exists). Add:
  - `cleaner_account_id` (the destination at charge time)
  - `cleaner_amount_pence`, with a check: `amount = cleaner_amount + application_fee`
  - `stripe_charge_id`
  - `attempts` (int), `next_retry_at`, `last_error_code`
  - `disputed_at`, `dispute_status`
- **Payment states** (enum extended): `pending` (row written, not sent) → `processing` →
  `succeeded` | `requires_action` | `failed`.
  - `failed` → (retry) `processing` … → `failed_final`
  - `succeeded` → `partially_refunded` | `refunded`
  - `succeeded` → `disputed` → `succeeded` (won) | `lost`
  - Transitions only in `private.payment_transition(id, to, event)`, which refuses anything
    off this map.
- **`refunds`** (new):
  - `id`, `payment_id`, `amount_pence`, `cleaner_part_pence`, `ping_part_pence` (check:
    they add up to the amount)
  - `reason` ∈ (`clean_quality`, `ping_error`, `goodwill`, `no_show`, `other`)
  - `note` (≤ 300), `requested_by` (admin), `stripe_refund_id` (unique),
    `idempotency_key` (unique)
  - `status` (`pending` | `succeeded` | `failed`)
  - Check: total refunds ≤ payment amount. Admin only. Audited.
- **`payouts`** (exists): stays one row per visit (the cleaner's earnings for it). Add
  `payment_id` and `batch_id`.
  - Rename `stripe_transfer_id` → `stripe_payout_id`, **not** unique (one bank payout pays
    many visits).
  - States: `waiting` (until `available_after` = completed + `dispute_window_hours`) →
    `in_batch` → `paid` | `failed`.
  - Also `held` (refund, dispute or admin) and `cancelled` (fully refunded).
- **`payout_batches`** (new):
  - `id`, `cleaner_id`, `amount_pence`, `stripe_payout_id` (unique),
    `idempotency_key` (unique)
  - `status` (`created` | `paid` | `failed`), `arrival_date`
- **`private.stripe_events`** (new): `event_id` (pk, so replays do nothing), `type`,
  `account` (Connect), `received_at`, `processed_at`, `error`. No access from any API role.
- **`visits`**: add `cancel_reason` ∈ (`customer`, `customer_late`, `block_ended`,
  `cleaner_no_show`, `no_access`, `admin`).
  - Payments and payouts reference visits `on delete restrict`.
  - A trigger refuses deleting a visit with money rows (issue #12).
- **New settings** (all NULL): `couldnt_do_rule`, `no_access_rule`, `payment_retry_hours`
  (int[]), `card_expiry_notice_days`.
- **New functions:**
  - customer: `cancel_visit` / `skip_visit` (late-fee rule from settings)
  - admin: `admin_refund`, `admin_hold_payout`, `admin_release_payout`, `admin_retry_payment`
  - service role only: `record_*` for the webhooks
  - Every one audited with actor, action, visit id and amount (ping-money-rules 6).

### D. Webhooks handled

Every event is checked first:
- signature verified with `stripe.webhooks.constructEvent` on the raw body, against the
  endpoint's own secret, with a 5-minute tolerance
- `livemode: true` refused
- the event id recorded, and a duplicate acknowledged without doing anything

Platform endpoint:
- `setup_intent.succeeded` / `setup_intent.setup_failed`
- `payment_intent.processing` / `succeeded` / `payment_failed` (including
  `authentication_required`) / `canceled`
- `charge.refunded`, `refund.updated` / `refund.failed`
- `charge.dispute.created` / `charge.dispute.closed`
- `payment_method.automatically_updated` / `payment_method.detached`

Connect endpoint:
- `account.updated`
- `payout.paid` / `payout.failed`
- `account.application.deauthorized`

The webhook is the source of truth: the charge job only records "sent". Success, failure,
refunds and payouts are set from events (ping-money-rules 7).

### E. Tests

- **Database:**
  - per role: customers see only their own payments and refunds, and only the card's
    brand/last 4/expiry; cleaners see only their own payouts and batches; nobody writes
    money rows directly
  - pence always add up
  - one live payment per visit and kind; refunds never exceed the payment
  - visits with money rows can't be deleted, and `close_block` cancels instead
  - settings stay NULL and rules skip themselves
  - no claim without Stripe set-up
- **Unit:**
  - the Stripe client refuses live keys
  - webhooks: signature check, refusing live-mode events, replays
  - the fee and late-cancel share sums
  - each state machine's allowed moves
- **End-to-end (fake Stripe):** the whole journey in "Testing" above.
- **The money-rules test:** book, complete, charge and pay out one visit, then print
  `price_pence`, `cleaner_earnings_pence`, `ping_fee_pence` and what Stripe moved.
