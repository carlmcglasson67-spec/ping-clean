# Plan: blocks, booking, rebooking, the visit day

Signed off by Carl, 7 Nov 2026 (in conversation). Covers shared requests A-3, B4, B5.

## Decisions (Carl's, not reinterpreted)
1. Every booking is a **block of 1 to 8 cleans**. No series runs on indefinitely.
2. **Rebooking**: the next block at the same home goes first to the cleaner who did the
   previous block, for a window set in `settings` (starts NULL = off, straight to the hub).
3. **book_series** (A-3): one idempotent function, prices from settings only, no Stripe yet.
4. **start_visit / complete_visit** (B4, B5): claimed cleaner, on the day, server times.
   Every checklist item ticked or "couldn't do" with a reason; photos required.

## Migrations
### `20261107090000_blocks.sql`
- `settings.rebook_first_refusal_minutes integer null check (> 0)`; admins may update it.
  Not part of `settings_ready()`: NULL means "no first refusal", not "not ready".
- `series`:
  - `block_size smallint not null check (between 1 and 8)` (existing rows backfilled to 8).
  - `ends_on` becomes **not null** and is kept consistent: a trigger sets the planned last
    clean on insert (first preferred day on/after `starts_on` + (block_size − 1) × cadence),
    and visit generation re-projects it if the block slips (see below).
  - `client_request_id uuid`, `unique (customer_id, client_request_id)`: idempotency.
  - `rebook_of uuid`, FK `(rebook_of, customer_id) → series (id, customer_id)`: the
    previous block, same customer only.
  - `first_refusal_cleaner_id uuid → cleaners`: who got first refusal (null = nobody).
  - `offering_since` now means "when the hub opens". During a first-refusal window it is in
    the future; the tier windows and the unclaimed alert count from it.
- `job_offers.first_refusal boolean not null default false`.
- Engine changes (same function names and signatures):
  - `private.cleaner_fits(cleaner, district, day)`: one definition of "can do this job"
    (active, cleaner role, covers the district, works that day or no days set).
  - `private.open_tiers`: no tiers while `now() < offering_since`.
  - `private.eligible_cleaners` (+ `first_refusal` column): during the window, only the
    first-refusal cleaner, and only if they still fit; after it, the tier rules as before.
  - `private.release_one`: stores `first_refusal` on the offer.
  - `private.generate_visits_for_series`: **count-based**. Creates at most
    `block_size − (visits that exist)` visits, on cadence dates after today, inside the
    horizon. A block claimed late slips forward rather than losing cleans. Updates
    `ends_on` to the real/projected last clean.
  - `private.end_block_if_done(series)`: a claimed series whose block is fully booked and
    has nothing scheduled or in progress becomes `ended` (address access ends with it).
    Called by `complete_visit` and by the nightly visit job.
  - `public.job_board()` gains `block_size`, `ends_on`, `first_refusal` (appended columns).
- New: `public.book_series(...)` (below).

### `20261107090100_visit_day.sql`
- `checklist_items.skipped_reason text` (null, or 1–300 chars with a non-space) and
  `skipped_at timestamptz` (server-stamped). An item is either done or skipped, never both.
  Cleaners may update `done` and `skipped_reason` (existing policy: own visit, in progress).
- `visits.couldnt_do_count smallint not null default 0`, set at completion, with a partial
  index for the admin QC queue (`where couldnt_do_count > 0`).
- New: `public.start_visit(uuid)`, `public.complete_visit(uuid)`.

## Functions
```
public.book_series(p_property uuid, p_frequency series_frequency, p_preferred_day smallint,
                   p_window_start time, p_window_end time, p_duration_minutes integer,
                   p_starts_on date, p_block_size smallint, p_request_id uuid) returns uuid
public.start_visit(p_visit uuid) returns void
public.complete_visit(p_visit uuid) returns void
```
All `security definer`, `search_path = ''`, `revoke all from public, anon`, `grant execute to
authenticated`; role checked inside.

- **book_series**: customer only. Same `(me, p_request_id)` returns the first series, before
  any other check (a retry after success always succeeds). Then: settings ready; property is
  mine; district in `launch_districts`; minutes ≥ `min_booking_minutes`, multiple of 30, ≤ 600;
  `starts_on` after today (London); block 1–8; day 1–7 and window end after start. Snapshots
  price and commission from settings. Rebook: links to the latest earlier series at the same
  property that had a cleaner; if the window setting is set and that cleaner still fits,
  gives them first refusal. Audited by the existing series trigger.
- **start_visit**: active cleaner; visit is mine and its series is claimed by me; scheduled;
  today (London). Sets `in_progress` + `started_at = now()`, lays out the default checklist.
  Already in progress by me → no-op.
- **complete_visit**: active cleaner; visit is mine; in progress; today. Every item done or
  skipped with a reason; at least one before and one after photo whose file is really in the
  private bucket (added in security review: a row alone isn't evidence). Sets `completed`,
  `completed_at = now()`, `couldnt_do_count`; adds 1 to `cleaners.completed_visits`; ends the
  block if it was the last clean. Already completed → no-op (no double count). No money moves.

Lock order everywhere: series → cleaner → visit/offers.

## Error codes (apps word these; `lib/db/errors.ts`)
| Code | Meaning |
| --- | --- |
| PC010 | not your visit |
| PC011 | not today |
| PC012 | visit already finished, cancelled or no longer going ahead |
| PC013 | checklist not finished (detail = how many left) |
| PC014 | photos missing (detail = before / after) |
| PC015 | no checklist set up (admin) |
| PC020 | booking not open yet (settings unset) |
| PC021 | home not found |
| PC022 | outside the area we cover |
| PC023 | length of clean not allowed |
| PC024 | start date must be after today |
| PC025 | block must be 1 to 8 cleans |
| PC026 | day or time window not valid |

## RLS impact
No new tables. New columns sit under existing policies:
- `checklist_items.skipped_reason`: customer of that visit, its cleaner, admins (existing select
  policy). Other customers and cleaners see nothing.
- `visits.couldnt_do_count`: same people as the visit. Admin QC queue reads it.
- `series.first_refusal_cleaner_id`, `rebook_of`, `client_request_id`: customer and cleaner of
  the series and admins. A cleaner with first refusal sees the job only through `job_board()`
  (town and district), never the address, until they claim.
- `settings.rebook_first_refusal_minutes`: admin read/write only (existing policy).

## Tests (tests/db/blocks.test.ts, tests/db/visit-day.test.ts)
Block cap (weekly, fortnightly, 0 and 9 refused, late claim slips), booking idempotency,
unset settings, price from settings, rebook first refusal (window open, NULL, ineligible),
start/complete by claimed cleaner on the day only, unresolved/blank refused, couldn't-do
visibility, every role × every new function and column, attacker escalations by direct SQL.
