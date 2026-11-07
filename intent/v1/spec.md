# Spec: Ping Clean V1 (summary)

Full founding spec: https://claude.ai/artifact/1WEp7QQgrj5dGn1wzooEWz — that doc wins
if anything here disagrees.

## Roles
| Role | Surface | V1 abilities |
| --- | --- | --- |
| Customer | /account | Price, book, saved card, upcoming visits, skip/cancel, rate, message cleaner, receipts |
| Cleaner | /work | Apply + documents, areas + availability, job board, claim a series, today's jobs, checklist + photos, earnings |
| Admin | /admin | Approve cleaners, prices/commission, unclaimed alerts, manual assign, QC queue, refunds, tiers, reports |

Cleaner tiers: New, Approved, Top. Tiers move on QC score, rating and reliability.

## Core flow
Book a block of 1–8 cleans (card saved) → series created → offered to Top tier → then
Approved → then all → claimed as a whole block (or admin alerted and assigns) → visits
generated, never more than the block → clean with checklist + photos → marked complete →
card charged → customer rating + admin QC → payout after dispute window → block ends after
its last clean → customer books again: the cleaner who did the last block gets first refusal,
then it goes to the hub as normal.

## Business rules
- **Blocks, not open-ended recurring** (Carl, 7 Nov 2026). Every booking is a block of 1 to 8
  cleans, chosen by the customer; 8 is the maximum. Ping is an agency, not a permanent job:
  neither customers nor self-employed cleaners should feel trapped. A cleaner claims the
  whole block, first come first served through the tiered offers. If a block is claimed
  late or goes back on the board, it slips forward rather than losing cleans.
- **Rebooking**: the next block at the same home is offered first to the cleaner who did the
  previous one, for a window set in settings (starts unset = off, straight to the hub). Only
  if that cleaner is still active, covers the area and works that day.
- **The visit day**: only the cleaner holding the job, only on the day, times stamped by the
  server. Every checklist item is ticked or marked "couldn't do" with a reason; at least one
  before and one after photo. "Couldn't do" items show to the customer on that visit and
  flag the visit for the admin QC queue.
- Fixed price per hour set by Ping, with a minimum booking. Cleaners can't change it.
- Each visit stores price, cleaner earnings and Ping fee separately (integer pence).
- Charge only after completion. Payout only after the dispute window.
- Late customer cancellation charges a fee, part goes to the cleaner.
- Cleaner drop-out: notice, series back on the board, tier impact. No-show: admin alert,
  customer offered replacement or refund.
- Cleaners are self-employed: Ping never sets hours or forces work.
- Live payments stay off until Kate signs off agent model, VAT and cleaner terms.

## Data model
profiles, properties, cleaners, cleaner_documents, series, visits, job_offers,
checklist_templates, checklist_items, visit_photos, reviews, payments, payouts,
messages, settings. RLS on every table: customers see their own, cleaners see offers
and claimed work, admins see all.

- series: `block_size` (1–8), `ends_on` (the block's last clean, kept up to date),
  `client_request_id` (booking idempotency), `rebook_of` (the previous block),
  `first_refusal_cleaner_id`; `offering_since` = when the hub opens.
- job_offers: `first_refusal`. settings: `rebook_first_refusal_minutes`.
- checklist_items: `skipped_reason` + `skipped_at` ("couldn't do"). visits: `couldnt_do_count`.
- Functions: `book_series`, `start_visit`, `complete_visit` (see intent/blocks/plan.md).

## Stack
Next.js on Vercel, Supabase (Postgres, Auth, Storage, cron, edge functions),
Stripe + Connect Express, web push + SMS, postcodes.io.

## Open questions (must be answered before Phase 2)
Price per hour and minimum hours; commission model; tier windows; cancellation notice
and fee; drop-out penalties; who supplies products; launch postcodes; first customers
to move; domain and logo; Kate sign-off date.
