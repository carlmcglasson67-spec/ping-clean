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

Both need a reason (kept, admin only) and a second tap that says what will happen.

A missed clean marked "wasn't done" can still be changed to "was done" later (the customer
says nobody came, then the cleaner sends the photos). Once a clean is completed or
cancelled it is final: a wrong charge is put right with a refund, which already exists.

## Rules, all in the database

`public.admin_settle_visit(p_visit, p_outcome, p_reason)`, security definer, admins only.

- Only a clean the engine has handed over: status `in_progress` or `no_show`, booked for a
  day before today (London). Anything else: **PC056**. Today's cleans belong to the cleaner
  until the night's job has run.
- "Done" needs a cleaner on the clean (**PC057** otherwise), and then does what
  `complete_visit` does: completed, the cleaner's count goes up, the block ends if that was
  its last clean, and the charge row is written by the same `insert_visit_charge`. There is
  no second way to charge.
- The checklist and photos are not required: the office is vouching for the clean. Items
  already marked "couldn't do" are still counted. The office has looked at it, so the
  charge is not held for a second look.
- "Not done" on a started clean cancels it (`cancel_reason = 'admin'`: no fee to anyone).
- Every call writes a `visit_settlements` row (who, what, why, what the clean was before),
  closes the clean's two alerts, and is in the audit log with the admin as the actor.
- Reason: a real word or more, up to 300 characters (22023), as for ending a block.
- Lock order: series, cleaner, visit, as `complete_visit`.

## Schema (needs Carl's sign-off)

One new table, `public.visit_settlements`: `id`, `visit_id`, `outcome` (done / not_done),
`was_status`, `reason`, `actor_id`, `created_at`. Row level security on; the Ping team
reads it; nobody writes it except the function. Customers and cleaners never see the
reason. No change to any existing table.

## Not in this change

- **No access** (cleaner turned up and couldn't get in) and whether that carries a fee:
  waits for Carl's `no_access_rule`. Until then the office uses "wasn't done".
- Part-charging a clean that was half done: mark it done, then refund part.
- Telling the cleaner or customer that the office settled it. Nothing is sent.

## Tests

- Database, per role: only admins; the two states and the day rule; done charges once with
  the clean's own three amounts and can't be done twice; not done charges nothing; a missed
  clean can go from not done to done; alerts close; the settlement and audit rows are
  written; customers and cleaners can't read settlements.
- End to end: the admin settles the seeded unfinished clean from Jobs and the alert goes.
