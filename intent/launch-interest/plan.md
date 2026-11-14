# Plan: the launch page (`/launch`) and launch interest from customers and cleaners

Status: **signed off by Carl, 14 Nov 2026** (in chat): build it in the repo as a PR, schema
change approved, no price on the page, a new page at `/launch` with the home page left alone.

## What it does
One public page that says what Ping Clean is, why it is different, and asks people to
register their interest **either as a customer or as someone who wants to clean with Ping**.
After the contact details it asks a few short, optional, tap-to-answer questions. The
answers tell Carl where to launch, what people care about and how many cleaners are ready.

Regular domestic cleans only. No price, no fee, no notice period anywhere on the page.
No AI people; the hero carries a product moment, not a photograph.

## Carl's earlier choices that still hold (7 Nov, `intent/register-interest/plan.md`)
- Email **or** UK mobile, the person's choice; exactly one is stored.
- The tick is required. Unticked, nothing is stored.
- Kept for `settings.interest_retention_months` (6), then purged. Opt-outs stay out.
- The reply is always the same "thanks".

## What changes (14 Nov)
- Cleaners can register now, not "later" (`kind = 'cleaner'`).
- A new source, `launch_page`.
- Two new columns on `public.interest_signups`:
  - `first_name` (optional, up to 60 characters): so the one message can say hello.
  - `answers` (jsonb, small, shape-checked): the tap answers plus one optional free-text note.

## Schema: `supabase/migrations/20261114190000_launch_interest.sql`
- `kind` check widened to `customer | cleaner`; `source` check gains `launch_page`.
- `first_name`, `answers` added with checks (`private.valid_interest_answers`).
- `public.register_launch_interest(kind, first_name, postcode, email, phone, notify,
  consent_version, answers)`: **service role only**, same rules as `register_interest`
  (retention set, opt-outs honoured, always "thanks"). `register_interest` is untouched.
- `admin_list_interest` and `admin_export_interest` are recreated with `kind` and the
  answers. The masked list never carries the first name or the free-text note; the export
  (already the full-contact, audited route) does.
- `admin_interest_answer_counts()`: tallies per question and answer, for "what people told
  us". Admin only, audited, no contacts.
- No new table, so no new RLS surface: the table stays closed to every role.

## Questions (all optional; option values are fixed keys, checked on the server and in the database)
Customer: how often · bedrooms · cleaner at the moment · what matters most (up to 3) ·
when they'd start · "what has let you down before?" (free text, 500 characters).

Cleaner: experience · what they do now · hours wanted · when they can work · do they drive ·
what matters most in the work (up to 3) · "what would make this the best cleaning work
you've had?" (free text, 500 characters).

## Files
| Path | Change |
| --- | --- |
| `supabase/migrations/20261114190000_launch_interest.sql` | the schema above |
| `lib/interest/launch.ts` | questions, wording, consent version, server-side parsing (zod) |
| `lib/interest/actions.ts` | `registerLaunchInterest` Server Action |
| `lib/interest/csv.ts` | export gains kind, first name, answers |
| `lib/db/types.ts` | regenerated |
| `app/(site)/launch/page.tsx`, `app/(site)/_components/launch-*.tsx` | the page and form |
| `app/(admin)/admin/interest/*` | kind badge, answers on each entry, "what people told us" |
| `tests/db/launch-interest.test.ts`, `lib/interest/launch.test.ts`, `tests/e2e/launch.e2e.mjs` | tests |

## Wording that needs Carl and Kate
`LAUNCH_CONSENT_VERSION = "launch-draft-2026-11"`: the consent wording under the form is a
draft, like the 7 Nov one.

## Done when
On the preview URL: `/launch` at 390px and 1440px passes the design-reviewer; a customer and
a cleaner can each register with answers; both appear in `/admin/interest` with their kind
and answers, and in the CSV; the security-reviewer and verifier pass.
