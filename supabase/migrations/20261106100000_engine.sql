-- Ping Clean V1 — Marketplace engine.
--
--   private.generate_visits()        cron: turns every claimed series into visits for the next 4 weeks
--   private.release_offers()         cron: offers open jobs Top → Approved → everyone, then flags unclaimed
--   public.job_board()               cleaner: their open offers, town and district only (no address)
--   public.claim_series(offer)       cleaner: first to claim wins, atomically
--   public.admin_assign_series(…)    admin: give an unclaimed job to a cleaner by hand
--
-- Why SQL and not edge functions: each of these must be all-or-nothing (a claim that
-- half-happens is a double-booked cleaner), and RLS-adjacent logic is easiest to test
-- where the data lives. Edge functions stay for what needs the outside world: SMS and
-- push alerts (next PR), Stripe (Phase 5).
--
-- Every number comes from public.settings. If settings aren't ready, release_offers
-- does nothing rather than guess.

-- When the current round of offering began. Reset whenever a series goes back on the
-- board (e.g. a cleaner drops it), so the tier windows restart.
alter table public.series add column offering_since timestamptz;
update public.series set offering_since = created_at where status in ('offering', 'unclaimed');
alter table public.series add constraint series_offering_has_start
  check (status not in ('offering', 'unclaimed') or offering_since is not null);
alter table public.series alter column offering_since set default now();

create function private.london_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/London')::date
$$;

