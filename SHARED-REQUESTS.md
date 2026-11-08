# Shared requests

Changes a track needs in code it doesn't own (lib/, components/ui/, supabase/,
package.json, scripts/, other route groups). Carl passes each one to the main session,
and signs off any schema change. Tracks build around them and don't hack around them.
Done items stay listed, marked with the PR that did them.

## Track A — site and booking

### A-1. Public sign-up for customers and cleaners (raised in Track A item 2). **Done in #19** (`/signup`, with `?next=`).

**What.** A sign-up page in `app/(auth)/` (e.g. `/join`), email + password via Supabase Auth,
with a confirm-email step. Every new account is a customer (the existing
`private.handle_new_user()` trigger already hard-codes `'customer'`, which is right: the browser
never picks a role). A `?next=/work` sign-up lands cleaners on `/work`, where Track B's
application flow calls `apply_as_cleaner()`.

**Why.** Today the only way in is `/login`, and the login page says "call the Ping office"
for a new account. The recruitment page (`/clean-for-ping`) can only offer "Sign in to apply",
and checkout (item 4) needs a way to create a customer account mid-booking.

**Proposed shape.**
- `app/(auth)/join/page.tsx` + `actions.ts`: server action `signUp(formData)`, zod-validated
  `{ email, password (min 10), fullName, next?: safe relative path }`, calling
  `supabase.auth.signUp({ email, password, options: { data: { full_name }, emailRedirectTo } })`.
- No schema change needed.
- Redirect after confirm: `postLoginPath(role, next)` from `lib/auth/roles.ts`, honouring `?next=`.
- Link to it from the login page's "need an account?" line.

Until this lands, the site links to `/login?next=/work` and says applications open alongside booking.

### A-2. A named customer-price helper in lib/money (raised in Track A item 3)

**What.** `export function customerPricePence(pricePerHourPence: number, durationMinutes: number): number`
in `lib/money/split.ts`, re-exported from `lib/money`, returning exactly
`splitVisitPrice(...).pricePence` (half-up to the penny), with the fixture test extended.

**Why.** The instant price needs the customer price only, and the public site never sees the
commission. Today `app/(site)/_lib/quote.ts` calls `splitVisitPrice` with a zero commission and
reads `pricePence`. That's correct (the price doesn't depend on commission, and a unit test checks
it against every shared fixture case), but a named helper says what it means and stops anyone
copying the zero-commission trick into money code.

**After it lands.** `quotePence` becomes a one-line call to it. No behaviour change.

### A-3. `public.book_series(...)`: one atomic booking function. **Done in #11** (with blocks of 1–8); checkout uses it.

**What.** A `security definer` function the signed-in customer calls to turn a property into a
regular clean. Series inserts are revoked from `authenticated`, so checkout can't work without it.

```sql
public.book_series(
  p_property        uuid,                     -- must belong to auth.uid()
  p_frequency       public.series_frequency,
  p_preferred_day   smallint,                 -- ISO, Mon = 1
  p_window_start    time,
  p_window_end      time,
  p_duration_minutes integer,
  p_starts_on       date,
  p_request_id      uuid                      -- idempotency: same id → same series back
) returns uuid                                -- the series id
```

Rules inside, all from `public.settings` (never from the browser):
- `private.settings_ready()` or raise. Property's `postcode_district = any(launch_districts)` or raise.
- `p_duration_minutes >= min_booking_minutes`, a multiple of 30, at most 600.
- `p_starts_on` after today in Europe/London (lead time could become a setting later).
- Snapshot `price_per_hour_pence`, `commission_type` and `commission_value` onto the series,
  `status = 'offering'`, so `release_offers()` picks it up on its next tick.
- Idempotent on `p_request_id` (a double-tapped "Book" returns the first series, never two).
  **Needs a schema change**: `series.client_request_id uuid unique` (Carl signs off).
- Audit row as for other series writes. `revoke all from public, anon; grant execute to authenticated`.
- RLS tests: customer books own property; can't book someone else's; anon can't call; out-of-area
  and below-minimum raise; settings not ready raises; same request id returns same series.

