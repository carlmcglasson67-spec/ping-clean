# Plan: auth follow-ups from the reviews (issue #21)

Status: Carl said "fix all the issues on GitHub" (22 Nov 2026). Notes 1, 2, 3, 4 and 7 are
built here. Notes 5, 6 and 8 are decisions for Carl and his advisers and are **not** built.
One schema change (a trigger, no new table): Carl signs it off by merging.

## 1. Each email link says what it is (`/auth/confirm`)
Today an invite or email-change link says "You've just created a Ping account".
- The wording for each kind of link lives in one place, `app/(auth)/auth/confirm/wording.ts`
  (a pure function, unit tested): sign-up, reset, invite, email change.
- With Supabase's **Secure email change** on, changing an address sends two links, one to
  each address. The first one used gives no session (GoTrue answers "Confirmation link
  accepted. Please proceed to confirm link sent to the other email"). The confirm action
  spots that (`type=email_change` and no session) **before** it looks at who is signed in,
  and sends the person to `/auth/other-address`: "Now confirm the link sent to your other
  address". Nothing else happens on that half.
- The second link completes the change and lands on `/auth/confirmed?kind=email_change`,
  which says "Email address changed" and shows the new (masked) address.

## 2. `profiles.email` follows the login email
Migration `supabase/migrations/20261122093000_profile_email_sync.sql`:
- `private.sync_profile_email()`: security definer, `search_path = ''`, in the style of
  `private.handle_new_user()`. Copies `new.email` into `public.profiles.email`.
- Trigger `on_auth_user_email_changed` after update of `email` on `auth.users`, only when
  the address really changed. With Secure email change, auth.users.email only changes once
  both links are used, so the profile changes at the same moment.
- A one-off line brings any profile already out of step back in line.
- Execute revoked from public (a trigger function; nobody calls it directly).
- `profiles_audit_email`: an email change on a profile is written to the audit log, with
  the address redacted ("changed"), as the role trigger does.
- No new table, no grant change: people still can't edit `profiles.email` themselves.

## 3. Invited people choose a password
(Revised after the security review of the first version, and rebased on the sign-up fix #60.)
An invite link is handled exactly like a sign-up link: once it verifies (token-hash links
only), the password is replaced with an unguessable one, `password_pending` is set, and the
person goes through the same first-password step (name, password, phone, consent).
- Why: GoTrue re-sends an invite to an existing UNCONFIRMED account, which may hold a
  password a stranger chose before #60; and GoTrue verifies sign-up and invite links by the
  same token, so either type opens either link. Both now behave the same.
- "Invited" is read from the account (`invited_at`), never from the link type; it only
  changes the words (`/auth/confirmed?invited=1`, and the reset page from the account).
- A code (PKCE) link can't carry a type at all (`lib/auth/confirm-fields.ts`), so it can't
  pose as an invite or a reset.

## 4. Reset passes on previews (configuration only)
A line in `intent/go-live/plan.md` step 7: previews run with NODE_ENV=production, so
resets are off there unless `RESET_PASS_SECRET` is also set for Preview, with a different
value from Production.

## 7. CSV export warning
Next to the export button: "Import it straight into your SMS tool. Don't re-save it in
Excel." (A warning in the issue's wording was already there; the words are updated.)

## Not built (for Carl and his advisers)
- 5: `admin_delete_interest` suppresses permanently with no undo; a verified way to opt
  back in.
- 6: suppression hashes are unsalted SHA-256 (pseudonymous); privacy notice wording.
- 8: double opt-in, deleting rows ~30 days after the message, a server-only consents table.

## Files
- `app/(auth)/auth/confirm/wording.ts` (new), `page.tsx` (uses it), `actions.ts` (two
  small, separate additions: the half-done email change, and invites getting a pass).
  The main session is changing sign-up and parts of confirm for an account-takeover fix:
  `app/(auth)/signup/*` is not touched.
- `app/(auth)/auth/other-address/page.tsx` (new), `app/(auth)/auth/confirmed/page.tsx`
  (email-change wording), `app/(auth)/reset-password/page.tsx` (invite wording).
- `app/(admin)/admin/interest/page.tsx` (one line of copy).
- Tests: `app/(auth)/auth/confirm/wording.test.ts`, `tests/db/profile-email.test.ts`,
  `tests/e2e/auth-links.flows.mjs` (the fake Supabase learns invite and two-link email
  change, through test-only controls).