-- ---------------------------------------------------------------- visits
-- Visit dates for a series: the first preferred weekday on or after starts_on, then every
-- 7, 14 or 28 days. Only from today (London) to the horizon, never past ends_on.
-- Idempotent: an existing visit on a date is left alone (unique series_id + date).
create function private.generate_visits_for_series(p_series uuid, p_until date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.series;
  first_date date;
  step integer;
  inserted integer;
begin
  select * into s from public.series where id = p_series;
  if not found or s.status <> 'claimed' or s.cleaner_id is null then
    return 0;
  end if;

  first_date := s.starts_on + ((s.preferred_day - extract(isodow from s.starts_on)::int + 7) % 7);
  step := case s.frequency when 'weekly' then 7 when 'fortnightly' then 14 else 28 end;

  insert into public.visits (series_id, customer_id, cleaner_id, scheduled_date, window_start, window_end,
                             duration_minutes, price_pence, cleaner_earnings_pence, ping_fee_pence)
  select s.id, s.customer_id, s.cleaner_id, d::date, s.window_start, s.window_end, s.duration_minutes,
         p.price_pence, p.cleaner_earnings_pence, p.ping_fee_pence
  from generate_series(first_date, least(p_until, coalesce(s.ends_on, p_until)), make_interval(days => step)) as d
  cross join lateral private.split_visit_price(s.price_per_hour_pence, s.duration_minutes, s.commission_type, s.commission_value) as p
  where d::date >= private.london_today()
  on conflict (series_id, scheduled_date) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end $$;

create function private.generate_visits(p_horizon_days integer default 28)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  total integer := 0;
  sid uuid;
begin
  perform set_config('app.actor', 'cron:generate-visits', true);
  for sid in select id from public.series where status = 'claimed' loop
    total := total + private.generate_visits_for_series(sid, private.london_today() + p_horizon_days);
  end loop;
  return total;
end $$;

-- ---------------------------------------------------------------- offers
-- Who may be offered a series: an active cleaner who covers its postcode district and,
-- if they've set availability, works on its day. (No availability set = any day, so a
-- new cleaner isn't silently shown nothing.)
create function private.eligible_cleaners(p_series uuid, p_tiers public.cleaner_tier[])
returns table (cleaner_id uuid, tier public.cleaner_tier)
language sql stable security definer set search_path = '' as $$
  select c.id, c.tier
  from public.series s
  join public.properties pr on pr.id = s.property_id
  join public.cleaners c on pr.postcode_district = any (c.areas)
  join public.profiles p on p.id = c.id and p.role = 'cleaner'
  where s.id = p_series
    and c.status = 'active'
    and c.tier = any (p_tiers)
    and (
      jsonb_array_length(c.availability) = 0
      or exists (select 1 from jsonb_array_elements(c.availability) a where (a ->> 'day')::int = s.preferred_day)
    )
$$;

-- Releases offers on the tier windows, and flags jobs nobody has claimed:
--   from the start          Top cleaners
--   after top_window        + Approved
--   after top + approved    + everyone (New)
--   after all of that + unclaimed_alert_minutes: status 'unclaimed' (admin dashboard alert)
-- Offers stay open after a job goes unclaimed: anyone eligible can still take it.
create function private.release_offers()
returns table (series_id uuid, offers_created integer, now_unclaimed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  st public.settings;
  s record;
  elapsed interval;
  tiers public.cleaner_tier[];
  created integer;
  flagged boolean;
begin
  if not private.settings_ready() then
    return;  -- no guessing: nothing is offered until the real numbers are set
  end if;
  select * into st from public.settings where id;
  perform set_config('app.actor', 'cron:release-offers', true);

  for s in
    select id, status, offering_since from public.series
    where status in ('offering', 'unclaimed')
    for update skip locked
  loop
    elapsed := now() - s.offering_since;
    tiers := array['top']::public.cleaner_tier[];
    if elapsed >= make_interval(mins => st.top_window_minutes) then
      tiers := tiers || 'approved'::public.cleaner_tier;
    end if;
    if elapsed >= make_interval(mins => st.top_window_minutes + st.approved_window_minutes) then
      tiers := tiers || 'new'::public.cleaner_tier;
    end if;

    insert into public.job_offers (series_id, cleaner_id, tier, opens_at, status)
    select s.id, e.cleaner_id, e.tier, now(), 'open'
    from private.eligible_cleaners(s.id, tiers) e
    on conflict on constraint job_offers_series_id_cleaner_id_key do nothing;
    get diagnostics created = row_count;

    flagged := false;
    if s.status = 'offering'
       and elapsed >= make_interval(mins => st.top_window_minutes + st.approved_window_minutes + st.unclaimed_alert_minutes) then
      update public.series set status = 'unclaimed' where id = s.id;
      flagged := true;
    end if;

    series_id := s.id;
    offers_created := created;
    now_unclaimed := flagged;
    return next;
  end loop;
end $$;

-- ---------------------------------------------------------------- job board
-- A cleaner's open offers. Address privacy (ping-data-security rule 3): town, postcode
-- district, size and hours only. The street, access notes and key code unlock on claim.
create function public.job_board()
returns table (
  offer_id uuid,
  series_id uuid,
  offered_as public.cleaner_tier,
  opened_at timestamptz,
  town text,
  postcode_district text,
  bedrooms smallint,
  bathrooms smallint,
  has_pets boolean,
  frequency public.series_frequency,
  preferred_day smallint,
  window_start time,
  window_end time,
  duration_minutes integer,
  starts_on date,
  earnings_per_visit_pence integer,
  status public.series_status
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_active_cleaner() then
    raise exception 'Only active Ping cleaners can see the job board' using errcode = '42501';
  end if;
  return query
    select o.id, s.id, o.tier, o.opens_at, pr.town, pr.postcode_district, pr.bedrooms, pr.bathrooms,
           coalesce(nullif(trim(pr.pets), ''), null) is not null,
           s.frequency, s.preferred_day, s.window_start, s.window_end, s.duration_minutes, s.starts_on,
           p.cleaner_earnings_pence, s.status
    from public.job_offers o
    join public.series s on s.id = o.series_id
    join public.properties pr on pr.id = s.property_id
    cross join lateral private.split_visit_price(s.price_per_hour_pence, s.duration_minutes, s.commission_type, s.commission_value) p
    where o.cleaner_id = (select auth.uid())
      and o.status = 'open'
      and o.opens_at <= now()
      and s.status in ('offering', 'unclaimed')
    order by o.opens_at;
end $$;

-- ---------------------------------------------------------------- claiming
-- First to claim wins. The series row is locked, so two cleaners pressing "Claim" in the
-- same instant are served one after the other: the first gets it, the second is told.
-- Error codes the apps translate into plain words:
--   PC001 not your offer · PC002 someone else got it · PC003 not open yet / withdrawn
create function public.claim_series(p_offer uuid)
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

  -- Lock order matters: always the series first, then its offers. Every function that
  -- touches both (release_offers, admin_assign_series) does the same, so two claims can't
  -- deadlock; the second simply waits, then finds the job taken.
  select o.series_id into sid from public.job_offers o where o.id = p_offer and o.cleaner_id = me;
  if not found then
    raise exception 'That job isn''t available to you' using errcode = 'PC001';
  end if;

  select * into s from public.series where id = sid for update;
  select * into off from public.job_offers where id = p_offer for update;

  if s.status not in ('offering', 'unclaimed') then
    raise exception 'Another cleaner claimed this one first' using errcode = 'PC002';
  end if;
  if off.status <> 'open' or off.opens_at > now() then
    raise exception 'That job is no longer on offer' using errcode = 'PC003';
  end if;

  update public.series set cleaner_id = me, status = 'claimed', claimed_at = now(), offering_since = null
  where id = s.id;
  update public.job_offers set status = 'claimed', responded_at = now() where id = off.id;
  update public.job_offers set status = 'withdrawn', responded_at = now()
  where job_offers.series_id = s.id and id <> off.id and job_offers.status in ('open', 'pending');

  perform private.generate_visits_for_series(s.id, private.london_today() + 28);
  return s.id;
end $$;

-- Admin hands an open job to a specific cleaner (the "last resort" in the core flow).
create function public.admin_assign_series(p_series uuid, p_cleaner uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.series;
  c public.cleaners;
begin
  if not private.is_admin() then
    raise exception 'Only the Ping team can assign jobs' using errcode = '42501';
  end if;
  select * into c from public.cleaners where id = p_cleaner;
  if not found or c.status <> 'active' then
    raise exception 'That cleaner isn''t active' using errcode = 'PC001';
  end if;
  select * into s from public.series where id = p_series for update;
  if not found or s.status not in ('offering', 'unclaimed') then
    raise exception 'That job has already been taken' using errcode = 'PC002';
  end if;

  update public.series set cleaner_id = p_cleaner, status = 'claimed', claimed_at = now(), offering_since = null
  where id = s.id;
  insert into public.job_offers (series_id, cleaner_id, tier, opens_at, status, responded_at)
  values (s.id, p_cleaner, c.tier, now(), 'claimed', now())
  on conflict on constraint job_offers_series_id_cleaner_id_key
    do update set status = 'claimed', responded_at = now();
  update public.job_offers set status = 'withdrawn', responded_at = now()
  where job_offers.series_id = s.id and cleaner_id <> p_cleaner and job_offers.status in ('open', 'pending');

  perform private.generate_visits_for_series(s.id, private.london_today() + 28);
end $$;

-- ---------------------------------------------------------------- access
revoke all on function private.london_today() from public;
revoke all on function private.generate_visits_for_series(uuid, date) from public;
revoke all on function private.generate_visits(integer) from public;
revoke all on function private.eligible_cleaners(uuid, public.cleaner_tier[]) from public;
revoke all on function private.release_offers() from public;
grant execute on function private.generate_visits(integer), private.release_offers() to service_role;

revoke all on function public.job_board() from public, anon;
revoke all on function public.claim_series(uuid) from public, anon;
revoke all on function public.admin_assign_series(uuid, uuid) from public, anon;
grant execute on function public.job_board(), public.claim_series(uuid), public.admin_assign_series(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- schedule
-- On Supabase, pg_cron runs these inside the database. Skipped where pg_cron isn't
-- available (the local test database), so migrations apply everywhere.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('ping-release-offers', '*/5 * * * *', 'select private.release_offers()');
    perform cron.schedule('ping-generate-visits', '15 2 * * *', 'select private.generate_visits()');
  end if;
end $$;
