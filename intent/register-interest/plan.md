# Plan: register interest before booking opens

Status: **plan only. Needs Carl's sign-off** (a new table is a schema change). No code yet.

## What it does
Someone outside the launch area, or before booking opens, leaves a postcode and an email
or a mobile number. They can tick "Tell me when booking opens near me". Ping uses the list
to decide where to launch next and to send that one message when it does.

No account, no password, no price. Regular domestic cleans only, as everywhere on Ping.

## Where it appears (Track A builds the form; the main session builds the table and function)
- The instant-price result when the postcode is outside `settings.launch_districts`.
- The holding page while `public_pricing().ready` is false.
- Optionally a cleaner version later ("tell me when you need cleaners in CA25"): same table,
  `kind = 'cleaner'`, so leave room for it but don't build it in V1.

## The table: `public.interest_signups`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `postcode` | text not null | normalised like `properties.postcode` ("CA14 3XX"), same check |
| `postcode_district` | text generated | `split_part(postcode, ' ', 1)`, indexed: what the admin counts by |
| `email` | text | lower-cased, `<= 254`; one of email or phone required (check) |
| `phone` | text | same format check as `profiles.phone` |
| `notify` | boolean not null default false | the "tell me when booking opens" tick |
| `consent_text_version` | text not null | which consent wording they saw (below) |
| `source` | text not null | `'instant_price' \| 'holding_page'` (check list) |
| `created_at` | timestamptz not null default now() | |
| `notified_at` | timestamptz | set when the "booking is open" message goes out |
| `unsubscribed_at` | timestamptz | from the link in that message |
| `delete_after` | timestamptz not null | `created_at + retention` (below), set by the function |

Constraints: `check (email is not null or phone is not null)`. Unique on
`(lower(email), postcode_district)` and `(phone, postcode_district)` where not null, so the
same person registering twice for the same area updates their row instead of adding one.

## RLS and access
- `enable row level security` in the same migration, as always.
- **No direct access for anon or authenticated** (`revoke all`). People never read the list,
  not even their own row: there is no account to prove it's theirs.
- Writes only through `public.register_interest(p_postcode, p_email, p_phone, p_notify,
  p_source, p_consent_version, p_captcha_token)`, `security definer`, granted to `anon` and
  `authenticated`. It validates and normalises everything (zod on the server first, then
  checks in SQL), upserts on the unique keys, and **always returns the same thing** ("thanks")
  whether the person was new or already on the list, so it can't be used to test addresses.
- Admins read through RLS (`private.is_admin()`) for the console list and the export.
- Audit: admin exports and deletions write an `audit_log` row (who, when, how many rows),
  never the addresses themselves (ping-data-security rules 5 and 7).

## Retention (number left for Carl)
- Each row gets `delete_after = created_at + interval 'N months'`. **N is Carl's to set.**
  Store it as `settings.interest_retention_months` (null until set; the function refuses to
  run while it's null, like booking does with prices).
- A nightly job (`private.purge_interest()`, on the existing pg_cron schedule) deletes rows
  past `delete_after`, and rows unsubscribed more than 30 days ago (check the 30 with Kate).
- Once someone is sent the "booking is open" message they either book (then they're a
  customer with an account) or the row runs out on the normal schedule.

## Consent wording (draft for Carl and Kate)
Under the form, not hidden in a link:

> We'll use this only to tell you about Ping in your area. If you tick the box, we'll send
> you one message when booking opens near you. You can ask us to delete it at any time, and
> we delete it anyway after [N] months. See our [privacy notice](/privacy).

The checkbox, unticked by default:

> Tell me when booking opens near me.

Without the tick we keep the postcode and contact only to count demand by area; no
message is sent. (Kate to confirm this is enough for UK GDPR and PECR. If not, drop the
"count only" option and require the tick to store contact details at all.)

## Admin export
- Admin console page (Track C): counts by postcode district, newest first, with
  "notify" counts, so Carl can see where demand is.
- "Export CSV" for one district or all: postcode, email, phone, notify, created_at. Only rows
  with `notify = true` and not unsubscribed are included by default (a toggle includes the
  count-only rows without contact details). Every export writes an audit row.
- "Mark as notified" after sending, which stamps `notified_at` (so nobody is messaged twice).

## Spam and abuse protection
- **Turnstile (Cloudflare) on the form**, checked server-side inside `register_interest`'s
  caller (a Server Action) before the RPC. It's free and has no image puzzles. Needs a site key
  and secret key in the environment.
- **Honeypot field**, as on sign-up: bots that fill it get the normal "thanks" and nothing is stored.
- **Rate limit**: at most a few submissions per IP per hour. Postgres can't see the IP, so
  either the Server Action passes a hashed IP (stored as `ip_hash` with a short retention) or
  Vercel's firewall rate-limits the route. Recommend the Vercel rule, so no IP data is stored.
- **Same answer every time** (see RLS), so it can't be used to check who has registered.
- **No links or free text** accepted in any field; postcode and phone are format-checked.
- **Only Ping's own message** is ever sent to these contacts; the list is never shared or sold
  (say so in the privacy notice).

## Tests (when built)
Per role: anon and customers can call the function but read nothing; admins read and export;
duplicates update rather than add; refused while retention is unset; the purge job deletes
exactly the expired rows; the same reply for new and existing contacts.

## Open questions for Carl
1. Retention: how many months? (`settings.interest_retention_months`)
2. Email only, phone only, or either? (The plan allows either.)
3. Is "count only, no message" wanted, or tick-required? (Kate to advise.)
4. Should cleaners be able to register interest too (later)?