### A-4. Stripe SetupIntent plumbing, test mode (for Track A item 4, checkout)

**What.**
1. Dependencies: `stripe` (server), `@stripe/stripe-js` and `@stripe/react-stripe-js` (Payment Element).
2. `lib/stripe/server.ts` (server-only): a Stripe client that **refuses to start with a key that
   isn't `sk_test_`**; `ensureStripeCustomer(profileId)` and
   `createSetupIntent({ seriesId, customerId }) → { clientSecret }` with idempotency key
   `series:<id>:setup`, `usage: "off_session"` and `metadata.series_id`.
3. `app/api/stripe/webhook/route.ts`: verifies the signature, and on `setup_intent.succeeded`
   upserts `series_billing (series_id, stripe_customer_id, stripe_payment_method_id)` with the
   service-role client. The webhook is the source of truth, never the browser's redirect.
4. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
   (all `_test_`), added to `.env.example` and `lib/env.ts`.
5. Where a customer's Stripe customer id lives across series is the main session's call: today
   `series_billing` holds it per series, so a second booking would create a second Stripe customer.

**Why.** ping-money-rules 4, 6, 7 and 8: card saved at booking with a SetupIntent, idempotent,
webhook-verified, test mode only. All of it is shared code or outside Track A's folders.

### A-5. Checkout in the e2e suite (raised in Track A item 4)

Part 1 (RPC arguments by name, scalar unwrapping, inserts with `returning`) is in the fake
already, via Track B's B3 (#17). Part 2, the checkout journey, is still open.

**What.** Two changes in `tests/e2e/`:
1. `fake-supabase.mjs`: pass RPC arguments by name (`select * from public.fn(p_x => $1, …)`,
   unwrapping a scalar result as PostgREST does) and support `POST /rest/v1/<table>` inserts
   with `returning`, so `book_series` and the property insert run through it.
2. A checkout journey in `roles.e2e.mjs`: Anna books a new home from the instant price, signs in,
   lands back on checkout, double-taps confirm, gets exactly one series in `offering` with the
   settings price, and sees it in `/account`; with prices unset, checkout shows "Booking opens soon".

**Why.** Track A can't edit `tests/`. The PR for item 4 ran exactly this against real Postgres
with a local copy of the fake (24 checks); it belongs in CI so it can't regress.

### A-6. Optional: create the home inside `book_series` (raised in Track A item 4)

**What.** Either a `book_new_home(...)` wrapper or extra optional address arguments on
`book_series`, so a new home and its block are made in one transaction.

**Why.** Today checkout inserts the property, then books. If booking is refused after the insert
(rare: checkout pre-checks area, minimum and window first), the address stays on the account.
It's reused if they try again, so it does no harm, but one transaction would be cleaner.

## Track B — cleaner app

### B1. A way for a brand-new person to apply (auth + lib/auth). **Done in #19** (same as A-1)
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

### B3. tests/e2e/fake-supabase.mjs grew (FYI, in #17)
Additive only: RPCs with named arguments (scalar, composite and set returns, as
PostgREST does), PATCH/POST with `Prefer: return=…`, Storage upload / sign / fetch by
signed URL (gated by the real `storage.objects` policies), and CORS for the browser.
Track A will likely need the same for checkout; worth merging this first.

### B4. `public.start_visit(p_visit uuid)`. **Done in #11**
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

### B5. `public.complete_visit(p_visit uuid)`. **Done in #11** (with "couldn't do" reasons)
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

### B7. Town for past cleans of a finished block (optional, small)
- **What:** after a block ends, RLS (correctly) stops the cleaner reading its property, so
  their calendar shows those past cleans as "Finished block" with no town.
- **Why:** cleaners look back ("did I do Whitehaven on the 12th?"), and earnings (item 6)
  will want the same label.
- **Proposed:** `public.my_cleans(p_from date, p_to date)`, security definer, returning for
  the caller's own visits: `visit_id, scheduled_date, window_start, window_end,
  duration_minutes, status, town, postcode_district, clean_number, block_size`. It returns
  **town and district only**, never the street, notes or code, for any block, held or not.

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
