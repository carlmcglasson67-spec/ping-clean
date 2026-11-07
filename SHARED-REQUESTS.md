# Shared requests

Changes a track needs in code it doesn't own (lib/, components/ui/, supabase/,
package.json, scripts/, other route groups). The main session picks these up; Carl
signs off any schema change. Newest at the bottom of each track's section.

## Track B — cleaner app

### B1. A way for a brand-new person to apply (auth + lib/auth)
- **What:** (a) a sign-up form for cleaners in `app/(auth)` (email, password, full name →
  `supabase.auth.signUp`), which then sends them to `/work/apply`; (b) `postLoginPath()`
  in `lib/auth/roles.ts` lets a *customer* follow `?next=/work/apply`.
- **Why:** `/work/apply` (Track B, PR "application") turns a signed-in customer into an
  applicant through `apply_as_cleaner()`. But there's no sign-up anywhere yet, and a
  signed-out visitor who taps "apply" is sent to `/login?next=/work/apply`, which
  `postLoginPath` currently drops (a customer may only follow `/account…`), so they land
  on `/account` instead.
- **Proposed:** in `postLoginPath`, allow `next === "/work/apply"` for `customer`, as an
  explicit single-path exception (not the whole `/work` area). Track A's site can then
  link "Clean with Ping" to `/work/apply`.

### B2. Run every e2e file (scripts/db-test.sh or package.json)
- **What:** `npm run test:e2e` runs `tests/e2e/roles.e2e.mjs` only, so Track B's flows
  are called from the end of that file (`cleanerFlows()` in `tests/e2e/cleaner.e2e.mjs`).
- **Why:** two tracks adding flows to one file will collide.
- **Proposed:** a tiny runner that builds once, starts the app and fake Supabase once,
  then imports every `tests/e2e/*.flows.mjs` in turn. Track B will rename its file to
  match.

### B3. tests/e2e/fake-supabase.mjs grew (FYI, already in Track B's PR)
Additive only: RPCs with named arguments (scalar, composite and set returns, as
PostgREST does), PATCH/POST with `Prefer: return=…`, Storage upload / sign / fetch by
signed URL (gated by the real `storage.objects` policies), and CORS for the browser.
Track A will likely need the same for checkout; worth merging this first.

### B4. `public.start_visit(p_visit uuid)`: DONE in #11
- **Why:** item 5 (checklist, photos, complete). `visits` has no UPDATE grant for
  cleaners, and `checklist_items` has no INSERT grant, by design. Ticks and photo
  uploads are only allowed while a visit is `in_progress`, so something has to move it
  there and lay out its checklist.
- **Proposed:** security definer, `search_path = ''`, granted to `authenticated` only.
  - **Checks**, in lock order (visit, then series): the caller is an active cleaner;
    `visits.cleaner_id = me`; the series is `claimed` by me; the visit is `scheduled`;
    `scheduled_date = private.london_today()`.
  - **Then:** sets `status = 'in_progress'` and `started_at = now()`, and copies the
    default `checklist_templates.items` into `checklist_items` (key, room, label,
    position), `on conflict (visit_id, item_key) do nothing`.
  - **Idempotent:** if the visit is already `in_progress` by me, it returns without
    changing anything. A retry in bad signal must be harmless.
  - **Errors** in the `claim_series` style, so the app can word them:
    `PC010` not your visit · `PC011` not today · `PC012` already finished or cancelled.

### B5. `public.complete_visit(p_visit uuid)`: DONE in #11 (with "couldn't do" reasons)
- **Why:** item 5. "Mark complete" is the trigger for charging (Phase 5), so the
  database must decide whether a visit is complete, not the phone.
- **Proposed:** security definer.
  - **Checks:** the visit is mine and `in_progress`; every `checklist_items` row is
    `done`; at least one `before` and one `after` row in `visit_photos`.
  - **Then:** sets `status = 'completed'` and `completed_at = now()`, and adds 1 to
    `cleaners.completed_visits`.
  - **Idempotent:** an already-completed visit returns ok, so a retry can't double count.
  - **Errors:** `PC013` checklist not finished (`detail` = how many left) · `PC014`
    photos missing (`detail` = which kind) · plus `PC010` and `PC012` as above.
  - Phase 5 hangs the charge off this state change. It must not be started from the app.
- **Question for Carl:** does every item have to be ticked, or can a cleaner mark one
  "couldn't do" with a reason (for example, no access to a room)? The latter needs a
  `skipped_reason` column on `checklist_items`.

### B6. PWA: manifest icons, a service worker, and web push (item 6)
- **What:**
  - icons in `public/icons/` and `start_url` per app (the cleaner app wants `/work`) in
    `app/manifest.ts`;
  - `public/sw.js` that handles **push only**. It must not cache `/work` pages: Today
    carries addresses and key codes, which must not outlive a claim;
  - a `push_subscriptions` table (cleaner_id, endpoint, p256dh, auth, created_at; RLS
    so each user sees and writes only their own rows; schema sign-off);
  - VAPID keys in the server environment, and the main session's "new offer" edge
    function sending the push.
- **Why:** the brief's item 6, and the "we'll ping you" promise on the job board.
- **Track B will build:** the "Turn on job alerts" button in `/work/you`, and the
  subscribe/unsubscribe Server Actions.
