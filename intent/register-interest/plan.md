# Plan: register interest before booking opens

Status: **signed off by Carl, 7 Nov 2026. The backend is built** (migration
`20261107100000_register_interest.sql`, `lib/interest/`). Track A builds the form.

Carl's choices:
1. Retention: **6 months** (`settings.interest_retention_months = 6`, set in the migration).
2. Contact: **email OR mobile**, the person's choice. Exactly one is stored.
3. **Tick required.** Only store when "Tell me when booking opens near me" is ticked.
   Unticked, nothing is stored. There is no count-only list.
4. Cleaners: later. The table has `kind` (only `'customer'` for now) so they fit without a new table.

## What it does
Someone outside the launch area, or before booking opens, leaves a postcode and an email
or a UK mobile number, and ticks "Tell me when booking opens near me". Ping uses the list
to decide where to launch next and to send that one message when it does.

No account, no password, no price. Regular domestic cleans only, as everywhere on Ping.

## Where it appears (Track A builds the form)
- The instant-price result when the postcode is outside `settings.launch_districts` (`source = 'instant_price'`).
- The holding page while `public_pricing().ready` is false (`source = 'holding_page'`).

## The table: `public.interest_signups`
| Column | Notes |
| --- | --- |
| `id` | uuid pk |
| `kind` | `'customer'` only for now (check list); room for `'cleaner'` later |
| `postcode` | normalised "CA14 3XX", same check as `properties.postcode` |
| `postcode_district` | generated, indexed: what the admin counts by |
| `email` | lower-cased, at most 254 characters |
| `phone` | a UK mobile as `+447…` |
| `consent_text_version` | which consent wording they saw |
| `source` | `'instant_price'` or `'holding_page'` |
| `created_at`, `registered_at` | first sign-up; latest (re-)registration |
| `notified_at` | set by an admin after the "booking is open" message |
| `unsubscribed_at` | from the link in that message (built with the message) |
| `delete_after` | `registered_at + interest_retention_months` |

Exactly one of email or phone (check). Postcodes must use a real UK postcode area; emails
must be plain printable ASCII. Unique per `(kind, email, district)` and
`(kind, phone, district)`: registering again for the same area updates the row (fresh
consent and a fresh retention date) instead of adding one. It never clears "told", and an
unsubscribed contact stays unsubscribed: the reply is still "thanks" and nothing changes.

## Access
- RLS on, in the same migration, with **no table grants at all**: nobody (admins included)
  reads or writes the table directly. Every way in is a function.
- **Writes only through `public.register_interest(p_postcode, p_email, p_phone, p_notify,
  p_source, p_consent_version)`**, security definer, granted to the **service role only**.
  The Server Action calls it through `lib/db/admin.ts` after the honeypot and Turnstile,
  and sets the source and consent version itself; the database sets the kind. It
  normalises and checks everything, stores nothing unless `p_notify` is true, and
  **always returns `'thanks'`** for new, existing, unsubscribed and unticked alike.
  Errors only for input the person can fix: PC030 postcode, PC031 contact, PC032 not open
  (retention unset), PC033 bad source or version.
- `public.interest_retention_months()`: anyone, for the consent wording.
- Admin functions, each refusing non-admins and each leaving an audit line without contacts:
  `admin_interest_counts()` (per district), `admin_list_interest(p_district)` (contacts
  masked), `admin_export_interest(p_district)` (the contacts, never anyone unsubscribed),
  `admin_mark_interest_notified(p_ids, p_notified)` (told, or undo) and
  `admin_delete_interest(p_ids)`.
- CSV export: `lib/interest/csv.ts` quotes every cell and defuses values starting with
  `= + - @`, tab or CR, so nothing runs as a spreadsheet formula.

## Retention
- `private.purge_interest()` runs nightly on pg_cron (03:40). It deletes rows past
  `delete_after`, rows older than the *current* `interest_retention_months` (so lowering it
  takes effect), and rows unsubscribed more than 30 days ago (Kate to confirm the 30). It
  writes one audit row with the count; the per-row audit trigger steps aside for it.
- Open for Carl and Kate: delete rows about 30 days after the "booking is open" message
  has gone out?
- With `interest_retention_months` cleared, `register_interest` refuses (PC032).

## Consent wording (draft for Carl and Kate)
Under the form, not hidden in a link (`interestConsentText(months)` in `lib/interest/form.ts`):

> We'll use this to send you one message when booking opens near you, and to help us
> decide where to open next. We delete it after 6 months, or sooner if you ask us. We
> never share or sell it.

Open for Kate: whether to double-opt-in (confirm the email or mobile) before the one
message is sent.

Plus a link to the privacy notice. The tick box, unticked by default and required:

> Tell me when booking opens near me.

## Spam and abuse
- **Honeypot** (`company`), as on sign-up: filled in → "thanks", nothing stored.
- **Turnstile**, optional: on only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and
  `TURNSTILE_SECRET_KEY` are both set (a warning is logged if only one is). Checked in the
  Server Action before the database, including that the token was solved on Ping's own
  hostname. No IP address is sent to Cloudflare or stored.
- **Rate limit: a Vercel firewall rule**, not stored IPs. Recommended: at most 5 POSTs per
  IP per 10 minutes to the pages with the form.
- Same reply every time; no free text or links accepted; only Ping's own message is ever sent.

## Tests
`tests/db/interest.test.ts`, per role (anon, both customers, all three cleaners, admin):
anyone can register and nobody but admin can read or change anything; unticked stores
nothing; duplicates update; every bad input refused; refused while retention is unset;
admin counts, marking, deletion and export, all audited without contacts; the purge
deletes exactly the expired rows. `lib/interest/interest.test.ts` covers the form checks,
Turnstile and the Server Action.

## Later
- The "booking is open" message itself, with an unsubscribe link (sets `unsubscribed_at`).
- The admin console page (Track C): counts, export CSV, mark as notified.
- Cleaners (`kind = 'cleaner'`).
