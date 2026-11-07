-- Ping Clean V1 — 3/7 Settings, properties, series, visits, job offers.

-- ---------------------------------------------------------------- settings
-- One row. Every number the marketplace runs on lives here, set by an admin.
-- They start empty on purpose: the open questions in intent/v1/spec.md decide them,
-- and booking refuses to run until they are filled (private.settings_ready()).
create table public.settings (
  id boolean primary key default true check (id),
  price_per_hour_pence integer check (price_per_hour_pence > 0),
  min_booking_minutes integer check (min_booking_minutes > 0 and min_booking_minutes % 30 = 0),
  commission_type public.commission_type,
  -- percent: basis points (2500 = 25%). per_hour: pence per hour.
  commission_value integer check (commission_value >= 0),
  top_window_minutes integer check (top_window_minutes >= 0),
  approved_window_minutes integer check (approved_window_minutes >= 0),
  unclaimed_alert_minutes integer check (unclaimed_alert_minutes > 0),
  cancel_notice_hours integer check (cancel_notice_hours >= 0),
  late_cancel_fee_pence integer check (late_cancel_fee_pence >= 0),
  late_cancel_cleaner_share_bps integer check (late_cancel_cleaner_share_bps between 0 and 10000),
  dispute_window_hours integer check (dispute_window_hours >= 0),
  launch_districts text[] not null default '{}' check (private.valid_districts(launch_districts)),
  updated_at timestamptz not null default now(),
  constraint settings_percent_cap check (commission_type <> 'percent' or commission_value <= 10000)
);
alter table public.settings enable row level security;
insert into public.settings (id) values (true);

create trigger settings_touch before update on public.settings
  for each row execute function private.touch_updated_at();
create trigger settings_audit after update on public.settings
  for each row execute function private.audit_row();

revoke all on public.settings from anon, authenticated;
grant select on public.settings to authenticated;
grant update (price_per_hour_pence, min_booking_minutes, commission_type, commission_value,
              top_window_minutes, approved_window_minutes, unclaimed_alert_minutes,
              cancel_notice_hours, late_cancel_fee_pence, late_cancel_cleaner_share_bps,
              dispute_window_hours, launch_districts) on public.settings to authenticated;

create policy settings_admin_read on public.settings
  for select to authenticated using ((select private.is_admin()));
create policy settings_admin_write on public.settings
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create function private.settings_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select price_per_hour_pence is not null and min_booking_minutes is not null
     and commission_type is not null and commission_value is not null
     and top_window_minutes is not null and approved_window_minutes is not null
     and unclaimed_alert_minutes is not null and dispute_window_hours is not null
     and cardinality(launch_districts) > 0
  from public.settings where id
$$;

-- What the public site may show: the customer price and minimum, nothing internal.
create function public.public_pricing()
returns table (price_per_hour_pence integer, min_booking_minutes integer, launch_districts text[], ready boolean)
language sql stable security definer set search_path = '' as $$
  select s.price_per_hour_pence, s.min_booking_minutes, s.launch_districts, private.settings_ready()
  from public.settings s where s.id
$$;
revoke all on function public.public_pricing() from public;
grant execute on function public.public_pricing() to anon, authenticated;

-- The single definition of how a visit's price splits. lib/money/split.ts mirrors
-- it exactly and both are tested against the same cases.
--   price    = hourly price x minutes / 60, rounded half up to the penny
--   fee      = percent: price x bps / 10000, half up | per_hour: value x minutes / 60, half up
--   fee is capped at price; earnings = price - fee
create function private.split_visit_price(
  price_per_hour_pence integer,
  duration_minutes integer,
  commission public.commission_type,
  commission_value integer,
  out price_pence integer,
  out ping_fee_pence integer,
  out cleaner_earnings_pence integer
)
language plpgsql immutable set search_path = '' as $$
begin
  if price_per_hour_pence is null or duration_minutes is null or commission is null or commission_value is null then
    raise exception 'Pricing settings are incomplete' using errcode = '22004';
  end if;
  if price_per_hour_pence < 0 or duration_minutes <= 0 or commission_value < 0 then
    raise exception 'Pricing inputs must be positive' using errcode = '22003';
  end if;
  price_pence := ((price_per_hour_pence::bigint * duration_minutes + 30) / 60)::integer;
  if commission = 'percent' then
    ping_fee_pence := ((price_pence::bigint * commission_value + 5000) / 10000)::integer;
  else
    ping_fee_pence := ((commission_value::bigint * duration_minutes + 30) / 60)::integer;
  end if;
  ping_fee_pence := least(ping_fee_pence, price_pence);
  cleaner_earnings_pence := price_pence - ping_fee_pence;
