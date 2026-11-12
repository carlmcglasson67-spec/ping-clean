-- Ping Clean: fixes from the independent security review of payments PRs 6 to 8 (#39, #40,
-- #41) and card at booking (#42), 12 Nov 2026. Stripe TEST mode only. No double charge or
-- cross-customer path was found; these close four gaps before payouts are built on top.
--
--   1. A payment waiting on the customer's bank confirmation now has a deadline. Past it, it
--      counts as the last failed try: the block goes on hold like any other unpaid clean.
--      (Before: it waited for ever and the cleaner kept working unpaid.)
--      The deadline is Carl's own schedule: the time of the last automatic try
--      (payment_retry_hours), and never less than his first gap from the moment they're asked.
--   2. A block only comes back on when nothing in it is unpaid: failed, failed for good, or
--      waiting on the customer.
--   3. One payment row per clean, ever. Charging a clean by hand that already has a failed
--      payment re-queues that payment instead of making a second row (which stopped the
--      charge job for every customer when the first one's retry fell due). And one bad row
--      can no longer stop a run: it is set aside for the team.
--   4. The cleaner can no longer read why a block was held or ended. Skipped cleans say
--      'on_hold'; the block's end reason is neutral. The why stays in the admin alert.
--   5. A retry Stripe refused to take (not the card's fault) gives the customer their try
--      back and tells the team, instead of being read later as a fresh decline.
--   6. After Stripe refuses a first send, the next send uses a new Stripe key, so a changed
--      card or "Pay now" isn't rejected for a day.

-- ---------------------------------------------------------------- 4. neutral reasons
alter table public.visits drop constraint visits_cancel_reason_check;
update public.visits set cancel_reason = 'on_hold' where cancel_reason = 'payment_hold';
alter table public.visits add constraint visits_cancel_reason_check check (cancel_reason in
  ('customer', 'customer_late', 'block_ended', 'cleaner_no_show', 'no_access', 'admin', 'on_hold'));
update public.series set end_reason = 'This block was on hold and has now ended.'
 where end_reason like 'The customer''s card failed and the block was on hold%';


create or replace function private.skip_held_visits(p_series uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.visits
     set status = 'skipped', cancelled_at = now(), cancel_reason = 'on_hold'
   where series_id = p_series and status = 'scheduled' and scheduled_date < private.london_today();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- 1. a failed try, or the last word
-- As before, plus p_final: no more tries whatever the count (an unanswered bank confirmation).
drop function private.payment_failed_now(uuid, text);

create or replace function private.payment_failed_now(p_payment uuid, p_code text, p_final boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
  hours integer[];
  next_at timestamptz;
  held boolean;
begin
  select * into p from public.payments where id = p_payment for update;
  select payment_retry_hours into hours from public.settings limit 1;
  if not p_final and hours is not null and p.attempts between 1 and cardinality(hours) and p.attempts < 10 then
    next_at := greatest(p.created_at + hours[p.attempts] * interval '1 hour', now() + interval '1 hour');
  end if;
  update public.payments
     set status = 'failed', last_error_code = left(coalesce(nullif(p_code, ''), 'unknown'), 100), next_retry_at = next_at
   where id = p.id;
  if next_at is not null then
    perform private.queue_notice('payment_failed', p.id, null, 'payment_failed:' || p.id || ':' || p.attempts);
    return;
  end if;
  update public.payments set status = 'failed_final' where id = p.id;
  held := private.hold_block_for_payment(p.visit_id);
  perform private.payment_alert('payment_failed', p.visit_id,
    case when held
      then 'The customer''s card couldn''t be charged for this clean and there are no more tries left. The rest of the block is on hold until they pay; the customer has been emailed.'
      else 'The customer''s card couldn''t be charged for this clean and there are no more tries left. Contact the customer, and agree what happens to the rest of the block.'
    end);
  perform private.queue_notice(case when held then 'block_on_hold' else 'payment_failed' end, p.id, null,
                               case when held then 'block_on_hold:' else 'payment_failed_final:' end || p.id);
end $$;

revoke all on function private.payment_failed_now(uuid, text, boolean) from public, anon, authenticated;

-- When a payment the bank wants confirmed stops waiting. Null = no schedule set, so it waits
-- for the team (who already have the alert), as a failed charge does with no schedule.
create function private.confirm_by(p_created timestamptz) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(p_created + hours[cardinality(hours)] * interval '1 hour', now() + hours[1] * interval '1 hour')
  from (select payment_retry_hours as hours from public.settings limit 1) s
  where cardinality(hours) >= 1
$$;
revoke all on function private.confirm_by(timestamptz) from public, anon, authenticated;

-- Payments already waiting get the same deadline.
update public.payments set next_retry_at = private.confirm_by(created_at)
 where status = 'requires_action' and next_retry_at is null;

-- Run by the charge job before it takes what's due.
create function private.expire_unconfirmed_payments() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
  n integer := 0;
begin
  for p in select * from public.payments
           where kind = 'visit' and status = 'requires_action' and next_retry_at <= now()
           for update skip locked loop
    perform private.payment_failed_now(p.id, 'authentication_not_completed', true);
    perform private.settle_payment_alerts(p.visit_id, array['payment_needs_customer']);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.expire_unconfirmed_payments() from public, anon, authenticated;


-- ---------------------------------------------------------------- 2. back on only when nothing is unpaid
create or replace function private.release_payment_hold(p_series uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  h private.series_holds;
  s public.series;
begin
  select * into h from private.series_holds where series_id = p_series and released_at is null for update;
  if not found then return false; end if;
  if exists (select 1 from public.payments p join public.visits v on v.id = p.visit_id
             where v.series_id = p_series and p.status in ('failed', 'failed_final', 'requires_action')) then
    return false;  -- another clean in the block is still unpaid
  end if;
  select * into s from public.series where id = p_series for update;
  if s.status <> 'paused' then
    -- Ended by the team while it was on hold: the hold is over, nothing to resume.
    update private.series_holds set released_at = now(), outcome = 'ended' where id = h.id;
    return false;
  end if;
  perform private.skip_held_visits(p_series);
  update public.series set status = 'claimed' where id = p_series;
  update private.series_holds set released_at = now(), outcome = 'resumed' where id = h.id;
  perform private.end_block_if_done(p_series);
  return true;
end $$;

create or replace function private.run_payment_holds() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  h private.series_holds;
  s public.series;
  days integer;
  ended integer := 0;
begin
  perform set_config('app.actor', 'cron:payment-holds', true);
  select payment_pause_days into days from public.settings limit 1;
  for h in select * from private.series_holds where released_at is null for update skip locked loop
    select * into s from public.series where id = h.series_id for update;
    if s.status <> 'paused' then
      update private.series_holds set released_at = now(), outcome = 'ended' where id = h.id;
      continue;
    end if;
    perform private.skip_held_visits(h.series_id);
    if days is not null and h.held_at < now() - days * interval '1 day' then
      -- The cleaner can read the block's end reason, so it never says why (the team's alert does).
      perform private.close_block(h.series_id, null, 'This block was on hold and has now ended.');
      update private.series_holds set released_at = now(), outcome = 'ended' where id = h.id;
      perform private.queue_notice('block_ended_unpaid', null, h.series_id, 'block_ended_unpaid:' || h.id);
      ended := ended + 1;
    end if;
  end loop;
  return ended;
end $$;

-- ---------------------------------------------------------------- what Stripe said (as PR 7, plus the deadline)
create or replace function public.stripe_payment_result(
  p_payment uuid, p_intent text, p_outcome text, p_amount integer, p_fee integer, p_destination text,
  p_charge text, p_error text, p_event_at timestamptz
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
  stale boolean;
begin
  perform set_config('app.actor', 'stripe', true);
  if p_outcome not in ('succeeded', 'requires_action', 'failed', 'processing') or p_intent is null then
    raise exception 'Unknown payment result' using errcode = '22023';
  end if;
  select * into p from public.payments where id = p_payment for update;
  if not found then
    return 'unknown';
  end if;
  if (p.stripe_payment_intent_id is not null and p.stripe_payment_intent_id <> p_intent)
     or p_amount is distinct from p.amount_pence
     or p_fee is distinct from p.application_fee_pence
     or p.cleaner_account_id is null
     or p_destination is distinct from p.cleaner_account_id then
    perform private.payment_alert('charge_blocked', p.visit_id,
      'Stripe reported a payment that doesn''t match this clean''s charge (amount, fee or cleaner). Nothing was recorded. Check Stripe, then tell the main session.');
    return 'mismatch';
  end if;
  if p.stripe_payment_intent_id is null then
    update public.payments set stripe_payment_intent_id = p_intent where id = p.id;
  end if;

  if p_outcome = 'processing' then
    return 'ignored';
  end if;

  if p_outcome = 'succeeded' then
    if p.status not in ('pending', 'processing', 'requires_action', 'failed', 'failed_final') then
      return 'already';  -- succeeded, refunded, disputed…: never moved back
    end if;
    -- The money was taken, whatever Ping last thought: record it, along the map.
    if p.status in ('pending', 'failed', 'failed_final') then
      update public.payments set status = 'processing' where id = p.id;
    end if;
    update public.payments
       set status = 'succeeded', stripe_charge_id = coalesce(p_charge, stripe_charge_id),
           next_retry_at = null, last_error_code = null, failure_reason = null
     where id = p.id;
    perform private.settle_payment_alerts(p.visit_id, array['charge_blocked', 'payment_needs_customer', 'payment_failed']);
    perform private.release_payment_hold((select v.series_id from public.visits v where v.id = p.visit_id));
    return 'succeeded';
  end if;

  -- Bad news about an older try (Stripe says it happened before the current try was sent)
  -- must not fail the current one.
  stale := p_event_at is not null and p.charge_started_at is not null
           and p_event_at < date_trunc('second', p.charge_started_at);

  if p_outcome = 'requires_action' then
    if p.status <> 'processing' or stale then
      return 'ignored';
    end if;
    update public.payments set status = 'requires_action', last_error_code = 'authentication_required',
           next_retry_at = private.confirm_by(p.created_at) where id = p.id;
    perform private.payment_alert('payment_needs_customer', p.visit_id,
      'The customer''s bank wants them to confirm this payment. They''ve been emailed a link; nothing is retried without them. If they don''t, it counts as the last failed try.');
    perform private.queue_notice('payment_needs_confirming', p.id, null, 'payment_needs_confirming:' || p.id || ':' || p.attempts);
    return 'requires_action';
  end if;

  -- failed
  if p.status not in ('processing', 'requires_action') or stale then
    return 'ignored';
  end if;
  perform private.payment_failed_now(p.id, p_error);
  perform private.settle_payment_alerts(p.visit_id, array['payment_needs_customer']);
  return 'failed';
end $$;

-- ---------------------------------------------------------------- 3. one payment row per clean
-- Any payment for the clean, whatever its state, stops a second one being written.

create or replace function private.insert_visit_charge(p_visit uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.visits;
  pid uuid := gen_random_uuid();
  made uuid;
begin
  select * into v from public.visits where id = p_visit;
  if not found or v.status <> 'completed' or v.price_pence <= 0 then
    return null;
  end if;
  if exists (select 1 from public.payments p where p.visit_id = v.id and p.kind = 'visit') then
    return null;
  end if;
  insert into public.payments (id, visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence,
                               kind, idempotency_key)
  values (pid, v.id, v.customer_id, v.price_pence, v.ping_fee_pence, v.cleaner_earnings_pence, 'visit', 'payment:' || pid)
  on conflict (visit_id, kind) where status not in ('failed', 'failed_final') do nothing
  returning id into made;
  return made;
end $$;

create or replace function public.admin_charge_visit(p_visit uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.visits;
  made uuid;
  old public.payments;
begin
  if not private.is_admin() then
    raise exception 'Only the Ping team can charge a clean by hand' using errcode = '42501';
  end if;
  select * into v from public.visits where id = p_visit for update;
  if not found or v.status <> 'completed' then
    raise exception 'Only a completed clean can be charged' using errcode = 'PC050';
  end if;
  if v.price_pence <= 0 then
    raise exception 'That clean has nothing to charge' using errcode = 'PC050';
  end if;
  select * into old from public.payments p where p.visit_id = v.id and p.kind = 'visit'
   order by p.created_at desc limit 1 for update;
  if found then
    -- A failed charge is sent again as it is (the same row, the same PaymentIntent). Anything
    -- else is already paid, on its way, or waiting on the customer.
    if old.status not in ('failed', 'failed_final') then
      raise exception 'That clean already has a charge' using errcode = 'PC051';
    end if;
    if old.attempts >= 10 then
      raise exception 'That charge has been tried too many times. Ask the customer to pay from their account.' using errcode = 'PC051';
    end if;
    perform set_config('app.actor', 'admin:' || (select auth.uid()), true);
    update public.payments set next_retry_at = now() where id = old.id;
    return old.id;
  end if;
  made := private.insert_visit_charge(v.id);
  if made is null then
    raise exception 'That clean already has a charge' using errcode = 'PC051';
  end if;
  update public.engine_alerts set resolved_at = now(), resolved_by = (select auth.uid())
  where visit_id = v.id and kind = 'charge_held' and resolved_at is null;
  return made;
end $$;

-- ---------------------------------------------------------------- the job takes what's due (as PR 6, plus 1 and 3)
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
    where pay.kind = 'visit'
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
    where pay.kind = 'visit'
      and ((pay.status = 'pending' and (pay.next_retry_at is null or pay.next_retry_at <= now()))
        or (pay.status in ('failed', 'failed_final', 'requires_action') and pay.next_retry_at <= now())
        or (pay.status = 'processing' and pay.charge_started_at < now() - interval '10 minutes')))
    or exists (
    select 1 from private.customer_notices c
    where c.sent_at is null and c.attempts < 5
      and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes'))
$$;

-- ---------------------------------------------------------------- 6. a new Stripe key after a refused first send
create or replace function public.charge_not_sent(p_payment uuid, p_error text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
begin
  perform set_config('app.actor', 'job:charge-visits', true);
  select * into p from public.payments where id = p_payment for update;
  if not found then return 'unknown'; end if;
  if p.status <> 'processing' or p.stripe_payment_intent_id is not null then return 'ignored'; end if;
  perform private.payment_failed_now(p.id, p_error);
  -- Nothing exists at Stripe under the old key, so the next send takes a new one: Stripe
  -- refuses a key reused with different details (a new card, or the customer paying in person).
  update public.payments set idempotency_key = 'payment:' || p.id || ':c' || (p.attempts + p.customer_tries) where id = p.id;
  return 'failed';
end $$;

-- ---------------------------------------------------------------- 5. a retry Stripe wouldn't take
-- Stripe refused the request for a retry (the cleaner's account was disconnected, say): the
-- card was never asked, so the customer gets the try back, it waits an hour, and the team is
-- told. Left alone it would be read 10 minutes later as the previous decline, again.
--   'returned' | 'ignored' | 'unknown'
create function public.charge_retry_not_sent(p_payment uuid, p_error text, p_customer_try boolean) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
begin
  perform set_config('app.actor', 'job:charge-visits', true);
  select * into p from public.payments where id = p_payment for update;
  if not found then return 'unknown'; end if;
  if p.status <> 'processing' or p.stripe_payment_intent_id is null then return 'ignored'; end if;
  update public.payments
     set status = 'failed',
         -- Tried again hourly for three days from when the charge was first due; after that it
         -- waits for the team (their alert is open), who send it again with admin_charge_visit.
         next_retry_at = case when p.created_at > now() - interval '3 days' then now() + interval '1 hour' end,
         -- A new Stripe key for the next confirm: Stripe would answer a reused key with this
         -- same refusal for a day, or reject it outright if the card has changed since.
         idempotency_key = 'payment:' || p.id || ':r' || floor(extract(epoch from clock_timestamp()))::bigint,
         last_error_code = left(coalesce(nullif(p_error, ''), 'unknown'), 100),
         attempts = case when p_customer_try then attempts else greatest(attempts - 1, 0) end,
         customer_tries = case when p_customer_try then greatest(customer_tries - 1, 0) else customer_tries end
   where id = p.id;
  perform private.payment_alert('charge_blocked', p.visit_id,
    'Stripe wouldn''t take another try at this clean''s charge (not the customer''s card). Nothing was charged. Check the cleaner''s payments set-up.');
  return 'returned';
end $$;
revoke all on function public.charge_retry_not_sent(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.charge_retry_not_sent(uuid, text, boolean) to service_role;

