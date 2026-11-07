-- Ping Clean V1 — Marketplace engine.
--
--   private.run_release_offers()     cron: offers open jobs Top → Approved → everyone, flags unclaimed
--   private.run_generate_visits()    cron: turns every claimed series into visits for the next 4 weeks
--   public.engine_alerts             what the engine needs a person to look at (admin-only)
--   public.job_board()               cleaner: their open offers, town and district only (no address)
--   public.claim_series(offer)       cleaner: first eligible cleaner to claim wins, atomically
--   public.admin_assign_series(…)    admin: give an open job to a cleaner by hand
--   public.admin_reopen_series(…)    admin: put a held job back on the board (e.g. a drop-out)
--
-- Why SQL and not edge functions: each of these must be all-or-nothing (a claim that
-- half-happens is a double-booked cleaner), and it's easiest to prove where the data
-- lives. Edge functions stay for what needs the outside world: SMS and push alerts, Stripe.
--
-- Rules every function here follows:
--   * Every number comes from public.settings. Not ready → do nothing, never guess.
--   * Lock order is always: series, then cleaner, then offers. Nothing can deadlock.
--   * "Today" is London's date. Visits are never created for today or the past.

-- ---------------------------------------------------------------- data rules
-- Availability is edited by cleaners themselves, so the database validates its shape:
-- every slot is {"day": 1-7, "from": "HH:MM", "to": "HH:MM"} with from < to. A bad value
-- must never be able to break the engine for everyone else.
create function private.valid_availability(a jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(a) = 'array'
     and jsonb_array_length(a) <= 21
     and coalesce(bool_and(
           jsonb_typeof(slot) = 'object'
       and jsonb_typeof(slot -> 'day') = 'number'
       and (slot ->> 'day') in ('1', '2', '3', '4', '5', '6', '7')
       and coalesce(slot ->> 'from', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       and coalesce(slot ->> 'to', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       and (slot ->> 'from') < (slot ->> 'to')
     ), true)
  from jsonb_array_elements(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) as slot
$$;
alter table public.cleaners drop constraint if exists cleaners_availability_check;
alter table public.cleaners add constraint cleaners_availability_valid check (private.valid_availability(availability));

-- Offering happens in rounds. A held job that goes back on the board starts a new round:
-- every cleaner can be offered it again, and the tier windows restart.
alter table public.series add column offering_since timestamptz default now();
alter table public.series add column offer_round integer not null default 1 check (offer_round > 0);
update public.series set offering_since = created_at where status in ('offering', 'unclaimed');
update public.series set offering_since = null where status not in ('offering', 'unclaimed');
alter table public.series add constraint series_offering_has_start
  check (status not in ('offering', 'unclaimed') or offering_since is not null);

alter table public.job_offers add column round integer not null default 1 check (round > 0);
alter table public.job_offers drop constraint job_offers_series_id_cleaner_id_key;
alter table public.job_offers add constraint job_offers_one_per_round unique (series_id, round, cleaner_id);
drop index public.job_offers_one_claim;
create unique index job_offers_one_claim_per_round on public.job_offers (series_id, round) where status = 'claimed';

-- New visits are audited too (price, earnings and fee from the moment they exist).
create trigger visits_audit_insert after insert on public.visits
  for each row execute function private.audit_row();
create trigger visits_audit_delete after delete on public.visits
  for each row execute function private.audit_row();

-- Things the engine needs a person to look at. Admin-only; written by the engine.
create table public.engine_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('release_failed', 'generate_failed', 'visit_needs_cover')),
  series_id uuid references public.series (id) on delete cascade,
  visit_id uuid references public.visits (id) on delete cascade,
  message text not null check (char_length(message) <= 500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id)
);
alter table public.engine_alerts enable row level security;
create index engine_alerts_open_idx on public.engine_alerts (created_at desc) where resolved_at is null;
-- One open failure alert per series and kind, not one every run.
create unique index engine_alerts_one_open_failure on public.engine_alerts (series_id, kind)
  where kind in ('release_failed', 'generate_failed') and resolved_at is null;
create trigger engine_alerts_audit after update on public.engine_alerts
  for each row execute function private.audit_row('message');
revoke all on public.engine_alerts from anon;
revoke insert, update, delete on public.engine_alerts from authenticated;
grant update (resolved_at, resolved_by) on public.engine_alerts to authenticated;
create policy engine_alerts_admin_read on public.engine_alerts
  for select to authenticated using ((select private.is_admin()));
create policy engine_alerts_admin_resolve on public.engine_alerts
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()) and resolved_by = (select auth.uid()));

