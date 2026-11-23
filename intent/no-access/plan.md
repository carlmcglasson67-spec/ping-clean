# No access: the cleaner couldn't get in (#60)

## Carl's decision (23 Nov 2026)

When a cleaner turns up and can't get in (no key, nobody home), the customer pays the
late-cancellation fee, and the cleaner gets their usual share of that fee for the wasted
trip. It is a rule in Settings (`settings.no_access_rule`), not code:

| Setting (admin console) | Stored as | What "Couldn't get in" costs |
| --- | --- | --- |
| No charge | `no_charge` | Nothing. |
| The late-cancellation fee | `late_cancel_fee` | The late-cancellation fee, never more than the clean's price, split by "Cleaner's share of that fee" (the clean's own split, or a fixed share, rounded down for the cleaner). No notice-time condition: the cleaner was at the door. |
| Decide each time | `admin_decides` | The office chooses, clean by clean: that fee, or nothing. |

Carl's choice is "The late-cancellation fee". The live row is set in Settings → Cancellations
and payouts, after the fee itself is set. The test seed sets it; no migration does.

## What the office does

On a **Clean missed** alert (a clean from a day that has gone, booked with a cleaner, never
started), Jobs → Alerts now has three answers: It was done, It wasn't done, **Couldn't get
in**. A missed clean already marked as not done (under "Marked as not done") can also become
"Couldn't get in" (the way back), as well as done after all.

The step shows, from `admin_no_access_quote`:

- the fee: charged to the customer's card now, paid to the cleaner for the trip after the
  check period, and Ping's part; or "No charge"; or, under "Decide each time", the choice;
- that the customer is emailed;
- a reason (kept on the clean, Ping team only), and a second press.

If Settings has no rule, or the rule uses the late fee and no fee is set, the step says so
and links to Settings (PC067). If the cost changes while the step is open, nothing happens:
the new figure is shown and the office confirms again (PC068).

It isn't offered for a clean that was started (they got in: done or not done), one with no
cleaner, or one waiting for cover (the cleaner named on it wasn't the one at the door): the
Jobs page leaves it out while the clean's "needs cover" alert is open, and the database
refuses it (PC058).

The Jobs page asks for the cost one clean at a time (`admin_no_access_quote` per missed
clean). A batch quote isn't needed at Ping's volume yet; add one if the alerts list grows.

## The money, all in the database

`admin_settle_visit(p_visit, 'no_access', p_reason, p_was_not_done, p_fee_pence, p_charge)`
(dropped and created again with two new parameters; every earlier call still works the same).

- `private.no_access_terms(visit)` works the fee out from the settings (PC067 when it can't).
- `p_fee_pence` and `p_cleaner_pence` must equal the fee and the cleaner's part of it now
  (PC068: a changed split is caught even when the fee is the same); `p_charge` is given under
  `admin_decides` and only then (PC068 otherwise: the page didn't show the rule that holds now).
- "It was done" and "It wasn't done" take none of the three (22023).
- The clean becomes `cancelled`, `cancel_reason = 'no_access'`, `cancelled_by` the admin,
  `late_cancel_fee_pence` the fee. A fee is a `late_cancel` payment written exactly as
  `cancel_visit` writes one, so `check_payment_matches_visit` (which already allowed
  'no_access'), the charge job, `payout_for_payment` (the cleaner's part after the check
  period), refunds and disputes all take it unchanged.
- The settlement is recorded (`outcome = 'no_access'`), the alert closes, and the block ends if
  that was its last clean.
- The cleaner's Earnings page lists their part once it's paid ("You couldn't get in: your
  part of the no-access fee, for the trip").

## The customer is told

Charging without a word would be wrong. The outbox (`private.customer_notices`, kind
`no_access_fee`, once per clean) emails the customer either way, linking to their account:

- with a fee: their cleaner came on (day) and couldn't get in, so the clean didn't go ahead;
  as the booking terms set out, a no-access fee of £X is being taken from their saved card
  ("part of it goes to your cleaner for the journey" only when the cleaner's part is above
  zero); next time, reply or get in touch with a key or access details before the next
  clean (customers can't change access details in the app after booking), or cancel in good
  time;
- with no fee: the same first line, then "There's no charge this time", and the tip.

A failed no-access fee is worded as a no-access fee, not a late-cancellation fee.

## Schema (Carl signs off by merging)

- `visit_settlements.outcome` takes `'no_access'`.
- `private.customer_notices`: new nullable `visit_id` (a no-access email may have no
  payment), set for kind `no_access_fee` and only that kind; the kind is added to its check.
- New functions: `private.no_access_terms`, `private.settle_no_access`,
  `public.admin_no_access_quote` (Ping team only). `public.notices_claim` takes the clean's
  date from `visit_id`. No new tables.

## For Carl to confirm

- **A cleaner suspended or removed since the clean still gets their share.** The cleaner's
  part goes to the cleaner named on the clean whatever their status now (they made the
  trip), as "It was done" pays them. The charge itself still waits until their Stripe account
  can take it. Say if a suspended cleaner's share should go to Ping instead.

## Not in this change

- Telling the cleaner. They were there; the office will usually have spoken to them.
- Booking terms wording for customers: the email says "as our booking terms set out", so the
  terms must say it (Carl).

## Tests

- Database (tests/db/no-access.test.ts): each rule, the fee and split in whole pence (same
  split, fixed share rounded down, capped at the price), PC067, PC068 (stale fee, missing,
  choice not asked, rule changed), refused when started, waiting for cover, no cleaner or
  today; the way back from not done; the payment row passing check_payment_matches_visit;
  the notice queued once and claimed with the clean's date; the full money path (settled,
  charged by the job, paid out to the cleaner: £15.00 = £3.75 Ping + £11.25 cleaner).
- End to end (tests/e2e/admin-jobs.flows.mjs): the way back charges the fee once and says so;
  "decide each time" needs a choice, catches a fee changed in Settings, and "no charge"
  charges nothing.
