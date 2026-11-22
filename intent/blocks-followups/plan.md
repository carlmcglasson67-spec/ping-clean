# Plan: blocks follow-ups (issue #12, last item of #60)

Carl's go-ahead: "fix all the issues on GitHub" (22 Nov 2026). One migration,
`supabase/migrations/20261122091000_blocks_followups.sql`, each function copied from its latest
definition and changed as little as possible. No new tables, columns or error codes.

## The four notes
1. **Ending a block with money rows on future cleans.** Already fixed by
   `20261108090000_visits_never_deleted.sql` (close_block cancels, never deletes; money rows hold
   their visit with ON DELETE RESTRICT; PC016 trigger). Tested in `tests/db/visit-history.test.ts`.
   This change adds a test for the engine path with a payment and a payout on a future clean.
2. **The self-closing overlap alert said "every clean is booked again" when it wasn't.** When the
   block in the way goes, `private.generate_visits_for_series` now books the rest of the block
   straight away (as claiming does: a held block's dates are booked all at once), even on the
   nightly run's 28-day horizon. So the message is true when written. Reworded slightly.
3. **Engine-closed blocks left old alerts open.** `private.close_block` with no admin now
   resolves the series' open `block_overlap` and `block_stalled` alerts (resolved_by stays null),
   then raises its `block_closed` alert as before.
4. **Claiming a block an admin just ended said "Another cleaner claimed this one first".**
   `public.claim_series` returns PC003 ("That job is no longer open to you") when the block has
   ended. The cleaner app already maps PC003 to "gone".

## Tests
`tests/db/blocks-followups.test.ts`: one test per note, in the existing style.