create function private.london_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/London')::date
$$;

-- ---------------------------------------------------------------- eligibility
-- Which tiers may see or take a job right now, from how long it's been on offer:
--   start: Top · after top_window: + Approved · after top + approved: + everyone
-- An unclaimed job is open to every tier.
create function private.open_tiers(p_series uuid) returns public.cleaner_tier[]
language plpgsql stable security definer set search_path = '' as $$
declare
  st public.settings;
  s public.series;
  elapsed interval;
begin
  select * into s from public.series where id = p_series;
  if not found or s.status not in ('offering', 'unclaimed') then return '{}'; end if;
  if s.status = 'unclaimed' then return array['top', 'approved', 'new']::public.cleaner_tier[]; end if;
  if not private.settings_ready() then return '{}'; end if;
  select * into st from public.settings where id;
  elapsed := now() - s.offering_since;
  if elapsed >= make_interval(mins => st.top_window_minutes + st.approved_window_minutes) then
    return array['top', 'approved', 'new']::public.cleaner_tier[];
  elsif elapsed >= make_interval(mins => st.top_window_minutes) then
    return array['top', 'approved']::public.cleaner_tier[];
  end if;
  return array['top']::public.cleaner_tier[];
end $$;

-- Who may be offered (and may claim) a job now: an active cleaner, in an open tier, who
-- covers its postcode district and, if they've set working days, works on its day.
-- (No working days set = any day, so a new cleaner isn't silently shown nothing.)
create function private.eligible_cleaners(p_series uuid)
returns table (cleaner_id uuid, tier public.cleaner_tier)
language sql stable security definer set search_path = '' as $$
  select c.id, c.tier
  from public.series s
  join public.properties pr on pr.id = s.property_id
  join public.cleaners c on pr.postcode_district = any (c.areas)
  join public.profiles p on p.id = c.id and p.role = 'cleaner'
  where s.id = p_series
    and c.status = 'active'
    and c.tier = any (private.open_tiers(p_series))
    and (
      jsonb_array_length(c.availability) = 0
      or exists (select 1 from jsonb_array_elements(c.availability) a where a -> 'day' = to_jsonb(s.preferred_day::int))
    )
$$;

-- ---------------------------------------------------------------- visits
-- Visit dates: the first preferred weekday on or after starts_on, then every 7, 14 or 28
-- days, from tomorrow (London) to the horizon, never past ends_on. Today is never booked:
-- a slot may already have passed, and the cleaner needs notice.
-- Only for a claimed series whose cleaner is active. Idempotent (unique series + date).
create function private.generate_visits_for_series(p_series uuid, p_until date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.series;
  first_date date;
  step integer;
  inserted integer;
begin
  -- FOR SHARE: a pause or end committing at the same moment waits for us, or we see it.
  select * into s from public.series where id = p_series for share;
  if not found or s.status <> 'claimed' or s.cleaner_id is null then
    return 0;
  end if;
  if not exists (
    select 1 from public.cleaners c join public.profiles p on p.id = c.id
    where c.id = s.cleaner_id and c.status = 'active' and p.role = 'cleaner'
  ) then
    return 0;  -- held by a suspended or departed cleaner: no visits they can't do
  end if;

  first_date := s.starts_on + ((s.preferred_day - extract(isodow from s.starts_on)::int + 7) % 7);
  step := case s.frequency when 'weekly' then 7 when 'fortnightly' then 14 else 28 end;

  insert into public.visits (series_id, customer_id, cleaner_id, scheduled_date, window_start, window_end,
                             duration_minutes, price_pence, cleaner_earnings_pence, ping_fee_pence)
  select s.id, s.customer_id, s.cleaner_id, d::date, s.window_start, s.window_end, s.duration_minutes,
         p.price_pence, p.cleaner_earnings_pence, p.ping_fee_pence
  from generate_series(first_date, least(p_until, coalesce(s.ends_on, p_until)), make_interval(days => step)) as d
  cross join lateral private.split_visit_price(s.price_per_hour_pence, s.duration_minutes, s.commission_type, s.commission_value) as p
  where d::date > private.london_today()
  on conflict (series_id, scheduled_date) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end $$;

-- What the scheduler runs nightly: commits after every series, so pauses, ends and
-- reopens never wait for the whole run.
create procedure private.run_generate_visits(p_horizon_days integer default 28)
language plpgsql as $$
declare
  sid uuid;
begin
  perform pg_catalog.set_config('search_path', '', false);  -- see run_release_offers
  for sid in select id from public.series where status = 'claimed' loop
    begin
      perform set_config('app.actor', 'cron:generate-visits', true);
      perform private.generate_visits_for_series(sid, private.london_today() + p_horizon_days);
    exception when others then
      perform private.note_engine_failure('generate_failed', sid, sqlerrm);
    end;
    commit;
  end loop;
end $$;

-- Same work in one transaction (tests, and by hand).
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
-- Releases offers for ONE series on its tier windows, and flags it unclaimed once every
-- window has passed. Offers stay open after a job goes unclaimed: anyone eligible can
-- still take it. Returns null if the series is locked (being claimed) or no longer open.
create function private.release_one(p_series uuid, out offers_created integer, out now_unclaimed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  st public.settings;
  s public.series;
begin
  select * into st from public.settings where id;
  select * into s from public.series where id = p_series and status in ('offering', 'unclaimed') for update skip locked;
  if not found then return; end if;

  insert into public.job_offers (series_id, cleaner_id, tier, round, opens_at, status)
  select s.id, e.cleaner_id, e.tier, s.offer_round, now(), 'open'
  from private.eligible_cleaners(s.id) e
  on conflict on constraint job_offers_one_per_round do nothing;
  get diagnostics offers_created = row_count;

  now_unclaimed := false;
  if s.status = 'offering'
     and now() - s.offering_since >= make_interval(mins => st.top_window_minutes + st.approved_window_minutes + st.unclaimed_alert_minutes) then
    update public.series set status = 'unclaimed' where id = s.id;
    now_unclaimed := true;
  end if;
end $$;

-- Records a failed series for the admin (once per kind, until resolved) instead of
-- failing silently. p_kind: 'release_failed' or 'generate_failed'.
create function private.note_engine_failure(p_kind text, p_series uuid, p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise warning '%: series % skipped: %', p_kind, p_series, p_error;
  insert into public.engine_alerts (kind, series_id, message)
  values (p_kind, p_series, left(case p_kind when 'release_failed' then 'Couldn''t release offers: '
                                             else 'Couldn''t book visits: ' end || p_error, 500))
  on conflict do nothing;
end $$;

-- All open series, each in its own sub-transaction so one bad series can't stop the rest.
-- Used by tests and by hand. Runs as one transaction, so a claim on a series already
-- handled waits until it finishes; the scheduler uses the procedure below instead.
create function private.release_offers()
returns table (series_id uuid, offers_created integer, now_unclaimed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
  r record;
begin
  if not private.settings_ready() then
    return;  -- no guessing: nothing is offered until the real numbers are set
  end if;
  perform set_config('app.actor', 'cron:release-offers', true);
  for sid in select id from public.series where status in ('offering', 'unclaimed') order by offering_since loop
    begin
      select * into r from private.release_one(sid);
      continue when r.offers_created is null;
      series_id := sid;
      offers_created := r.offers_created;
      now_unclaimed := r.now_unclaimed;
      return next;
    exception when others then
      perform private.note_engine_failure('release_failed', sid, sqlerrm);
    end;
  end loop;
end $$;

-- What the scheduler runs: same work, committing after every series, so each series is
-- locked only for the moment it's handled and a claim never waits for the whole run.
-- A procedure (not security definer and no SET clause: neither can commit); the
-- scheduler runs it as the database owner.
create procedure private.run_release_offers()
language plpgsql as $$
declare
  sid uuid;
begin
  -- Procedures that COMMIT can't carry a SET clause, so pin the search path here.
  -- Every name below is schema-qualified anyway. Session-wide (a local setting would end
  -- at the first COMMIT): harmless for pg_cron, which gives each run its own connection.
  -- If you CALL this by hand in psql, run `reset search_path` afterwards.
  perform pg_catalog.set_config('search_path', '', false);
  if not private.settings_ready() then return; end if;
  for sid in select id from public.series where status in ('offering', 'unclaimed') order by offering_since loop
    begin
      perform set_config('app.actor', 'cron:release-offers', true);
      perform private.release_one(sid);
    exception when others then
      perform private.note_engine_failure('release_failed', sid, sqlerrm);
    end;
    commit;
  end loop;
end $$;

-- ---------------------------------------------------------------- job board
-- A cleaner's open offers in the current round. Address privacy (ping-data-security
-- rule 3): town, postcode district, size, pets yes/no, hours and earnings only. The street,
-- access notes and key code unlock on claim.
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
           nullif(trim(pr.pets), '') is not null,
           s.frequency, s.preferred_day, s.window_start, s.window_end, s.duration_minutes, s.starts_on,
           p.cleaner_earnings_pence, s.status
    from public.job_offers o
    join public.series s on s.id = o.series_id and o.round = s.offer_round
    join public.properties pr on pr.id = s.property_id
    cross join lateral private.split_visit_price(s.price_per_hour_pence, s.duration_minutes, s.commission_type, s.commission_value) p
    where o.cleaner_id = (select auth.uid())
      and o.status = 'open'
      and o.opens_at <= now()
      and s.status in ('offering', 'unclaimed')
    order by o.opens_at;
end $$;

-- ---------------------------------------------------------------- claiming
-- First eligible cleaner to claim wins. The series is locked first, so two cleaners
-- pressing "Claim" at the same instant are served one after the other. Eligibility is
-- re-checked at the moment of claiming: an offer made yesterday doesn't let a cleaner
-- who has since been demoted, moved areas or suspended jump the queue.
-- Error codes the apps turn into plain words:
--   PC001 not your offer · PC002 someone else got it · PC003 no longer open to you
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

  select o.series_id into sid from public.job_offers o where o.id = p_offer and o.cleaner_id = me;
  if not found then
    raise exception 'That job isn''t available to you' using errcode = 'PC001';
  end if;

  select * into s from public.series where id = sid for update;
  perform 1 from public.cleaners where id = me for share;
  select * into off from public.job_offers where id = p_offer for update;

  if s.status not in ('offering', 'unclaimed') then
    raise exception 'Another cleaner claimed this one first' using errcode = 'PC002';
  end if;
  if off.status <> 'open' or off.opens_at > now() or off.round <> s.offer_round
     or not exists (select 1 from private.eligible_cleaners(s.id) e where e.cleaner_id = me) then
    raise exception 'That job is no longer open to you' using errcode = 'PC003';
  end if;

  update public.series set cleaner_id = me, status = 'claimed', claimed_at = now(), offering_since = null
  where id = s.id;
  update public.job_offers set status = 'claimed', responded_at = now() where id = off.id;
  update public.job_offers set status = 'withdrawn', responded_at = now()
  where job_offers.series_id = s.id and job_offers.round = s.offer_round and id <> off.id
    and job_offers.status in ('open', 'pending');

  perform private.generate_visits_for_series(s.id, private.london_today() + 28);
  return s.id;
end $$;

-- ---------------------------------------------------------------- admin
-- Admin hands an open job to a specific active cleaner (the last resort in the core flow).
-- Skips the tier and area rules on purpose: that's the point of a manual assignment.
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
  select * into s from public.series where id = p_series for update;
  if not found or s.status not in ('offering', 'unclaimed') then
    raise exception 'That job has already been taken' using errcode = 'PC002';
  end if;
  select c2.* into c from public.cleaners c2 join public.profiles p on p.id = c2.id
  where c2.id = p_cleaner and c2.status = 'active' and p.role = 'cleaner'
  for share of c2;
  if not found then
    raise exception 'That cleaner isn''t active' using errcode = 'PC001';
  end if;

  update public.series set cleaner_id = p_cleaner, status = 'claimed', claimed_at = now(), offering_since = null
  where id = s.id;
  insert into public.job_offers (series_id, cleaner_id, tier, round, opens_at, status, responded_at)
  values (s.id, p_cleaner, c.tier, s.offer_round, now(), 'claimed', now())
  on conflict on constraint job_offers_one_per_round
    do update set status = 'claimed', responded_at = now();
  update public.job_offers set status = 'withdrawn', responded_at = now()
  where job_offers.series_id = s.id and job_offers.round = s.offer_round and cleaner_id <> p_cleaner
    and job_offers.status in ('open', 'pending');

  perform private.generate_visits_for_series(s.id, private.london_today() + 28);
end $$;

-- Puts a held job back on the board: a new offering round (tier windows restart, every
-- eligible cleaner can be offered it again), the departing cleaner left out of this round,
-- and their future booked visits removed so they can be re-booked for whoever claims next.
-- The cleaner drop-out flow (with notice rules from settings) will call the same function.
create function private.reopen_series(p_series uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.series;
begin
  select * into s from public.series where id = p_series for update;
  if not found or s.status <> 'claimed' then
    -- Not 'paused': the customer asked for a break, so it mustn't be offered to anyone.
    raise exception 'Only a job a cleaner currently holds can go back on the board' using errcode = 'PC002';
  end if;

  -- Today's visit (if any) stays booked but needs a person to sort cover.
  insert into public.engine_alerts (kind, series_id, visit_id, message)
  select 'visit_needs_cover', s.id, v.id, 'A regular clean went back on the board with a visit booked for today. Arrange cover or contact the customer.'
  from public.visits v
  where v.series_id = s.id and v.scheduled_date = private.london_today() and v.status = 'scheduled';

  update public.job_offers set status = 'expired', responded_at = coalesce(responded_at, now())
  where series_id = s.id and round = s.offer_round and status in ('open', 'pending');
  delete from public.visits
  where series_id = s.id and status = 'scheduled' and scheduled_date > private.london_today();

  update public.series
  set status = 'offering', cleaner_id = null, claimed_at = null, offering_since = now(), offer_round = s.offer_round + 1
  where id = s.id;

  -- Keep the departing cleaner out of the new round.
  insert into public.job_offers (series_id, cleaner_id, tier, round, opens_at, status, responded_at)
  select s.id, s.cleaner_id, c.tier, s.offer_round + 1, now(), 'withdrawn', now()
  from public.cleaners c where c.id = s.cleaner_id
  on conflict on constraint job_offers_one_per_round do nothing;
end $$;

create function public.admin_reopen_series(p_series uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Only the Ping team can put a job back on the board' using errcode = '42501';
  end if;
  perform private.reopen_series(p_series);
end $$;

-- ---------------------------------------------------------------- access
revoke all on function private.valid_availability(jsonb) from public;
revoke all on function private.london_today() from public;
revoke all on function private.open_tiers(uuid) from public;
revoke all on function private.eligible_cleaners(uuid) from public;
revoke all on function private.generate_visits_for_series(uuid, date) from public;
revoke all on function private.generate_visits(integer) from public;
revoke all on function private.release_offers() from public;
revoke all on function private.release_one(uuid) from public;
revoke all on function private.note_engine_failure(text, uuid, text) from public;
revoke all on procedure private.run_release_offers() from public;
revoke all on procedure private.run_generate_visits(integer) from public;
revoke all on function private.reopen_series(uuid) from public;
grant execute on function private.valid_availability(jsonb) to authenticated, service_role; -- used by a check constraint
grant execute on function private.generate_visits(integer), private.release_offers() to service_role;

revoke all on function public.job_board() from public, anon;
revoke all on function public.claim_series(uuid) from public, anon;
revoke all on function public.admin_assign_series(uuid, uuid) from public, anon;
revoke all on function public.admin_reopen_series(uuid) from public, anon;
grant execute on function public.job_board(), public.claim_series(uuid),
  public.admin_assign_series(uuid, uuid), public.admin_reopen_series(uuid) to authenticated;

-- ---------------------------------------------------------------- schedule
-- On Supabase, pg_cron runs these inside the database. Skipped where pg_cron isn't
-- available (the local test database), so the migrations apply everywhere.
-- Offers go out on 5-minute ticks: each tier window can run up to 5 minutes long.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('ping-release-offers', '*/5 * * * *', 'call private.run_release_offers()');
    perform cron.schedule('ping-generate-visits', '15 2 * * *', 'call private.run_generate_visits()');
  end if;
end $$;
