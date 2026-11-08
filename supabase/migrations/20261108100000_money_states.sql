-- Ping Clean: payments PR 2a, the extra payment and payout states (payments plan, signed off
-- by Carl 8 Nov 2026; intent/payments/plan.md appendix C).
-- On their own, before anything uses them: Postgres can't use a new enum value in the same
-- transaction that adds it.
--
-- payment_status: pending → processing → succeeded | requires_action | failed
--                 failed → processing (retry) … → failed_final
--                 succeeded → partially_refunded | refunded | disputed → succeeded | dispute_lost
-- payout_status:  pending (waiting for the dispute window) → in_batch → paid | failed
--                 pending → held (refund, dispute, admin) → pending | cancelled
alter type public.payment_status add value if not exists 'processing';
alter type public.payment_status add value if not exists 'requires_action';
alter type public.payment_status add value if not exists 'failed_final';
alter type public.payment_status add value if not exists 'disputed';
alter type public.payment_status add value if not exists 'dispute_lost';
alter type public.payout_status add value if not exists 'in_batch';
alter type public.payout_status add value if not exists 'held';
