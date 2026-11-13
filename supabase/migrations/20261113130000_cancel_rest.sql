-- Cancel the rest of my cleans (the half of PR #48 that #49 didn't bring across).
-- A customer could cancel one clean at a time, but only the office could end a block.
-- TEST mode only. No new tables or columns.
--
--   cancel_block_quote(series)             the customer: what cancelling everything left would cost, now
--   cancel_block(series, total fee shown)  the customer: cancel it all and end the block
--
-- Each clean is cancelled exactly as public.cancel_visit would cancel it (same notice rule,
-- same fee, same split, same alert): both now go through private.cancel_one, so the two can't
-- drift apart. Then the block ends, so no more cleans are booked for it.
--
--   PC035 the total changed since the customer was shown it (nothing is cancelled)
--   PC054 not their booking, or it has already ended
--   PC055 a clean is under way or its time has started: cancel the rest once it's finished

-- ---------------------------------------------------------------- one clean
-- Cancels one clean for its customer. The caller has already checked it's theirs, locked it,
-- and that it can still be cancelled. Returns the fee (0 = none) and whether it was late.
create function private.cancel_one(p_visit uuid, p_customer uuid, out fee_pence integer, out late boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.visits;
  t record;
  pid uuid := gen_random_uuid();
begin
  select * into v from public.visits where id = p_visit;
  select * into t from private.late_cancel_terms(v.id);
  fee_pence := t.fee_pence; late := t.late;

  perform set_config('app.actor', 'customer:' || p_customer, true);
  update public.visits
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_customer,
         cancel_reason = case when t.late then 'customer_late' else 'customer' end,
         late_cancel_fee_pence = t.fee_pence
   where id = v.id;
  if t.fee_pence > 0 then
    insert into public.payments (id, visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, kind, idempotency_key)
    values (pid, v.id, p_customer, t.fee_pence, t.ping_pence, t.cleaner_pence, 'late_cancel', 'payment:' || pid);
  end if;
  if t.late and v.cleaner_id is not null then
    insert into public.engine_alerts (kind, series_id, visit_id, message)
    values ('visit_cancelled_late', v.series_id, v.id,
            'The customer cancelled this clean at short notice. It has gone from the cleaner''s app, but nothing tells them: ring or text them so they don''t travel.'
            || case when t.fee_pence > 0 then ' The late-cancellation fee is being charged.' else '' end);
  end if;
end $$;
revoke all on function private.cancel_one(uuid, uuid) from public, anon, authenticated;

-- As PR 11, now through private.cancel_one. Behaviour unchanged.
create or replace function public.cancel_visit(p_visit uuid, p_shown_fee_pence integer) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v public.visits;
  t record;
  done record;
begin
  if (select private.my_role()) is distinct from 'customer' then
    raise exception 'Only the customer can cancel their clean' using errcode = '42501';
  end if;
  select * into v from public.visits where id = p_visit and customer_id = me for update;
  if not found then
    raise exception 'That clean isn''t yours' using errcode = 'PC034';
  end if;
  if v.status <> 'scheduled' or now() >= (v.scheduled_date + v.window_start) at time zone 'Europe/London' then
    raise exception 'That clean can''t be cancelled now' using errcode = 'PC034';
  end if;
  select * into t from private.late_cancel_terms(v.id);
  if t.fee_pence is distinct from coalesce(p_shown_fee_pence, -1) then
    raise exception 'The cost of cancelling has changed' using errcode = 'PC035';
  end if;
  select * into done from private.cancel_one(v.id, me);
  return case when done.fee_pence > 0 then 'cancelled_with_fee' when done.late then 'cancelled_late' else 'cancelled' end;
end $$;

-- ---------------------------------------------------------------- the rest of the block
-- What the customer is shown before they confirm. Their own block only.
--   cleans     how many would be cancelled (booked, time not started)
--   late       how many of those are at short notice
--   fee_pence  the total of their late-cancellation fees
--   under_way  cleans that have started or whose time has begun: while there are any, the
--              rest can't be cancelled in one go (the block has to stay live for that clean)
create function public.cancel_block_quote(p_series uuid)
returns table (can_cancel boolean, cleans integer, late integer, fee_pence integer, under_way integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  s public.series;
begin
  select * into s from public.series where id = p_series and customer_id = me;
  if not found then
    raise exception 'That booking isn''t yours' using errcode = 'PC054';
  end if;
  select count(*) filter (where cancellable)::integer,
         count(*) filter (where cancellable and t.late)::integer,
         coalesce(sum(t.fee_pence) filter (where cancellable), 0)::integer,
         count(*) filter (where not cancellable)::integer
    into cleans, late, fee_pence, under_way
    from (select v.id, v.status = 'scheduled' and now() < (v.scheduled_date + v.window_start) at time zone 'Europe/London' as cancellable
            from public.visits v
           where v.series_id = s.id and v.status in ('scheduled', 'in_progress')) x
    cross join lateral private.late_cancel_terms(x.id) t;
  can_cancel := s.status <> 'ended' and under_way = 0;
  return next;
end $$;

-- Cancels every clean still to come, at the total the customer saw, and ends the block.
-- Returns how many cleans were cancelled.
create function public.cancel_block(p_series uuid, p_shown_fee_pence integer) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  s public.series;
  v_id uuid;
  ids uuid[];
  total integer := 0;
  done record;
  n integer := 0;
begin
  if (select private.my_role()) is distinct from 'customer' then
    raise exception 'Only the customer can cancel their cleans' using errcode = '42501';
  end if;
  -- Lock order: series, then visits (as everywhere else).
  select * into s from public.series where id = p_series and customer_id = me for update;
  if not found or s.status = 'ended' then
    raise exception 'That booking isn''t yours, or it has already ended' using errcode = 'PC054';
  end if;
  perform 1 from public.visits v where v.series_id = s.id and v.status in ('scheduled', 'in_progress') order by v.id for update;
  if exists (select 1 from public.visits v
              where v.series_id = s.id
                and (v.status = 'in_progress'
                     or (v.status = 'scheduled' and now() >= (v.scheduled_date + v.window_start) at time zone 'Europe/London'))) then
    raise exception 'A clean is under way' using errcode = 'PC055';
  end if;

  select coalesce(array_agg(v.id order by v.scheduled_date, v.id), '{}') into ids
    from public.visits v where v.series_id = s.id and v.status = 'scheduled';
  select coalesce(sum(t.fee_pence), 0)::integer into total
    from unnest(ids) as i (id) cross join lateral private.late_cancel_terms(i.id) t;
  if total is distinct from coalesce(p_shown_fee_pence, -1) then
    raise exception 'The cost of cancelling has changed' using errcode = 'PC035';
  end if;

  foreach v_id in array ids loop
    select * into done from private.cancel_one(v_id, me);
    n := n + 1;
  end loop;

  -- Ends the block (offers withdrawn, nothing more booked) and tells the office.
  perform private.close_block(s.id, null, 'The customer cancelled the rest of their cleans (' || n || ').');
  return n;
end $$;

revoke all on function public.cancel_block_quote(uuid), public.cancel_block(uuid, integer) from public, anon;
grant execute on function public.cancel_block_quote(uuid), public.cancel_block(uuid, integer) to authenticated;