end $$;
revoke all on function private.split_visit_price(integer, integer, public.commission_type, integer) from public;
grant execute on function private.split_visit_price(integer, integer, public.commission_type, integer) to authenticated, service_role;

-- ---------------------------------------------------------------- properties
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  address_line1 text not null check (char_length(address_line1) between 1 and 120),
  address_line2 text check (char_length(address_line2) <= 120),
  town text not null check (char_length(town) between 1 and 60),
  -- Stored normalised: upper case with one space, e.g. "CA14 3XX".
  postcode text not null check (postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'),
  postcode_district text generated always as (split_part(postcode, ' ', 1)) stored,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  bedrooms smallint not null check (bedrooms between 0 and 12),
  bathrooms smallint not null check (bathrooms between 0 and 12),
  pets text check (char_length(pets) <= 200),
  access_notes text check (char_length(access_notes) <= 1000),
  key_code text check (char_length(key_code) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, customer_id)
);
alter table public.properties enable row level security;

create index properties_customer_idx on public.properties (customer_id);
create trigger properties_touch before update on public.properties
  for each row execute function private.touch_updated_at();

revoke all on public.properties from anon;
revoke insert, update on public.properties from authenticated;
grant insert (customer_id, address_line1, address_line2, town, postcode, latitude, longitude,
              bedrooms, bathrooms, pets, access_notes, key_code) on public.properties to authenticated;
grant update (address_line1, address_line2, town, postcode, latitude, longitude,
              bedrooms, bathrooms, pets, access_notes, key_code) on public.properties to authenticated;

-- ---------------------------------------------------------------- series
create table public.series (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  customer_id uuid not null,
  cleaner_id uuid references public.cleaners (id),
  frequency public.series_frequency not null,
  preferred_day smallint not null check (preferred_day between 1 and 7),  -- ISO: Mon = 1
  window_start time not null,
  window_end time not null,
  duration_minutes integer not null check (duration_minutes between 60 and 600 and duration_minutes % 30 = 0),
  -- Snapshot of the deal at booking, so a later price change never reprices a customer silently.
  price_per_hour_pence integer not null check (price_per_hour_pence > 0),
  commission_type public.commission_type not null,
  commission_value integer not null check (commission_value >= 0),
  status public.series_status not null default 'offering',
  starts_on date not null,
  ends_on date,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (property_id, customer_id) references public.properties (id, customer_id),
  unique (id, customer_id),
  constraint series_window check (window_end > window_start),
  constraint series_claimed_has_cleaner check (status not in ('claimed', 'paused') or cleaner_id is not null),
  constraint series_open_has_no_cleaner check (status not in ('offering', 'unclaimed') or cleaner_id is null),
  constraint series_dates check (ends_on is null or ends_on >= starts_on)
);
alter table public.series enable row level security;

create index series_customer_idx on public.series (customer_id);
create index series_cleaner_idx on public.series (cleaner_id) where cleaner_id is not null;
create index series_open_idx on public.series (status) where status in ('offering', 'unclaimed');
create trigger series_touch before update on public.series
  for each row execute function private.touch_updated_at();
create trigger series_audit after insert or update on public.series
  for each row execute function private.audit_row();

-- Bookings, claims, pauses and ends all go through functions with business rules.
revoke all on public.series from anon;
revoke insert, update, delete on public.series from authenticated;

-- Stripe identifiers for a series live apart from it, so the cleaner who can read
-- the series never sees the customer's payment details. Admin read, server write.
create table public.series_billing (
  series_id uuid primary key references public.series (id) on delete cascade,
  stripe_customer_id text,
  stripe_payment_method_id text,
  updated_at timestamptz not null default now()
);
alter table public.series_billing enable row level security;
create trigger series_billing_touch before update on public.series_billing
  for each row execute function private.touch_updated_at();
