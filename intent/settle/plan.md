# Settling a clean by hand (shared request C-7)

## The gap

Two alerts tell the office to act and give it nothing to act with:

- **Clean missed** (`visit_no_show`): the day passed and the cleaner never tapped Start.
- **Clean never finished** (`visit_unfinished`): they tapped Start and never tapped Complete.

Both happen for ordinary reasons in West Cumbria: no signal, a dead phone, a cleaner who
simply forgot. `complete_visit` only works on the day itself, so from the next morning the
clean can't be finished by anyone. The customer is never charged and the cleaner never paid,
and the only button on the alert is "Mark resolved", which hides it.

## What the office can now do

On either alert, in Jobs → Alerts, from the day after the clean:

| Choice | The clean becomes | Money |
| --- | --- | --- |
| **It was done** | completed (by the office, with a reason) | The customer is charged and the cleaner paid, exactly as if the cleaner had tapped Complete. |
| **It wasn't done** | a started clean is cancelled; a missed one stays missed | Nothing is charged. |

Both need a reason (kept, admin only) and a second tap. The second step names the people
and the amounts: whose card is charged now, who is paid after the check period, Ping's fee.
It also says if the cleaner had marked items "couldn't do", and if the block is on hold for
an unpaid clean (the charge is added all the same).

A missed clean marked "wasn't done" can still be changed to "was done" later (the customer
says nobody came, then the cleaner sends the photos). Its alert has closed, so it is kept
under **Marked as not done** below the alerts for 30 days, with "It was done after all".
Once a clean is completed or cancelled it is final: a wrong charge is put right with a
refund, which already exists.

After either answer the page itself says what happened ("Whitehaven CA28, Friday 20
November: marked as done. Ben's card is charged £40.00; Alex is paid £30.00 after the check
period."), because the alert's card goes with the alert. If someone else on the team
settled it first, nothing is done twice and the page says that instead.

## Rules, all in the database

`public.admin_settle_visit(p_visit, p_outcome, p_reason, p_was_not_done)`, security definer,
admins only.

- Only a clean the engine has handed over: status `in_progress` or `no_show`, booked for a
  day before today (London). Anything else: **PC056**. Today's cleans belong to the cleaner
  until the night's job has run.
- "Done" needs a cleaner on the clean (**PC057** otherwise), and then does what
  `complete_visit` does: completed, the cleaner's count goes up, the block ends if that was
  its last clean, and the charge row is written by the same `insert_visit_charge`. There is
  no second way to charge.
- "Done" pays the cleaner the clean was booked with, whatever their status now. It is
  refused (**PC058**) while the clean still has an open "needs cover" alert: that cleaner
  had come off the block that day, so they are not the one to pay. Once the team has
  resolved that alert the clean can be marked done, and the step names who is paid.
- The checklist and photos are not required: the office is vouching for the clean. Items
  already marked "couldn't do" are still counted. The office has looked at it, so the
  charge is not held for a second look.
- "Not done" on a started clean cancels it (`cancel_reason = 'admin'`: no fee to anyone).
- The caller says what its page was showing (`p_was_not_done`): a clean nobody has settled,
  or a missed clean already marked as not done (the way back). If the database holds
  something else, a colleague settled it while the page was open, and nothing is done
  (**PC056**). Without this, a stale "it was done" charged the customer seconds after a
  colleague had said it wasn't, and the first person was never told. The end-to-end test
  found it.
- Every call writes a `visit_settlements` row (who, what, why, what the clean was before),
  closes the clean's two alerts, and is in the audit log with the admin as the actor. The
  record can't be written, changed or removed by anyone through the API, the app's own
  server included; a change made from outside the app shows in the audit log; and a clean
  with a record can't be deleted.
- Reason: a real word or more, up to 300 characters (22023), as for ending a block.
- Lock order: series, cleaner, visit, as `complete_visit`. (Like `complete_visit`, that is
  the opposite order to `private.generate_visits()` called by hand. The scheduled job
  commits between its steps and can't deadlock with it; the by-hand form can, so it is not
  for the live database.)

## Schema (needs Carl's sign-off)

One new table, `public.visit_settlements`: `id`, `visit_id`, `outcome` (done / not_done),
`was_status`, `reason`, `actor_id`, `created_at`. Row level security on; the Ping team
reads it; nobody writes it except the function. Customers and cleaners never see the
reason. No change to any existing table.

## Not in this change

- **No access** (cleaner turned up and couldn't get in): now a third answer, "Couldn't get
  in" (Carl, 23 Nov 2026). See intent/no-access/plan.md.
- Part-charging a clean that was half done: mark it done, then refund part.
- Telling the cleaner or customer that the office settled it. Nothing is sent.

## Tests

- Database, per role: only admins; the two states and the day rule; done charges once with
  the clean's own three amounts and can't be done twice; not done charges nothing; a missed
  clean can go from not done to done, but only by a caller that knows it was marked not
  done; a clean left needing cover; alerts close; the
  settlement and audit rows; customers, cleaners and the service role can't read or write
  the record; the record holds its clean in place.
- End to end, from Jobs: the step names the people and amounts and moves the keyboard in
  and out; "wasn't done" needs a reason and the page says what happened; the way back
  charges once; a colleague settling first does nothing twice; QC shows a hand-settled clean.
- Not covered: two admins at the same instant (the database test would need two
  connections; the reviewer ran it by hand: one waits, then PC056), and the charge going
  all the way to a bank payout (payouts.test.ts covers that from a pending charge).
