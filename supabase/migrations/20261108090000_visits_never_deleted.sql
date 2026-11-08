-- Ping Clean: never lose a visit that money depends on (issue #12 note 1; payments plan,
-- PR 1; signed off by Carl with the payments plan, 8 Nov 2026).
--
--   * Ending a block (private.close_block, used by admin_end_block and by the engine) now
--     marks the block's future cleans CANCELLED, stamped with when and by whom, instead of
--     deleting them. The visit history stays whole for payments, payouts and receipts.
--   * Payments and payouts reference their visit with ON DELETE RESTRICT.
--   * A trigger refuses to delete any visit that has a payment or payout row (PC016), with a
--     plain message, whoever tries.
--
-- private.reopen_series (a cleaner drops out) still removes the block's future BOOKED cleans
-- so whoever claims it next can be booked on the same dates. Those visits are 'scheduled'
-- and in the future, so they can't have money rows yet (charging happens on completion); if
-- one ever did, the trigger below stops the reopen rather than losing it.

-- ---------------------------------------------------------------- ending a block
-- Same as before, except future booked cleans are cancelled, not deleted.
create or replace function private.close_block(p_series uuid, p_admin uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.series;
begin
  select * into s from public.series where id = p_series for update;
  update public.job_offers set status = 'withdrawn', responded_at = now()
  where series_id = s.id and status in ('open', 'pending');
  update public.visits
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_admin
   where series_id = s.id and status = 'scheduled' and scheduled_date >= private.london_today();
  update public.series set status = 'ended', offering_since = null, end_reason = left(p_reason, 300) where id = s.id;
  if p_admin is null then
    insert into public.engine_alerts (kind, series_id, message) values ('block_closed', s.id, left(p_reason, 500));
  else
    -- The admin has dealt with it: their open block alerts are settled.
    update public.engine_alerts set resolved_at = now(), resolved_by = p_admin
    where series_id = s.id and resolved_at is null and kind in ('block_overlap', 'block_stalled', 'block_closed');
  end if;
end $$;
revoke all on function private.close_block(uuid, uuid, text) from public;

-- ---------------------------------------------------------------- money rows hold their visit
alter table public.payments drop constraint payments_visit_id_fkey,
  add constraint payments_visit_id_fkey foreign key (visit_id) references public.visits (id) on delete restrict;
alter table public.payouts drop constraint payouts_visit_id_fkey,
  add constraint payouts_visit_id_fkey foreign key (visit_id) references public.visits (id) on delete restrict;

-- A clear refusal (PC016) before the foreign key's generic one, for anyone who tries.
create function private.refuse_visit_delete_with_money() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.payments where visit_id = old.id)
     or exists (select 1 from public.payouts where visit_id = old.id) then
    raise exception 'That clean has payment records, so it can''t be removed. Cancel it instead.'
      using errcode = 'PC016';
  end if;
  return old;
end $$;
revoke all on function private.refuse_visit_delete_with_money() from public;

create trigger visits_keep_money_history before delete on public.visits
  for each row execute function private.refuse_visit_delete_with_money();