-- A changed card is worth knowing about; the ids themselves stay out of the log.
create trigger series_billing_audit after insert or update on public.series_billing
  for each row execute function private.audit_row('stripe_customer_id', 'stripe_payment_method_id');
revoke all on public.series_billing from anon;
revoke insert, update, delete on public.series_billing from authenticated;
create policy series_billing_admin_read on public.series_billing
  for select to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------- visits
create table public.visits (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null,
  customer_id uuid not null,
  cleaner_id uuid references public.cleaners (id),
  scheduled_date date not null,
  window_start time not null,
  window_end time not null,
  duration_minutes integer not null check (duration_minutes > 0),
  status public.visit_status not null default 'scheduled',
  started_at timestamptz,
  completed_at timestamptz,
  price_pence integer not null check (price_pence >= 0),
  cleaner_earnings_pence integer not null check (cleaner_earnings_pence >= 0),
  ping_fee_pence integer not null check (ping_fee_pence >= 0),
  late_cancel_fee_pence integer not null default 0 check (late_cancel_fee_pence >= 0),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (series_id, scheduled_date),
  foreign key (series_id, customer_id) references public.series (id, customer_id),
  constraint visits_split_adds_up check (price_pence = cleaner_earnings_pence + ping_fee_pence),
  constraint visits_window check (window_end > window_start),
  constraint visits_completed_has_time check (status <> 'completed' or (completed_at is not null and cleaner_id is not null)),
  constraint visits_started_has_time check (status not in ('in_progress', 'completed') or started_at is not null)
);
alter table public.visits enable row level security;

create index visits_customer_idx on public.visits (customer_id, scheduled_date);
create index visits_cleaner_idx on public.visits (cleaner_id, scheduled_date) where cleaner_id is not null;
create trigger visits_touch before update on public.visits
  for each row execute function private.touch_updated_at();
create trigger visits_audit after update of status, cleaner_id, price_pence, cleaner_earnings_pence, ping_fee_pence on public.visits
  for each row execute function private.audit_row();

revoke all on public.visits from anon;
revoke insert, update, delete on public.visits from authenticated;

-- ---------------------------------------------------------------- job offers
create table public.job_offers (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id) on delete cascade,
  cleaner_id uuid not null references public.cleaners (id) on delete cascade,
  tier public.cleaner_tier not null,       -- the tier window this offer was released in
  opens_at timestamptz not null,
  expires_at timestamptz,
  status public.offer_status not null default 'pending',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (series_id, cleaner_id),
  constraint offers_window check (expires_at is null or expires_at > opens_at)
);
alter table public.job_offers enable row level security;

create index job_offers_cleaner_idx on public.job_offers (cleaner_id, status);
create unique index job_offers_one_claim on public.job_offers (series_id) where status = 'claimed';

revoke all on public.job_offers from anon;
revoke insert, update, delete on public.job_offers from authenticated;

-- ---------------------------------------------------------------- policies
-- Customers: their own properties, series and visits.
-- Cleaners: a property's address only once they hold its series (address privacy);
--           their own series, visits and offers. Open jobs reach them through the
--           job board function (later PR), which exposes town and district only.
-- Admins: everything.

create policy properties_customer_all on public.properties
  for all to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()) and (select private.my_role()) = 'customer');

-- Only while the cleaner holds the series AND is an active cleaner: a suspended
-- cleaner loses the address, access notes and key code immediately.
create policy properties_cleaner_claimed on public.properties
  for select to authenticated
  using (
    (select private.is_active_cleaner())
    and exists (
      select 1 from public.series s
      where s.property_id = properties.id
        and s.cleaner_id = (select auth.uid())
        and s.status in ('claimed', 'paused')
    )
  );

create policy properties_admin on public.properties
  for select to authenticated using ((select private.is_admin()));

create policy series_select on public.series
  for select to authenticated
  using (
    customer_id = (select auth.uid())
    or cleaner_id = (select auth.uid())
    or (select private.is_admin())
  );

create policy visits_select on public.visits
  for select to authenticated
  using (
    customer_id = (select auth.uid())
    or cleaner_id = (select auth.uid())
    or (select private.is_admin())
  );

create policy job_offers_select on public.job_offers
  for select to authenticated
  using (cleaner_id = (select auth.uid()) or (select private.is_admin()));
