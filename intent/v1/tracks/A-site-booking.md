# Track A — Website + booking + customer app

Worktree: site-booking · Branch: track/site-booking

## You own
app/(site)/, app/(account)/, public/ (site images only)

## You never edit
lib/, components/ui/, supabase/, package.json, other route groups.
Need a shared change? Write it in SHARED-REQUESTS.md at the repo root of your worktree
and stop that piece of work. Carl passes it to the main session.

## Build (in this order, one PR each)
1. Marketing home to the Lakeland benchmark (pervonio-premium-design skill).
2. Area pages for launch postcodes, recruitment page, FAQ.
3. Instant price: postcode + hours → price from settings table.
4. Checkout: create property + series, save card (Stripe SetupIntent, test mode).
   The customer picks a **block of 1 to 8 cleans** (Carl, 7 Nov 2026: no open-ended
   regular cleans; 8 is the maximum). Book through `book_series(...)` with a request id made
   once per checkout (validate with `bookSeriesInput` in `lib/booking.ts`; word errors with
   `pingErrorMessage()` from `lib/db/errors.ts`). A customer booking again at the same home
   is a rebook: the database gives their last cleaner first refusal on its own.
5. Customer account: upcoming visits, skip/cancel, rate, messages, receipts. PWA manifest.

## Done when
A test customer books end to end on the preview URL and sees the series in /account.

## Before each PR
design-reviewer → security-reviewer → verifier. Paste their reports in the PR.
