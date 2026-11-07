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

Exactly one of email or phone (check). Unique per `(kind, email, district)` and
`(kind, phone, district)`: registering again for the same area updates the row (fresh
consent, a fresh retention date, back on the list) instead of adding one.

## Access
- RLS on, in the same migration. No direct access for anon or authenticated, not even to
  their own row: there is no account to prove it's theirs.
- **Writes only through `public.register_interest(p_postcode, p_email, p_phone, p_notify,
  p_source, p_consent_version)`**, security definer, granted to anon and authenticated.
  It normalises and checks everything, stores nothing unless `p_notify` is true, and
  **always returns `'thanks'`** for new, existing and unticked alike.
  Errors only for input the person can fix: PC030 postcode, PC031 contact, PC032 not open
  (retention unset), PC033 bad source or version.
- `public.interest_retention_months()`: anyone, for the consent wording.
- Admins: read the table; `admin_interest_counts()` per district; mark `notified_at`;
  delete on request. Marking and deleting write audit rows with the contacts redacted.
- `admin_export_interest(p_district)`: the contact list (never anyone unsubscribed), and an
  audit row with who, when, which district and how many rows.

## Retention
- `private.purge_interest()` runs nightly on pg_cron (03:40). It deletes rows past
  `delete_after` and rows unsubscribed more than 30 days ago (Kate to confirm the 30), and
  writes one audit row with the count.
- With `interest_retention_months` cleared, `register_interest` refuses (PC032).

## Consent wording (draft for Carl and Kate)
Under the form, not hidden in a link (`interestConsentText(months)` in `lib/interest/form.ts`):

> We'll use this only to send you one message when booking opens near you. We delete it
> after 6 months, or sooner if you ask us. We never share or sell it.

Plus a link to the privacy notice. The tick box, unticked by default and required:

> Tell me when booking opens near me.

## Spam and abuse
- **Honeypot** (`company`), as on sign-up: filled in → "thanks", nothing stored.
- **Turnstile**, optional: on only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and
  `TURNSTILE_SECRET_KEY` are both set. Checked in the Server Action before the database.
  No IP address is sent to Cloudflare or stored.
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
