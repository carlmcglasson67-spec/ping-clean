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
Book (card saved) → series created → offered to Top tier → then Approved → then all →
claimed (or admin alerted and assigns) → visits generated → clean with checklist + photos →
marked complete → card charged → customer rating + admin QC → payout after dispute window.

## Business rules
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

## Stack
Next.js on Vercel, Supabase (Postgres, Auth, Storage, cron, edge functions),
Stripe + Connect Express, web push + SMS, postcodes.io.

## Open questions (must be answered before Phase 2)
Price per hour and minimum hours; commission model; tier windows; cancellation notice
and fee; drop-out penalties; who supplies products; launch postcodes; first customers
to move; domain and logo; Kate sign-off date.
