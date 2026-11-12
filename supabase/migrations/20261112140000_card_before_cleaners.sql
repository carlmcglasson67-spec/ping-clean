-- Ping Clean: a block isn't offered to cleaners until the customer has saved a card
-- (security review 12 Nov 2026, finding 2; the open decision from PR #42; ping-money-rules 4:
-- "Card is saved at booking"). Stripe TEST mode only. No new tables or columns.
--
-- Before: a block went out the moment it was booked. A cleaner could take it and do the
-- first clean with no card to charge, and work unpaid. Now, until a card is saved:
--   * no offers are made and the block isn't on the job board, so it can't be claimed;
--   * the office can't assign it either (PC007);
--   * the tier windows and the "nobody's taken it" alert haven't started: they count from the
--     moment the card is saved, so the customer's delay doesn't use up the top cleaners' head start.
-- And a customer with a payment still unpaid can't book another block (PC029).

-- The same test the charge job uses to find a card: this block's, or the customer's own.
create function private.series_has_card(p_series uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.series s
    left join public.series_billing sb on sb.series_id = s.id
    left join private.customer_billing b on b.customer_id = s.customer_id
    where s.id = p_series and b.stripe_customer_id is not null
      and coalesce(b.default_payment_method_id, sb.stripe_payment_method_id) is not null)
$$;
revoke all on function private.series_has_card(uuid) from public, anon, authenticated;


-- Offers, the job board and claiming all go by this, so the rule lives here once.
create or replace function private.eligible_cleaners(p_series uuid)
returns table (cleaner_id uuid, tier public.cleaner_tier, first_refusal boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.tier, false
  from public.series s
  join public.properties pr on pr.id = s.property_id
  join public.cleaners c on pr.postcode_district = any (c.areas)
  where s.id = p_series
    and c.tier = any (private.open_tiers(p_series))
    and private.cleaner_fits(c.id, pr.postcode_district, s.preferred_day)
    and private.cleaner_payable(c.id)
    and private.series_has_card(s.id)
  union all
  select c.id, c.tier, true
  from public.series s
  join public.properties pr on pr.id = s.property_id
  join public.cleaners c on c.id = s.first_refusal_cleaner_id
  where s.id = p_series
    and s.status = 'offering'
    and now() < s.offering_since
    and private.cleaner_fits(c.id, pr.postcode_district, s.preferred_day)
    and private.cleaner_payable(c.id)
    and private.series_has_card(s.id)
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

  -- A block on the board with no cleans left to give (they've all happened or been missed,
  -- or the next block at the same home starts first) can never be taken: close it, so it
  -- doesn't sit on the board for ever and lock the customer out of booking that home.
  if private.block_capacity(s.id) = 0 then
    perform private.close_block(s.id, null,
      'This block had no cleans left to give, so it has been closed. ' || private.block_tally(s.id)
      || ' Check with the customer whether they want to book again.');
    offers_created := 0;
    now_unclaimed := false;
    return;
  end if;

  -- No card yet: nothing goes out, and nobody is told it's unclaimed. The clock starts when
  -- the card is saved (stripe_card_saved moves offering_since).
  if not private.series_has_card(s.id) then
    offers_created := 0;
    now_unclaimed := false;
    return;
  end if;

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

-- As 20261108120000_card_saving.sql, plus: the first card starts the offer clock.
create or replace function public.stripe_card_saved(
  p_series uuid, p_stripe_customer text, p_payment_method text,
  p_brand text, p_last4 text, p_exp_month smallint, p_exp_year smallint
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.series;
  linked text;
  had_card boolean;
begin
  perform set_config('app.actor', 'stripe-webhook', true);
  select * into s from public.series where id = p_series;
  if not found or s.status = 'ended' then
    return 'no_series';
  end if;
  select stripe_customer_id into linked from private.customer_billing where customer_id = s.customer_id for update;
  if linked is distinct from p_stripe_customer then
    return 'mismatch';
  end if;
  had_card := private.series_has_card(s.id);
  insert into public.series_billing (series_id, stripe_payment_method_id)
  values (s.id, p_payment_method)
  on conflict (series_id) do update set stripe_payment_method_id = excluded.stripe_payment_method_id;
  -- The newest card is the customer's card from now on (one card per customer, C13).
  update private.customer_billing
     set default_payment_method_id = p_payment_method, card_brand = left(p_brand, 20), card_last4 = p_last4,
         card_exp_month = p_exp_month, card_exp_year = p_exp_year
   where customer_id = s.customer_id;
  -- The first card: the customer's blocks that were waiting for one go out to cleaners now,
  -- with the full tier windows ahead of them. (A first-refusal window still in the future is kept.)
  if not had_card then
    update public.series set offering_since = greatest(offering_since, now())
     where customer_id = s.customer_id and status = 'offering' and offering_since is not null;
  end if;
  return 'saved';
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
  if not private.cleaner_payable(p_cleaner) then
    raise exception 'That cleaner hasn''t finished setting up payments' using errcode = 'PC006';
  end if;
  if not private.series_has_card(s.id) then
    raise exception 'The customer hasn''t saved a card for this block yet' using errcode = 'PC007';
  end if;
  if private.block_capacity(s.id) = 0 then
    raise exception 'That job can''t go ahead on its dates any more' using errcode = 'PC004';
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
  perform private.generate_visits_for_series(s.id, null);  -- the whole block, now
end $$;

-- As 20261107090000_blocks.sql, plus the unpaid check (PC029).
create or replace function public.book_series(
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

  -- A clean still unpaid (every try failed, or the bank is waiting on them): no new block
  -- until it's sorted, so an unpaid block can't simply be followed by another.
  if exists (select 1 from public.payments p
             where p.customer_id = me and p.kind = 'visit' and p.status in ('failed_final', 'requires_action')) then
    raise exception 'There''s a payment to sort out before booking again' using errcode = 'PC029';
  end if;

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

  -- One block at a time per home. While a block there is still waiting for a cleaner, no
  -- new one: its dates aren't settled (a late claim moves it later).
  if exists (select 1 from public.series s where s.property_id = pr.id and s.status in ('offering', 'unclaimed')) then
    raise exception 'You already have cleans booked at this home on those dates' using errcode = 'PC027';
  end if;
  -- And a held block's dates mustn't overlap this one's. A rebook for after the current
  -- block (or after it has ended) is fine.
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
exception when unique_violation then
  -- The same request id raced in on another connection for a different home (the home
  -- locks above don't serialise those). Answer as a replay: that series, or PC028.
  new_id := private.replayed_booking(me, p_request_id, p_property, p_frequency, p_preferred_day,
                                     p_window_start, p_window_end, p_duration_minutes, p_starts_on, p_block_size);
  if new_id is null then
    raise;
  end if;
  return new_id;
end $$;
