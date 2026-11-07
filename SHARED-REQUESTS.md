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
