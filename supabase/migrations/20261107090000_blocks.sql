-- Ping Clean — Blocks, booking and rebooking (signed off by Carl, 7 Nov 2026).
--
--   Every booking is a BLOCK of 1 to 8 cleans, chosen by the customer. Nothing runs on
--   indefinitely: Ping is an agency, and neither customers nor self-employed cleaners
--   should feel trapped. A cleaner claims the whole block.
--
--   public.book_series(…)               customer: books a block for one of their homes (A-3)
--   private.generate_visits_for_series   now count-based: never more visits than the block
--   private.end_block_if_done            a finished block ends (and the address locks again)
--   Rebooking: the next block at the same home is offered first to the cleaner who did the
--   previous one, for settings.rebook_first_refusal_minutes, then goes to the hub as normal.
--
-- Same rules as the engine: numbers from settings only, lock order series → cleaner → offers
-- and visits, London's date, every function revoked from public and granted on purpose.

-- ---------------------------------------------------------------- settings
-- How long the previous cleaner has the next block to themselves. NULL (the start) means
-- no first refusal: rebooks go straight to the hub. It is not part of settings_ready().
alter table public.settings
  add column rebook_first_refusal_minutes integer check (rebook_first_refusal_minutes > 0);
grant update (rebook_first_refusal_minutes) on public.settings to authenticated;  -- admins only, by policy

-- ---------------------------------------------------------------- dates of a block
create function private.cadence_days(p_frequency public.series_frequency) returns integer
language sql immutable set search_path = '' as $$
  select case p_frequency when 'weekly' then 7 when 'fortnightly' then 14 else 28 end
$$;

-- The first preferred weekday on or after the start date: the block's first clean.
create function private.block_first_date(p_starts_on date, p_preferred_day smallint) returns date
language sql immutable set search_path = '' as $$
  select p_starts_on + ((p_preferred_day - extract(isodow from p_starts_on)::int + 7) % 7)
$$;

-- The first date on the block's cadence strictly after p_after.
create function private.next_cadence_after(p_first date, p_step integer, p_after date) returns date
language sql immutable set search_path = '' as $$
  select case when p_after < p_first then p_first
              else p_first + p_step * ((p_after - p_first) / p_step + 1) end
$$;

-- ---------------------------------------------------------------- series
alter table public.series add column block_size smallint;
-- Rows booked before blocks existed (test data only so far) become a full block.
update public.series set block_size = 8 where block_size is null;
alter table public.series
  alter column block_size set not null,
  add constraint series_block_size check (block_size between 1 and 8);

-- Idempotency for booking: a double-tapped "Book" sends the same id and gets the same series.
alter table public.series add column client_request_id uuid;
alter table public.series add constraint series_one_per_request unique (customer_id, client_request_id);

-- A rebook points at the block before it (same customer only, enforced by the key).
alter table public.series add column rebook_of uuid;
alter table public.series
  add constraint series_rebook_same_customer foreign key (rebook_of, customer_id) references public.series (id, customer_id),
  add constraint series_rebook_not_self check (rebook_of is distinct from id);

-- Who was given first refusal on this block, if anyone.
alter table public.series add column first_refusal_cleaner_id uuid references public.cleaners (id);
alter table public.series add constraint series_first_refusal_is_rebook
  check (first_refusal_cleaner_id is null or rebook_of is not null);

-- ends_on is the block's last clean. Set from the plan when a block is booked; visit
-- generation moves it if the block slips (claimed late, or put back on the board).
create function private.set_block_end() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.ends_on := private.block_first_date(new.starts_on, new.preferred_day)
                 + private.cadence_days(new.frequency) * (new.block_size - 1);
  return new;
end $$;
create trigger series_block_end before insert or update of starts_on, preferred_day, frequency, block_size
  on public.series for each row execute function private.set_block_end();
update public.series set block_size = block_size;  -- fires the trigger for existing rows
alter table public.series alter column ends_on set not null;

-- offering_since now means "when the hub opens". During a first-refusal window it is in
-- the future; tier windows and the unclaimed alert count from it, as before.
comment on column public.series.offering_since is
  'When the job opens to the hub (tier windows count from here). In the future during a rebook first-refusal window.';

alter table public.job_offers add column first_refusal boolean not null default false;

-- ---------------------------------------------------------------- eligibility
-- One definition of "this cleaner can do this job": active, a cleaner's account, covers
-- the district, and works that day (no working days set = any day).
create function private.cleaner_fits(p_cleaner uuid, p_district text, p_day smallint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cleaners c
    join public.profiles p on p.id = c.id and p.role = 'cleaner'
    where c.id = p_cleaner
      and c.status = 'active'
      and p_district = any (c.areas)
      and (
        jsonb_array_length(c.availability) = 0
        or exists (select 1 from jsonb_array_elements(c.availability) a where a -> 'day' = to_jsonb(p_day::int))
      )
  )
