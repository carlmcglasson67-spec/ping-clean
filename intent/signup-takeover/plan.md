# Nobody can sign up with someone else's address first (#60)

## The hole

Supabase keeps the FIRST password given for an address that hasn't been confirmed. A
stranger signs up with a customer's address; the customer later signs up and confirms from
their own inbox; the account still opens with the stranger's password, and the confirm link
signs the real person in, so they never notice. Address, access notes and key code exposed.

## The fix

Nobody chooses a password at sign-up any more.

1. **Sign-up** (`app/(auth)/signup/actions.ts`) asks only for a name and an email. The
   account is created with a long random password that is never shown or kept, and
   `password_pending: true` in its metadata.
2. **The email link** (`app/(auth)/auth/confirm/actions.ts`). Once a sign-up link verifies,
   the account's password is **replaced at once** with a new random one. This is decided by
   the link, not the metadata, so it also covers an account made by the old form, which
   could still hold a stranger's password. The session then gets the same signed 15-minute
   pass a reset link gives (`lib/auth/recovery.ts`). The phone number from the form is never
   copied.
3. **/auth/confirmed** still names the account ("Not you? Sign out"), then its button is
   **Choose my password**.
4. **/reset-password** shows the first-password form while the account is still
   `password_pending`, and the action decides this the same way. The form has the name
   (filled in from sign-up, for checking), the password, an optional mobile number, and the
   terms and privacy ticks. Consent is recorded here (`lib/auth/consent.ts`), from the person
   who proved the address. Supabase keeps the FIRST sign-up's details for an unconfirmed
   address, so the form's name and consent could belong to a stranger. Saving clears
   `password_pending`, writes the name and phone to the profile, and carries on to where they
   were going (`next`, checked again by `postLoginPath`).

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
- **An old-style account replayed.** The stranger's own password and phone number are set
  up directly in the database. The stranger's password stops working the moment the owner
  uses the link, and their phone number never reaches the owner's profile.
- **The attack replayed.** A stranger signs up first, and none of the likely passwords get
  in. The owner then signs up, confirms and chooses a password, and that password opens the
  account.
- The cleaner journey from `/work/apply` still lands back on the application.

No schema change.
