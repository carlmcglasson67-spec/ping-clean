-- Ping Clean: payments PR 11, cancelling a clean and the late-cancellation fee (payments plan
-- signed off by Carl on 8 Nov 2026, step 5, C2 to C4, appendix A;
-- intent/payments/late-cancel-plan.md). TEST mode only. No new tables or columns.
--
--   cancel_visit_quote(visit)        the customer: what cancelling this clean would cost, now
--   cancel_visit(visit, fee shown)   the customer: cancel it, at the fee they were shown
--
-- A fee is a payment row of kind 'late_cancel' on the cancelled clean. The charge job, the
-- customer's pay page, the unpaid-booking check and the payout trigger are taught that kind;
-- nothing else about them changes.

alter table public.engine_alerts drop constraint engine_alerts_kind_check;
alter table public.engine_alerts add constraint engine_alerts_kind_check
  check (kind in ('release_failed', 'generate_failed', 'visit_needs_cover', 'visit_no_show', 'visit_unfinished',
                  'block_overlap', 'block_stalled', 'block_closed',
                  'charge_held', 'charge_blocked', 'payment_needs_customer', 'payment_failed',
                  'payout_failed', 'payout_stuck',
                  'refund_failed', 'refund_after_payout', 'payment_disputed',
                  'visit_cancelled_late'));