$$;

-- No tier is open before the hub opens (a first-refusal window is running).
create or replace function private.open_tiers(p_series uuid) returns public.cleaner_tier[]
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
  if elapsed < interval '0' then
    return '{}';
  elsif elapsed >= make_interval(mins => st.top_window_minutes + st.approved_window_minutes) then
    return array['top', 'approved', 'new']::public.cleaner_tier[];
  elsif elapsed >= make_interval(mins => st.top_window_minutes) then
    return array['top', 'approved']::public.cleaner_tier[];
  end if;
  return array['top']::public.cleaner_tier[];
end $$;

-- Who may be offered (and may claim) a job now. During a first-refusal window: only the
-- previous block's cleaner, and only while they still fit. Afterwards: the tier rules.
drop function private.eligible_cleaners(uuid);
create function private.eligible_cleaners(p_series uuid)
returns table (cleaner_id uuid, tier public.cleaner_tier, first_refusal boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.tier, false
  from public.series s
  join public.properties pr on pr.id = s.property_id
  join public.cleaners c on pr.postcode_district = any (c.areas)
  where s.id = p_series
    and c.tier = any (private.open_tiers(p_series))
    and private.cleaner_fits(c.id, pr.postcode_district, s.preferred_day)
  union all
  select c.id, c.tier, true
  from public.series s
  join public.properties pr on pr.id = s.property_id
  join public.cleaners c on c.id = s.first_refusal_cleaner_id
  where s.id = p_series
    and s.status = 'offering'
    and now() < s.offering_since
    and private.cleaner_fits(c.id, pr.postcode_district, s.preferred_day)
$$;

create or replace function private.release_one(p_series uuid, out offers_created integer, out now_unclaimed boolean)
language plpgsql security definer set search_path = '' as $$
declare
  st public.settings;
  s public.series;
begin
  select * into st from public.settings where id;
  select * into s from public.series where id = p_series and status in ('offering', 'unclaimed') for update skip locked;
  if not found then return; end if;

  insert into public.job_offers (series_id, cleaner_id, tier, round, opens_at, status, first_refusal)
  select s.id, e.cleaner_id, e.tier, s.offer_round, now(), 'open', e.first_refusal
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

-- ---------------------------------------------------------------- visits
-- Count-based: a block never has more visits than block_size, however far ahead the
-- horizon reaches. Dates follow the cadence from the block's first clean, after today
-- (London) and inside the horizon. A block claimed late, or put back on the board, slips
-- forward instead of losing cleans; ends_on follows it. Idempotent.
create or replace function private.generate_visits_for_series(p_series uuid, p_until date)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  s public.series;
  first_date date;
  step integer;
  have integer;
  last_date date;
  inserted integer := 0;
  new_end date;
  today date := private.london_today();
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

  first_date := private.block_first_date(s.starts_on, s.preferred_day);
  step := private.cadence_days(s.frequency);
  select count(*) into have from public.visits where series_id = s.id;

  if have < s.block_size then
    insert into public.visits (series_id, customer_id, cleaner_id, scheduled_date, window_start, window_end,
                               duration_minutes, price_pence, cleaner_earnings_pence, ping_fee_pence)
    select s.id, s.customer_id, s.cleaner_id, d.d, s.window_start, s.window_end, s.duration_minutes,
           p.price_pence, p.cleaner_earnings_pence, p.ping_fee_pence
    from (
      select g::date as d
      from generate_series(private.next_cadence_after(first_date, step, today), p_until, make_interval(days => step)) as g
      where not exists (select 1 from public.visits v where v.series_id = s.id and v.scheduled_date = g::date)
      order by 1
      limit s.block_size - have
    ) d
    cross join lateral private.split_visit_price(s.price_per_hour_pence, s.duration_minutes, s.commission_type, s.commission_value) as p
    on conflict (series_id, scheduled_date) do nothing;
    get diagnostics inserted = row_count;
  end if;

  -- Keep ends_on on the block's real (or, if not all booked yet, projected) last clean.
  select count(*), max(scheduled_date) into have, last_date from public.visits where series_id = s.id;
  if have >= s.block_size then
    new_end := last_date;
  else
    new_end := private.next_cadence_after(first_date, step, greatest(today, coalesce(last_date, today)))
               + step * (s.block_size - have - 1);
  end if;
  if new_end is not null and new_end >= s.starts_on and new_end is distinct from s.ends_on then
    update public.series set ends_on = new_end where id = s.id;
  end if;

  return inserted;
end $$;

-- Visits left behind after their day, for a person to look at.
alter table public.engine_alerts drop constraint engine_alerts_kind_check;
alter table public.engine_alerts add constraint engine_alerts_kind_check
  check (kind in ('release_failed', 'generate_failed', 'visit_needs_cover', 'visit_no_show', 'visit_unfinished'));

-- Nightly: a clean still 'scheduled' after its day never happened, so it becomes a no-show
-- and the admin is told. One still 'in_progress' after its day was started but never
-- finished: the admin is told and decides (it is never completed or charged automatically).
-- Nobody's no-show count changes here: that is the admin's call, not the clock's.
create function private.close_stale_visits() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  perform set_config('app.actor', 'cron:generate-visits', true);
  with stale as (
    update public.visits set status = 'no_show'
    where status = 'scheduled' and scheduled_date < private.london_today()
    returning id, series_id
  )
  insert into public.engine_alerts (kind, series_id, visit_id, message)
  select 'visit_no_show', series_id, id, 'A booked clean passed without being started. Check with the cleaner and the customer.'
  from stale;
  get diagnostics n = row_count;

  insert into public.engine_alerts (kind, series_id, visit_id, message)
  select 'visit_unfinished', v.series_id, v.id, 'A clean was started but never marked complete. Check it and settle it by hand.'
  from public.visits v
  where v.status = 'in_progress' and v.scheduled_date < private.london_today()
    and not exists (select 1 from public.engine_alerts a where a.visit_id = v.id and a.kind = 'visit_unfinished');
  return n;
end $$;

-- A held block is over when all its cleans exist and either none is still to do, or its
-- last date has passed (whatever state the cleans were left in: those are alerts for the
-- admin, not a reason to keep the address open). It ends, and with it the cleaner's access
-- to the address, key code and messages.
create function private.end_block_if_done(p_series uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.series s set status = 'ended'
  where s.id = p_series
    and s.status = 'claimed'
    and (select count(*) from public.visits v where v.series_id = s.id) >= s.block_size
    and (
      not exists (select 1 from public.visits v where v.series_id = s.id and v.status in ('scheduled', 'in_progress'))
      or (select max(v.scheduled_date) from public.visits v where v.series_id = s.id) < private.london_today()
    );
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- When a held job changes hands (claimed or assigned after going back on the board), any
-- clean still booked from today on goes to the new cleaner. Otherwise today's clean would
-- stay with the cleaner who left, nobody could start it, and the block could never end.
-- The admin's "needs cover" alert stays open until a person confirms the cover.
create function private.hand_over_visits(p_series uuid, p_cleaner uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.visits set cleaner_id = p_cleaner
  where series_id = p_series and status = 'scheduled' and scheduled_date >= private.london_today()
    and cleaner_id is distinct from p_cleaner;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace procedure private.run_generate_visits(p_horizon_days integer default 28)
language plpgsql as $$
declare
  sid uuid;
begin
  perform pg_catalog.set_config('search_path', '', false);  -- see run_release_offers
  begin
    perform private.close_stale_visits();
  exception when others then
    raise warning 'close_stale_visits failed: %', sqlerrm;
  end;
  commit;
  for sid in select id from public.series where status = 'claimed' loop
    begin
      perform set_config('app.actor', 'cron:generate-visits', true);
      perform private.generate_visits_for_series(sid, private.london_today() + p_horizon_days);
      perform private.end_block_if_done(sid);
    exception when others then
      perform private.note_engine_failure('generate_failed', sid, sqlerrm);
    end;
    commit;
  end loop;
end $$;

create or replace function private.generate_visits(p_horizon_days integer default 28)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  total integer := 0;
  sid uuid;
begin
  perform private.close_stale_visits();
  perform set_config('app.actor', 'cron:generate-visits', true);
  for sid in select id from public.series where status = 'claimed' loop
    total := total + private.generate_visits_for_series(sid, private.london_today() + p_horizon_days);
    perform private.end_block_if_done(sid);
  end loop;
  return total;
end $$;

-- ---------------------------------------------------------------- job board
-- Adds the block (how many cleans, last one) and whether it's a first-refusal rebook.
-- Address privacy unchanged: town and district only until claimed.
drop function public.job_board();
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
  status public.series_status,
  block_size smallint,
  ends_on date,
  first_refusal boolean
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
           p.cleaner_earnings_pence, s.status, s.block_size, s.ends_on, o.first_refusal
    from public.job_offers o
    join public.series s on s.id = o.series_id and o.round = s.offer_round
    join public.properties pr on pr.id = s.property_id
    cross join lateral private.split_visit_price(s.price_per_hour_pence, s.duration_minutes, s.commission_type, s.commission_value) p
    where o.cleaner_id = (select auth.uid())
      and o.status = 'open'
      and o.opens_at <= now()
      and s.status in ('offering', 'unclaimed')
      -- Only what they could claim right now (same rule claim_series checks), so pressing
      -- Claim never fails because their tier's window isn't open (yet, or any more).
      and exists (select 1 from private.eligible_cleaners(s.id) e where e.cleaner_id = (select auth.uid()))
    order by o.opens_at;
end $$;

-- ---------------------------------------------------------------- claiming and assigning
-- As in the engine, plus: a clean still booked from today on goes to the new cleaner.
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

  perform private.hand_over_visits(s.id, me);
  perform private.generate_visits_for_series(s.id, private.london_today() + 28);
  return s.id;
end $$;

create or replace function public.admin_assign_series(p_series uuid, p_cleaner uuid)
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

  perform private.hand_over_visits(s.id, p_cleaner);
  perform private.generate_visits_for_series(s.id, private.london_today() + 28);
end $$;

-- ---------------------------------------------------------------- booking (A-3)
-- A signed-in customer books a block of cleans at one of their homes. Everything that
-- costs money comes from settings, never from the browser. Idempotent on p_request_id.
-- Error codes the site turns into plain words:
--   PC020 booking not open yet · PC021 home not found · PC022 outside our area
--   PC023 length not allowed · PC024 start must be after today · PC025 block 1–8
--   PC026 day or time window not valid (incl. a window shorter than the clean)
--   PC027 cleans already booked at this home on those dates
--   PC028 that request id was already used for a different booking

-- The series an earlier call with the same request id made, or null. A replay with
-- different details is refused rather than silently answered with the first booking.
create function private.replayed_booking(
  p_customer uuid, p_request_id uuid, p_property uuid, p_frequency public.series_frequency,
  p_preferred_day smallint, p_window_start time, p_window_end time, p_duration_minutes integer,
  p_starts_on date, p_block_size smallint
) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.series;
begin
  select * into s from public.series where customer_id = p_customer and client_request_id = p_request_id;
  if not found then
    return null;
  end if;
  if (s.property_id, s.frequency, s.preferred_day, s.window_start, s.window_end, s.duration_minutes, s.starts_on, s.block_size)
     is distinct from (p_property, p_frequency, p_preferred_day, p_window_start, p_window_end, p_duration_minutes, p_starts_on, p_block_size) then
    raise exception 'That booking was already made with different details. Start the booking again.' using errcode = 'PC028';
  end if;
  return s.id;
end $$;

create function public.book_series(
  p_property uuid,
  p_frequency public.series_frequency,
  p_preferred_day smallint,
  p_window_start time,
  p_window_end time,
  p_duration_minutes integer,
  p_starts_on date,
  p_block_size smallint,
  p_request_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  st public.settings;
  pr public.properties;
  prev public.series;
  fr_cleaner uuid;
  hub_opens timestamptz := now();
  new_id uuid;
  new_first date;
  new_last date;
begin
  if me is null or private.my_role() is distinct from 'customer' then
    raise exception 'Only customers can book a clean' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'A booking request id is required' using errcode = '22004';
  end if;

  -- Same request again (a double tap, a retry in bad signal): the same series, nothing new.
  new_id := private.replayed_booking(me, p_request_id, p_property, p_frequency, p_preferred_day,
                                     p_window_start, p_window_end, p_duration_minutes, p_starts_on, p_block_size);
  if new_id is not null then
    return new_id;
  end if;

  if not coalesce(private.settings_ready(), false) then
    raise exception 'Booking isn''t open yet' using errcode = 'PC020';
  end if;
  select * into st from public.settings where id;

  -- Lock the home: two bookings for it are made one after the other, so the overlap check
  -- below sees the first before the second is made.
  select * into pr from public.properties where id = p_property and customer_id = me for update;
  if not found then
    raise exception 'That home isn''t on your account' using errcode = 'PC021';
  end if;
  -- A double tap that waited on the lock: the first tap's series is there now.
  new_id := private.replayed_booking(me, p_request_id, p_property, p_frequency, p_preferred_day,
                                     p_window_start, p_window_end, p_duration_minutes, p_starts_on, p_block_size);
  if new_id is not null then
    return new_id;
  end if;

  if not (pr.postcode_district = any (st.launch_districts)) then
    raise exception 'We don''t clean in % yet', pr.postcode_district using errcode = 'PC022';
  end if;
  if p_duration_minutes is null or p_duration_minutes < st.min_booking_minutes
     or p_duration_minutes % 30 <> 0 or p_duration_minutes < 60 or p_duration_minutes > 600 then
    raise exception 'That length of clean isn''t available' using errcode = 'PC023';
  end if;
  if p_starts_on is null or p_starts_on <= private.london_today() then
    raise exception 'The first clean has to be after today' using errcode = 'PC024';
  end if;
  if p_block_size is null or p_block_size not between 1 and 8 then
    raise exception 'A booking is 1 to 8 cleans' using errcode = 'PC025';
  end if;
  if p_frequency is null or p_preferred_day is null or p_preferred_day not between 1 and 7
     or p_window_start is null or p_window_end is null or p_window_end <= p_window_start
     or p_window_end - p_window_start < make_interval(mins => p_duration_minutes) then
    raise exception 'That day or time isn''t valid' using errcode = 'PC026';
  end if;

  -- One block at a time per home: refuse if a live block's dates overlap this one's.
  -- A rebook for after the current block (or after it has ended) is fine.
  new_first := private.block_first_date(p_starts_on, p_preferred_day);
  new_last := new_first + private.cadence_days(p_frequency) * (p_block_size - 1);
  if exists (
    select 1 from public.series s
    where s.property_id = pr.id
      and s.status in ('offering', 'unclaimed', 'claimed', 'paused')
      and private.block_first_date(s.starts_on, s.preferred_day) <= new_last
      and s.ends_on >= new_first
  ) then
    raise exception 'You already have cleans booked at this home on those dates' using errcode = 'PC027';
  end if;

  -- Rebooking: the latest earlier block at this home that a cleaner held.
  select * into prev from public.series
  where property_id = pr.id and customer_id = me and cleaner_id is not null
  order by created_at desc, id
  limit 1;
  if prev.id is not null and st.rebook_first_refusal_minutes is not null
     and private.cleaner_fits(prev.cleaner_id, pr.postcode_district, p_preferred_day) then
    fr_cleaner := prev.cleaner_id;
    hub_opens := now() + make_interval(mins => st.rebook_first_refusal_minutes);
  end if;

  insert into public.series (property_id, customer_id, frequency, preferred_day, window_start, window_end,
                             duration_minutes, price_per_hour_pence, commission_type, commission_value,
                             status, starts_on, block_size, offering_since, client_request_id,
                             rebook_of, first_refusal_cleaner_id)
  values (pr.id, me, p_frequency, p_preferred_day, p_window_start, p_window_end,
          p_duration_minutes, st.price_per_hour_pence, st.commission_type, st.commission_value,
          'offering', p_starts_on, p_block_size, hub_opens, p_request_id,
          prev.id, fr_cleaner)
  returning id into new_id;
  return new_id;
end $$;

-- ---------------------------------------------------------------- access
revoke all on function private.cadence_days(public.series_frequency) from public;
revoke all on function private.block_first_date(date, smallint) from public;
revoke all on function private.next_cadence_after(date, integer, date) from public;
revoke all on function private.set_block_end() from public;
revoke all on function private.cleaner_fits(uuid, text, smallint) from public;
revoke all on function private.eligible_cleaners(uuid) from public;
revoke all on function private.end_block_if_done(uuid) from public;
revoke all on function private.close_stale_visits() from public;
revoke all on function private.hand_over_visits(uuid, uuid) from public;
revoke all on function private.replayed_booking(uuid, uuid, uuid, public.series_frequency, smallint, time, time, integer, date, smallint) from public;
revoke all on function public.claim_series(uuid) from public, anon;
revoke all on function public.admin_assign_series(uuid, uuid) from public, anon;
grant execute on function public.claim_series(uuid), public.admin_assign_series(uuid, uuid) to authenticated;
-- The ends_on trigger runs as whoever writes the series: the security-definer functions
-- here, or the server with the service role. Signed-in users can't write series at all.
grant execute on function private.cadence_days(public.series_frequency), private.block_first_date(date, smallint)
  to service_role;

revoke all on function public.job_board() from public, anon;
revoke all on function public.book_series(uuid, public.series_frequency, smallint, time, time, integer, date, smallint, uuid) from public, anon;
grant execute on function public.job_board() to authenticated;
grant execute on function public.book_series(uuid, public.series_frequency, smallint, time, time, integer, date, smallint, uuid) to authenticated;
