# Nobody can sign up with someone else's address first (#60)

## The hole

Supabase keeps the FIRST password given for an address that hasn't been confirmed. A
stranger signs up with a customer's address; the customer later signs up and confirms from
their own inbox; the account still opens with the stranger's password, and the confirm link
signs the real person in, so they never notice. Address, access notes and key code exposed.

## The fix

Nobody chooses a password at sign-up any more.

1. **Sign-up** (`app/(auth)/signup/actions.ts`) asks for name, email, phone and consent.
   The account is created with a long random password that is never shown or kept, and
   `password_pending: true` in its metadata.
2. **The email link** (`app/(auth)/auth/confirm/actions.ts`): once it verifies and the
   account is still `password_pending`, this session gets the same signed 15-minute pass a
   reset link gives (`lib/auth/recovery.ts`).
3. **/auth/confirmed** still names the account ("Not you? Sign out"), then its button is
   **Choose my password**.
4. **/reset-password?first=1** words it as a first password. The pass is the guard, not
   `?first`. Saving clears `password_pending` and carries on to where they were going
   (`next`, checked again by `postLoginPath`).

A stranger who signs up first learns nothing: there is no password to know. Whoever proves
the address by opening the link chooses the password.

## Edge cases

- **Link opened, password never chosen:** the account is confirmed but no one knows its
  password. "Forgotten your password?" sets one, as for anyone.
- **The 15 minutes run out on the password page:** it says so and offers a new link (forgot
  password).
- **Email confirmation switched off** (local development only): sign-up signs straight in
  as before. Live must keep confirmation on (go-live list, step 5).
- **RESET_PASS_SECRET missing in production:** no pass is given, so new accounts can't
  choose a password, the same as resets today. Already required at go-live and checked when
  the server starts.

## Tests

End to end:

- The sign-up form has no password field.
- Sign-up → confirm → choose → in. A weak first password is refused in plain words.
- The pass works once.
- `password_pending` is cleared, and sign-in works with the chosen password.
- **The attack replayed.** A stranger signs up first, and none of the likely passwords get
  in. The owner then signs up, confirms and chooses a password, and that password opens the
  account.
- The cleaner journey from `/work/apply` still lands back on the application.

No schema change.
