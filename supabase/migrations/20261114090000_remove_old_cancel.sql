-- Removes the first, unfinished version of customer cancelling (PR #48), which was merged
-- after its replacement (#49 and #53) was already live. That version let a customer cancel
-- at short notice with the fee only written down, never charged. Its page and functions are
-- gone from the app; this makes sure they are gone from any database it reached.
-- On a database that never ran it, every line here does nothing.

drop function if exists public.cancel_my_block(uuid);
drop function if exists public.cancel_my_visit(uuid);
drop function if exists public.my_cancel_terms(uuid);
drop function if exists private.cancel_visit_for_customer(uuid, uuid);
drop function if exists private.cancel_terms(uuid);
drop function if exists private.visit_starts_at(date, time);
drop index if exists public.engine_alerts_one_open_late_cancel;

-- Its alert kind goes back to the live one, and the allowed kinds are put back as #49 set them.
alter table public.engine_alerts drop constraint engine_alerts_kind_check;
update public.engine_alerts set kind = 'visit_cancelled_late' where kind = 'cancelled_late';
alter table public.engine_alerts add constraint engine_alerts_kind_check
  check (kind in ('release_failed', 'generate_failed', 'visit_needs_cover', 'visit_no_show', 'visit_unfinished',
                  'block_overlap', 'block_stalled', 'block_closed',
                  'charge_held', 'charge_blocked', 'payment_needs_customer', 'payment_failed',
                  'payout_failed', 'payout_stuck',
                  'refund_failed', 'refund_after_payout', 'payment_disputed',
                  'visit_cancelled_late'));
