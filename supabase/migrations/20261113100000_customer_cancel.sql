-- Ping Clean: a customer cancels a clean, or the rest of their block (intent/cancel/plan.md).
--
--   my_cancel_terms(visit)   the customer: what cancelling this clean would mean
--   cancel_my_visit(visit)   the customer: cancel one scheduled clean of their own
--   cancel_my_block(series)  the customer: cancel every clean still to come and end the block
--
-- Carl's rules (settings): cancel_notice_hours of notice is free. Less is late, but only if a
-- cleaner has the clean. late_cancel_fee_pence is the late fee; while it is empty that rule
-- doesn't run and a late cancellation costs nothing. A fee, when set, is RECORDED on the
-- clean (visits.late_cancel_fee_pence) and the team is told; charging it is not built yet.
-- Nothing here touches a payment.

-- ---------------------------------------------------------------- an alert for the office
-- cancelled_late: the cleaner has less than the notice period to hear about it.
alter table public.engine_alerts drop constraint engine_alerts_kind_check;
alter table public.engine_alerts add constraint engine_alerts_kind_check
  check (kind in ('release_failed', 'generate_failed', 'visit_needs_cover', 'visit_no_show', 'visit_unfinished',
                  'block_overlap', 'block_stalled', 'block_closed',
                  'charge_held', 'charge_blocked', 'payment_needs_customer', 'payment_failed',
                  'payout_failed', 'payout_stuck',
                  'refund_failed', 'refund_after_payout', 'payment_disputed',
                  'cancelled_late'));
create unique index engine_alerts_one_open_late_cancel on public.engine_alerts (visit_id, kind)
  where kind = 'cancelled_late' and resolved_at is null;

-- ---------------------------------------------------------------- the rule, in one place
-- When the clean's arrival window opens, in real time (the window is London time).
create function private.visit_starts_at(p_date date, p_window_start time) returns timestamptz
language sql immutable set search_path = '' as $$
  select (p_date + p_window_start) at time zone 'Europe/London'
$$;

-- late: a cleaner has it, a notice period is set, and there's less than that left.
-- fee:  Carl's late fee when it's late and a fee is set; otherwise null (no fee applies).
create function private.cancel_terms(p_visit uuid, out late boolean, out notice_hours integer, out fee_pence integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.visits;
  fee integer;
begin
  select * into v from public.visits where id = p_visit;
  select cancel_notice_hours, late_cancel_fee_pence into notice_hours, fee from public.settings limit 1;
  late := v.cleaner_id is not null and notice_hours is not null
          and private.visit_starts_at(v.scheduled_date, v.window_start) - now() < notice_hours * interval '1 hour';
  fee_pence := case when late and fee > 0 then fee end;
end $$;

create function public.my_cancel_terms(p_visit uuid)
returns table (can_cancel boolean, late boolean, notice_hours integer, fee_pence integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  st public.visit_status;
begin
  select v.status into st from public.visits v where v.id = p_visit and v.customer_id = (select auth.uid());
  if not found then
    return;  -- not theirs: no row, and no hint that it exists
  end if;
  select t.late, t.notice_hours, t.fee_pence into late, notice_hours, fee_pence from private.cancel_terms(p_visit) t;
  can_cancel := st = 'scheduled';
  return next;
end $$;

-- Cancels one scheduled clean for its customer. The caller holds the series lock.
-- True when it was late.
create function private.cancel_visit_for_customer(p_visit uuid, p_customer uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  t record;
begin
  select * into t from private.cancel_terms(p_visit);
  update public.visits
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_customer,
         cancel_reason = case when t.late then 'customer_late' else 'customer' end,
         late_cancel_fee_pence = coalesce(t.fee_pence, 0)
   where id = p_visit and status = 'scheduled';
  if t.late then
    insert into public.engine_alerts (kind, series_id, visit_id, message)
    select 'cancelled_late', v.series_id, v.id,
           'The customer cancelled this clean with less than ' || t.notice_hours || ' hours'' notice. Ring the cleaner so they don''t turn up. '
           || case when t.fee_pence is not null
                   then 'A late fee of £' || to_char(t.fee_pence / 100.0, 'FM999990.00') || ' is due; it isn''t taken from the card automatically yet.'
                   else 'No late fee is set, so nothing is charged.' end
      from public.visits v where v.id = p_visit
    on conflict (visit_id, kind) where kind = 'cancelled_late' and resolved_at is null do nothing;
  end if;
  return t.late;
end $$;

-- PC060 not their clean · PC061 can't be cancelled any more (under way, done, or already off)
create function public.cancel_my_visit(p_visit uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  sid uuid;
  v public.visits;
  was_late boolean;
begin
  if me is null then
    raise exception 'Sign in to cancel a clean' using errcode = '42501';
  end if;
  select series_id into sid from public.visits where id = p_visit and customer_id = me;
  if not found then
    raise exception 'That clean isn''t yours' using errcode = 'PC060';
  end if;
  -- Lock order: series, then visit (as everywhere else).
  perform 1 from public.series where id = sid for update;
  select * into v from public.visits where id = p_visit for update;
  if v.status = 'cancelled' and v.cancel_reason in ('customer', 'customer_late') and v.cancelled_by = me then
    return case v.cancel_reason when 'customer_late' then 'cancelled_late' else 'cancelled' end;  -- pressed twice
  end if;
  if v.status <> 'scheduled' then
    raise exception 'That clean can''t be cancelled now' using errcode = 'PC061';
  end if;
  was_late := private.cancel_visit_for_customer(v.id, me);
  perform private.end_block_if_done(sid);  -- it may have been the last clean of the block
  return case when was_late then 'cancelled_late' else 'cancelled' end;
end $$;

-- Cancels every clean still to come and ends the block. A clean under way is left to finish
-- (and is charged as normal). Returns how many cleans were cancelled, and how many were late.
create function public.cancel_my_block(p_series uuid, out cancelled integer, out late integer)
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  s public.series;
  v_id uuid;
begin
  cancelled := 0; late := 0;
  if me is null then
    raise exception 'Sign in to cancel your cleans' using errcode = '42501';
  end if;
  select * into s from public.series where id = p_series and customer_id = me for update;
  if not found then
    raise exception 'That booking isn''t yours' using errcode = 'PC060';
  end if;
  if s.status = 'ended' then
    return;  -- already over: nothing to do
  end if;
  for v_id in
    select v.id from public.visits v where v.series_id = s.id and v.status = 'scheduled' order by v.scheduled_date for update
  loop
    if private.cancel_visit_for_customer(v_id, me) then late := late + 1; end if;
    cancelled := cancelled + 1;
  end loop;
  update public.job_offers set status = 'withdrawn', responded_at = now()
   where series_id = s.id and status in ('open', 'pending');
  update public.series set status = 'ended', offering_since = null, end_reason = 'Cancelled by the customer' where id = s.id;
end $$;

revoke all on function private.visit_starts_at(date, time), private.cancel_terms(uuid),
  private.cancel_visit_for_customer(uuid, uuid) from public, anon, authenticated;
revoke all on function public.my_cancel_terms(uuid), public.cancel_my_visit(uuid), public.cancel_my_block(uuid)
  from public, anon;
grant execute on function public.my_cancel_terms(uuid), public.cancel_my_visit(uuid), public.cancel_my_block(uuid) to authenticated;
