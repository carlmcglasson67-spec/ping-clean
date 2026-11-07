# Track B — Cleaner app

Worktree: cleaner-app · Branch: track/cleaner-app

## You own
app/(work)/

## You never edit
lib/, components/ui/, supabase/, package.json, other route groups.
Need a shared change? Write it in SHARED-REQUESTS.md and stop that piece.

## Blocks, rebooking, "couldn't do" (Carl, 7 Nov 2026)
- Every job is a **block of 1 to 8 cleans**. Claiming takes the whole block. `job_board()`
  returns `block_size` and `ends_on` (last clean): show "4 cleans, fortnightly, last one 18 Dec".
- **Rebooks**: when a customer books again, the cleaner who did their last block gets first
  refusal for a while (`job_board().first_refusal = true`): show it as "Your customer has
  booked again". Still town and district only until claimed.
- **The visit day**: `start_visit(visit)` on the day lays out the checklist;
  `complete_visit(visit)` refuses until every item is ticked (`done = true`) or marked
  "couldn't do" (`done = false, skipped_reason = '<why>'`, non-blank, max 300), and a before
  and an after photo are uploaded (the file must be in the bucket, not just the row). Ticking
  a skipped item doesn't clear its reason for you: send `{ done: true, skipped_reason: null }`. The customer sees the
  reasons on that visit. Errors PC010–PC015 → `pingErrorMessage()` in `lib/db/errors.ts`.

## Build (in this order, one PR each)
1. Application + document upload (private bucket, signed URLs).
2. Areas and availability settings.
3. Job board: offers for my tier, town + postcode district only until claimed; claim a block.
4. Today's jobs with directions and full address (claimed only).
5. Checklist (tick or "couldn't do" + reason), before/after photos, mark complete. Works
   one-thumbed in bad signal.
6. Earnings and payout history (read-only until Phase 5). PWA manifest + push.

## Next items
- A calendar view (like Apple/Google Calendar) of the cleaner's claimed cleans across their
  blocks, with addresses only for claimed work.

## Done when
A test cleaner claims Track A's booking and completes a visit with checklist and photos.

## Before each PR
design-reviewer → security-reviewer → verifier. Paste their reports in the PR.
