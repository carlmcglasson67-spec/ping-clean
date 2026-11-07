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
