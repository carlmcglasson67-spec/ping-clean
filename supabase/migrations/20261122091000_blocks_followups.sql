-- Ping Clean: blocks follow-ups (issue #12 notes 2-4, last item of #60). Carl's go-ahead:
-- "fix all the issues on GitHub" (22 Nov 2026). Plan: intent/blocks-followups/plan.md.
-- Note 1 (ending a block with money rows) was fixed by 20261108090000_visits_never_deleted.sql.
-- No new tables, columns or error codes.

-- ---------------------------------------------------------------- note 2: the overlap alert tells the truth
-- As 20261107090000_blocks.sql, except: when the block in the way has gone, the rest of this
-- block is booked straight away (as claiming does), even on the nightly run's horizon, and
-- the overlap alert closes only once that booking has found nothing short, so "every clean
-- of this block is booked again" is true when the alert closes.
create or replace function private.generate_visits_for_series(p_series uuid, p_until date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.series;
  r record;
  step integer;
  inserted integer := 0;
  lost integer;
  new_end date;
  cleared boolean := false;
begin
  -- A pause or end committing at the same moment waits for us, or we see it.
  select * into s from public.series where id = p_series for no key update;
  if not found or s.status <> 'claimed' or s.cleaner_id is null then
    return 0;
  end if;
  if not exists (
    select 1 from public.cleaners c join public.profiles p on p.id = c.id
    where c.id = s.cleaner_id and c.status = 'active' and p.role = 'cleaner'
  ) then
    return 0;  -- held by a suspended or departed cleaner: no visits they can't do
  end if;
  step := private.cadence_days(s.frequency);

  select * into r from private.block_room(s.id);
  -- Stalled: the block's dates have passed with cleans never booked (e.g. its cleaner was
  -- suspended for a while). It is not quietly restarted if the cleaner comes back; the admin
  -- has an alert and ends it (public.admin_end_block) or puts it back on the board.
  if p_until is not null and s.ends_on < private.london_today() and r.have + s.cut_short_cleans < s.block_size then
    return 0;
  end if;
  if r.room > 0 then
    insert into public.visits (series_id, customer_id, cleaner_id, scheduled_date, window_start, window_end,
                               duration_minutes, price_pence, cleaner_earnings_pence, ping_fee_pence)
    select s.id, s.customer_id, s.cleaner_id, d.d, s.window_start, s.window_end, s.duration_minutes,
           p.price_pence, p.cleaner_earnings_pence, p.ping_fee_pence
    from (
      select g::date as d
      from generate_series(r.next_date, coalesce(p_until, r.next_date + step * r.room), make_interval(days => step)) as g
      where (r.cutoff is null or g::date < r.cutoff)
        and not exists (select 1 from public.visits v where v.series_id = s.id and v.scheduled_date = g::date)
      order by 1
      limit r.room
    ) d
    cross join lateral private.split_visit_price(s.price_per_hour_pence, s.duration_minutes, s.commission_type, s.commission_value) as p
    on conflict (series_id, scheduled_date) do nothing;
    get diagnostics inserted = row_count;
  end if;

  -- Where the block stands now: cleans that will never fit are recorded, exactly.
  select * into r from private.block_room(s.id);
  lost := greatest(s.block_size - r.have - r.room, 0);
  if lost is distinct from s.cut_short_cleans then
    update public.series set cut_short_cleans = lost where id = s.id;
    if lost > 0 then
      update public.engine_alerts set message = private.cut_short_message(lost)
      where series_id = s.id and kind = 'block_overlap' and resolved_at is null;
      if not found then
        insert into public.engine_alerts (kind, series_id, message)
        values ('block_overlap', s.id, private.cut_short_message(lost));
      end if;
    else
      -- The block in the way went (ended or cancelled): the rest of the block is booked and
      -- the alert settled below, once that booking confirms nothing is short.
      cleared := true;
    end if;
  end if;

  -- ends_on: the real last clean once everything that fits is booked; until then (only a
  -- block booked gradually, e.g. one created before this change) the projected one.
  new_end := case when r.room > 0 then r.next_date + step * (r.room - 1)
                  else greatest(coalesce(r.last_date, s.starts_on), s.starts_on) end;
  if new_end is distinct from s.ends_on then
    update public.series set ends_on = new_end where id = s.id;
  end if;

  if cleared then
    -- On a run with a horizon, book the whole of the rest now. That call sees
    -- cut_short_cleans = 0 already, so it opens no alert unless something is short again
    -- (another block committed meanwhile), and it sets ends_on itself. It never recurses:
    -- its p_until is null. A claim (p_until null) has booked the whole block above.
    if p_until is not null and r.room > 0 then
      inserted := inserted + private.generate_visits_for_series(s.id, null);
    end if;
    -- Close the alert only if the block still has nothing short after that booking.
    if (select cut_short_cleans from public.series where id = s.id) = 0 then
      update public.engine_alerts
      set message = 'No longer short: the block in the way has gone, so every clean of this block is booked again.',
          resolved_at = now()
      where series_id = s.id and kind = 'block_overlap' and resolved_at is null;
    end if;
  end if;

  return inserted;
end $$;
revoke all on function private.generate_visits_for_series(uuid, date) from public;

-- ---------------------------------------------------------------- note 3: closes with no admin settle old alerts
-- As 20261108130000_money_review_fixes.sql, except: when a block closes with no admin (the
-- engine, a customer cancelling the rest, or a payment hold running out), its open overlap and
-- stalled alerts are resolved (resolved_by stays empty) before the block_closed alert is
-- raised. An admin ending it settles them as before.
create or replace function private.close_block(p_series uuid, p_admin uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.series;
begin
  select * into s from public.series where id = p_series for update;
  update public.job_offers set status = 'withdrawn', responded_at = now()
  where series_id = s.id and status in ('open', 'pending');
  update public.visits
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_admin, cancel_reason = 'block_ended'
   where series_id = s.id and status = 'scheduled' and scheduled_date >= private.london_today();
  update public.series set status = 'ended', offering_since = null, end_reason = left(p_reason, 300) where id = s.id;
  if p_admin is null then
    -- The block has gone, so what those alerts asked the office to sort out no longer applies.
    update public.engine_alerts set resolved_at = now()
    where series_id = s.id and resolved_at is null and kind in ('block_overlap', 'block_stalled');
    insert into public.engine_alerts (kind, series_id, message) values ('block_closed', s.id, left(p_reason, 500));
  else
    -- The admin has dealt with it: their open block alerts are settled.
    update public.engine_alerts set resolved_at = now(), resolved_by = p_admin
    where series_id = s.id and resolved_at is null and kind in ('block_overlap', 'block_stalled', 'block_closed');
  end if;
end $$;
revoke all on function private.close_block(uuid, uuid, text) from public;

-- ---------------------------------------------------------------- note 4: claiming an ended block
-- As 20261107090000_blocks.sql, except: a block that has ended answers PC003 ("That job is no
-- longer open to you"), not PC002 ("Another cleaner claimed this one first").
create or replace function public.claim_series(p_offer uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  sid uuid;
  off public.job_offers;
  s public.series;
begin
  if not private.is_active_cleaner() then
    raise exception 'Only active Ping cleaners can claim jobs' using errcode = '42501';
  end if;

  select o.series_id into sid from public.job_offers o where o.id = p_offer and o.cleaner_id = me;
  if not found then
    raise exception 'That job isn''t available to you' using errcode = 'PC001';
  end if;

  select * into s from public.series where id = sid for update;
  perform 1 from public.cleaners where id = me for share;
  select * into off from public.job_offers where id = p_offer for update;

  if s.status = 'ended' then
    raise exception 'That job is no longer open to you' using errcode = 'PC003';
  end if;
  if s.status not in ('offering', 'unclaimed') then
    raise exception 'Another cleaner claimed this one first' using errcode = 'PC002';
  end if;
  if off.status <> 'open' or off.opens_at > now() or off.round <> s.offer_round
     or not exists (select 1 from private.eligible_cleaners(s.id) e where e.cleaner_id = me) then
    raise exception 'That job is no longer open to you' using errcode = 'PC003';
  end if;
  if private.block_capacity(s.id) = 0 then
    raise exception 'That job can''t go ahead on its dates any more' using errcode = 'PC004';
  end if;

  update public.series set cleaner_id = me, status = 'claimed', claimed_at = now(), offering_since = null
  where id = s.id;
  update public.job_offers set status = 'claimed', responded_at = now() where id = off.id;
  update public.job_offers set status = 'withdrawn', responded_at = now()
  where job_offers.series_id = s.id and job_offers.round = s.offer_round and id <> off.id
    and job_offers.status in ('open', 'pending');

  perform private.hand_over_visits(s.id, me);
  perform private.generate_visits_for_series(s.id, null);  -- the whole block, now
  return s.id;
end $$;