-- ---------------------------------------------------------------- what cancelling costs
-- Late = less notice than settings.cancel_notice_hours before the clean's window opens (London
-- time). No notice period set: never late. A fee applies only when it's late, a cleaner holds
-- the clean (C4), and Carl has set a fee and how it's split. Never more than the clean's price.
-- Cleaner's part = fee × share, rounded down; Ping takes the rest (appendix A).
create function private.late_cancel_terms(
  p_visit uuid, out late boolean, out fee_pence integer, out cleaner_pence integer, out ping_pence integer, out free_until timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.visits;
  st public.settings;
  starts timestamptz;
begin
  select * into v from public.visits where id = p_visit;
  select * into st from public.settings limit 1;
  starts := (v.scheduled_date + v.window_start) at time zone 'Europe/London';
  free_until := case when st.cancel_notice_hours is null then starts else starts - st.cancel_notice_hours * interval '1 hour' end;
  late := st.cancel_notice_hours is not null and now() > free_until;
  fee_pence := 0; cleaner_pence := 0; ping_pence := 0;
  if late and v.cleaner_id is not null and v.price_pence > 0
     and coalesce(st.late_cancel_fee_pence, 0) > 0 and st.late_cancel_split is not null then
    fee_pence := least(st.late_cancel_fee_pence, v.price_pence);
    cleaner_pence := case st.late_cancel_split
      when 'same_as_clean' then floor(fee_pence::numeric * v.cleaner_earnings_pence / v.price_pence)::integer
      else floor(fee_pence::numeric * st.late_cancel_cleaner_share_bps / 10000)::integer end;
    ping_pence := fee_pence - cleaner_pence;
  end if;
end $$;
revoke all on function private.late_cancel_terms(uuid) from public, anon, authenticated;

-- What the customer is shown before they confirm. Their own clean only.
--   can_cancel false: not theirs to cancel now (already started, done, cancelled, or in the past).
create function public.cancel_visit_quote(p_visit uuid)
returns table (can_cancel boolean, late boolean, fee_pence integer, free_until timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v public.visits;
  t record;
begin
  select * into v from public.visits where id = p_visit and customer_id = me;
  if not found then
    raise exception 'That clean isn''t yours' using errcode = 'PC030';
  end if;
  select * into t from private.late_cancel_terms(v.id);
  can_cancel := v.status = 'scheduled' and now() < (v.scheduled_date + v.window_start) at time zone 'Europe/London';
  late := t.late; fee_pence := t.fee_pence; free_until := t.free_until;
  return next;
end $$;

-- Cancels one clean. p_shown_fee_pence is the fee the customer saw: if the real fee is now
-- different (they waited past the cut-off, or the setting changed), nothing happens and they
-- are shown the new figure (PC031). The clean is never deleted and isn't replaced.
create function public.cancel_visit(p_visit uuid, p_shown_fee_pence integer) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  v public.visits;
  t record;
  pid uuid := gen_random_uuid();
begin
  if (select private.my_role()) is distinct from 'customer' then
    raise exception 'Only the customer can cancel their clean' using errcode = '42501';
  end if;
  select * into v from public.visits where id = p_visit and customer_id = me for update;
  if not found then
    raise exception 'That clean isn''t yours' using errcode = 'PC030';
  end if;
  if v.status <> 'scheduled' or now() >= (v.scheduled_date + v.window_start) at time zone 'Europe/London' then
    raise exception 'That clean can''t be cancelled now' using errcode = 'PC030';
  end if;
  select * into t from private.late_cancel_terms(v.id);
  if t.fee_pence is distinct from coalesce(p_shown_fee_pence, -1) then
    raise exception 'The cost of cancelling has changed' using errcode = 'PC031';
  end if;

  perform set_config('app.actor', 'customer:' || me, true);
  update public.visits
     set status = 'cancelled', cancelled_at = now(), cancelled_by = me,
         cancel_reason = case when t.late then 'customer_late' else 'customer' end,
         late_cancel_fee_pence = t.fee_pence
   where id = v.id;
  if t.fee_pence > 0 then
    insert into public.payments (id, visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, kind, idempotency_key)
    values (pid, v.id, me, t.fee_pence, t.ping_pence, t.cleaner_pence, 'late_cancel', 'payment:' || pid);
  end if;
  if t.late and v.cleaner_id is not null then
    insert into public.engine_alerts (kind, series_id, visit_id, message)
    values ('visit_cancelled_late', v.series_id, v.id,
            'The customer cancelled this clean at short notice. The cleaner sees it in their app, but nothing texts them: let them know.'
            || case when t.fee_pence > 0 then ' The late-cancellation fee is being charged.' else '' end);
  end if;
  return case when t.fee_pence > 0 then 'cancelled_with_fee' when t.late then 'cancelled_late' else 'cancelled' end;
end $$;

revoke all on function public.cancel_visit_quote(uuid), public.cancel_visit(uuid, integer) from public, anon;
grant execute on function public.cancel_visit_quote(uuid), public.cancel_visit(uuid, integer) to authenticated;

-- ---------------------------------------------------------------- a fee is the fee on its clean
-- As before for a clean's own charge. A late-cancellation fee must be exactly the fee recorded
-- on a clean the customer cancelled late (or the office marked "couldn't get in").
create or replace function private.check_payment_matches_visit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v public.visits;
begin
  select * into v from public.visits where id = new.visit_id;
  if new.kind = 'late_cancel' then
    if v.status <> 'cancelled' or v.cancel_reason not in ('customer_late', 'no_access')
       or v.late_cancel_fee_pence <= 0 or new.amount_pence <> v.late_cancel_fee_pence
       or new.amount_pence > v.price_pence or new.customer_id <> v.customer_id then
      raise exception 'A late-cancellation fee must be the fee on its cancelled clean' using errcode = 'PC044';
    end if;
    return null;
  end if;
  if new.amount_pence <> v.price_pence
     or new.cleaner_amount_pence <> v.cleaner_earnings_pence
     or new.application_fee_pence <> v.ping_fee_pence then
    raise exception 'A charge for a clean must be the clean''s price and split' using errcode = 'PC044';
  end if;
  return null;
end $$;


-- ---------------------------------------------------------------- a paid fee → the cleaner's earnings
-- As PR 9, and now for a paid late-cancellation fee too (the check period runs from the payment).
create or replace function private.payout_for_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v public.visits;
  hours integer;
begin
  if new.cleaner_amount_pence <= 0 then return null; end if;
  select * into v from public.visits where id = new.visit_id;
  if v.cleaner_id is null then return null; end if;
  if new.kind = 'visit' and v.status <> 'completed' then return null; end if;
  if new.kind = 'late_cancel' and v.status <> 'cancelled' then return null; end if;
  select dispute_window_hours into hours from public.settings limit 1;
  if hours is null then return null; end if;
  insert into public.payouts (visit_id, cleaner_id, payment_id, amount_pence, available_after, idempotency_key)
  values (v.id, v.cleaner_id, new.id, new.cleaner_amount_pence,
          coalesce(v.completed_at, now()) + hours * interval '1 hour', 'payout:' || new.id)
  on conflict do nothing;
  return null;
end $$;

-- ---------------------------------------------------------------- the charge job takes fees too
create or replace function public.charge_claim(p_limit integer default 10)
returns table (payment_id uuid, mode text, visit_id uuid, amount_pence integer, application_fee_pence integer,
               stripe_customer_id text, payment_method_id text, cleaner_account_id text, payment_intent_id text,
               attempt integer, idempotency_key text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
  v public.visits;
  v_customer text;
  v_card text;
  v_account text;
begin
  perform set_config('app.actor', 'job:charge-visits', true);
  perform private.expire_unconfirmed_payments();

  -- A try that was claimed but never reached Stripe, too old to send again safely
  -- (Stripe forgets an idempotency key after 24 hours): a person looks at it.
  perform private.payment_alert('charge_blocked', s.visit_id,
            'A charge for this clean got stuck before it reached Stripe. Check Stripe, then tell the main session.')
  from public.payments s
  where s.status = 'processing' and s.stripe_payment_intent_id is null
    and s.charge_started_at < now() - interval '23 hours';

  for p in
    select pay.* from public.payments pay
    where pay.kind in ('visit', 'late_cancel')
      and ((pay.status = 'pending' and (pay.next_retry_at is null or pay.next_retry_at <= now()))
        or (pay.status in ('failed', 'failed_final') and pay.next_retry_at <= now())
        or (pay.status = 'processing' and pay.charge_started_at < now() - interval '10 minutes'
            and (pay.stripe_payment_intent_id is not null or pay.charge_started_at > now() - interval '23 hours')))
    order by pay.created_at
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update of pay skip locked
  loop
    <<one_row>>
    begin
      if p.status = 'processing' and p.stripe_payment_intent_id is not null then
        update public.payments set charge_started_at = clock_timestamp() where id = p.id;
        payment_id := p.id; mode := 'check'; visit_id := p.visit_id; amount_pence := p.amount_pence;
        application_fee_pence := p.application_fee_pence; stripe_customer_id := null; payment_method_id := null;
        cleaner_account_id := p.cleaner_account_id; payment_intent_id := p.stripe_payment_intent_id;
        attempt := p.attempts; idempotency_key := p.idempotency_key;
        return next;
        exit one_row;
      end if;

      select * into v from public.visits where id = p.visit_id;
      select b.stripe_customer_id, coalesce(b.default_payment_method_id, sb.stripe_payment_method_id)
        into v_customer, v_card
        from public.visits vv
        left join private.customer_billing b on b.customer_id = vv.customer_id
        left join public.series_billing sb on sb.series_id = vv.series_id
       where vv.id = p.visit_id;

      -- Where the money goes is fixed the first time the charge is sent: the cleaner who did
      -- the clean. Their account must still be able to take it; if not, that isn't the
      -- customer's fault, so the charge waits (an hour at a time) and the team is told.
      v_account := p.cleaner_account_id;
      if v_account is null then
        if v.cleaner_id is null or not private.cleaner_payable(v.cleaner_id) then
          update public.payments set next_retry_at = now() + interval '1 hour' where id = p.id;
          perform private.payment_alert('charge_blocked', p.visit_id,
            'The cleaner''s Stripe account can''t take payments right now, so the customer hasn''t been charged. Ask the cleaner to finish their payments set-up.');
          exit one_row;
        end if;
        select c.stripe_account_id into v_account from public.cleaners c where c.id = v.cleaner_id;
      end if;

      if p.status = 'processing' then
        -- Claimed before, never answered, no PaymentIntent recorded: send the same request
        -- again. Same key, so Stripe returns the same PaymentIntent if it did get there.
        update public.payments set charge_started_at = clock_timestamp() where id = p.id;
      elsif v_customer is null or v_card is null then
        -- No saved card: a failed try, on the same schedule as a declined card.
        update public.payments set attempts = attempts + 1 where id = p.id;
        perform private.payment_failed_now(p.id, 'no_saved_card');
        exit one_row;
      else
        update public.payments
           set status = 'processing', attempts = attempts + 1, charge_started_at = clock_timestamp(),
               next_retry_at = null, cleaner_account_id = v_account
         where id = p.id
        returning * into p;
      end if;

      payment_id := p.id;
      mode := case when p.stripe_payment_intent_id is null then 'create' else 'retry' end;
      visit_id := p.visit_id; amount_pence := p.amount_pence; application_fee_pence := p.application_fee_pence;
      stripe_customer_id := v_customer; payment_method_id := v_card; cleaner_account_id := v_account;
      payment_intent_id := p.stripe_payment_intent_id; attempt := p.attempts; idempotency_key := p.idempotency_key;
      return next;
    exception when others then
      -- One bad row never stops the run: it is set aside for an hour and the team is told.
      update public.payments set next_retry_at = now() + interval '1 hour'
       where id = p.id and status in ('pending', 'failed', 'failed_final');
      perform private.payment_alert('charge_blocked', p.visit_id,
        'This clean''s charge couldn''t be prepared (' || sqlstate || '). Nothing was charged. Tell the main session.');
    end;
  end loop;
end $$;

create or replace function private.charges_due() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.payments pay
    where pay.kind in ('visit', 'late_cancel')
      and ((pay.status = 'pending' and (pay.next_retry_at is null or pay.next_retry_at <= now()))
        or (pay.status in ('failed', 'failed_final', 'requires_action') and pay.next_retry_at <= now())
        or (pay.status = 'processing' and pay.charge_started_at < now() - interval '10 minutes')))
    or exists (
    select 1 from private.customer_notices c
    where c.sent_at is null and c.attempts < 5
      and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes'))
$$;

create or replace function private.expire_unconfirmed_payments() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
  n integer := 0;
begin
  for p in select * from public.payments
           where kind in ('visit', 'late_cancel') and status = 'requires_action' and next_retry_at <= now()
           for update skip locked loop
    perform private.payment_failed_now(p.id, 'authentication_not_completed', true);
    perform private.settle_payment_alerts(p.visit_id, array['payment_needs_customer']);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- the customer can pay a failed fee themselves

create or replace function public.customer_pay_begin(p_payment uuid, p_customer uuid)
returns table (problem text, payment_id uuid, mode text, visit_id uuid, amount_pence integer, application_fee_pence integer,
               stripe_customer_id text, payment_method_id text, cleaner_account_id text, payment_intent_id text,
               attempt integer, idempotency_key text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
  v public.visits;
  v_customer text;
  v_card text;
  v_account text;
begin
  perform set_config('app.actor', 'customer-pay', true);
  select * into p from public.payments pay
   where pay.id = p_payment and pay.customer_id = p_customer and pay.kind in ('visit', 'late_cancel') for update;
  if not found then problem := 'not_found'; return next; return; end if;
  if p.status in ('succeeded', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost') then
    problem := 'already_paid'; return next; return;
  end if;
  if p.status in ('pending', 'processing') then problem := 'in_progress'; return next; return; end if;
  if p.customer_tries >= 10 then problem := 'too_many'; return next; return; end if;

  select * into v from public.visits where id = p.visit_id;
  select b.stripe_customer_id, coalesce(b.default_payment_method_id, sb.stripe_payment_method_id)
    into v_customer, v_card
    from public.visits vv
    left join private.customer_billing b on b.customer_id = vv.customer_id
    left join public.series_billing sb on sb.series_id = vv.series_id
   where vv.id = p.visit_id;
  if v_customer is null or v_card is null then problem := 'no_card'; return next; return; end if;

  v_account := p.cleaner_account_id;
  if v_account is null then
    if v.cleaner_id is null or not private.cleaner_payable(v.cleaner_id) then
      problem := 'not_ready'; return next; return;
    end if;
    select c.stripe_account_id into v_account from public.cleaners c where c.id = v.cleaner_id;
  end if;

  update public.payments
     set status = 'processing', customer_tries = customer_tries + 1, charge_started_at = clock_timestamp(),
         next_retry_at = null, cleaner_account_id = v_account
   where id = p.id
  returning * into p;

  problem := null; payment_id := p.id;
  mode := case when p.stripe_payment_intent_id is null then 'create' else 'retry' end;
  visit_id := p.visit_id; amount_pence := p.amount_pence; application_fee_pence := p.application_fee_pence;
  stripe_customer_id := v_customer; payment_method_id := v_card; cleaner_account_id := v_account;
  -- `attempt` only makes the Stripe idempotency key for confirming again
  -- (payment:<id>:confirm:<attempt>): 100 and up, so it can never collide with an automatic try.
  payment_intent_id := p.stripe_payment_intent_id; attempt := 100 + p.customer_tries; idempotency_key := p.idempotency_key;
  return next;
end $$;

create or replace function public.customer_payment_intent(p_payment uuid, p_customer uuid) returns text
language sql stable security definer set search_path = '' as $$
  select stripe_payment_intent_id from public.payments
  where id = p_payment and customer_id = p_customer and kind in ('visit', 'late_cancel')
$$;

-- ---------------------------------------------------------------- an unpaid fee stops the next booking too (PC029)
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
             where p.customer_id = me and p.kind in ('visit', 'late_cancel') and p.status in ('failed_final', 'requires_action')) then
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
