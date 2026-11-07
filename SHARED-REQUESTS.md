# Shared requests

Changes Track A needs in code it doesn't own (lib/, components/ui/, supabase/, package.json,
other route groups). Carl passes each one to the main session. Track A builds around them
and does not hack around them.

## A-1. Public sign-up for customers and cleaners (raised in Track A item 2)

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

## A-2. A named customer-price helper in lib/money (raised in Track A item 3)

**What.** `export function customerPricePence(pricePerHourPence: number, durationMinutes: number): number`
in `lib/money/split.ts`, re-exported from `lib/money`, returning exactly
`splitVisitPrice(...).pricePence` (half-up to the penny), with the fixture test extended.

**Why.** The instant price needs the customer price only, and the public site never sees the
commission. Today `app/(site)/_lib/quote.ts` calls `splitVisitPrice` with a zero commission and
reads `pricePence`. That's correct (the price doesn't depend on commission, and a unit test checks
it against every shared fixture case), but a named helper says what it means and stops anyone
copying the zero-commission trick into money code.

**After it lands.** `quotePence` becomes a one-line call to it. No behaviour change.

## A-3. `public.book_series(...)`: one atomic booking function (for Track A item 4, checkout)

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

## A-4. Stripe SetupIntent plumbing, test mode (for Track A item 4, checkout)

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

**Why.** ping-money-rules 4, 6, 7 and 8: card saved at booking with a SetupIntent, idempotent,
webhook-verified, test mode only. All of it is shared code or outside Track A's folders.
