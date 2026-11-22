-- Ping Clean: payments follow-ups (#44), 22 Nov 2026. Stripe TEST mode only.
-- Left over from the independent review of payments PRs 6 to 8 and card at booking. None
-- allowed a wrong or double charge. Plan: intent/payments-followups/plan.md.
--
--   1. A retry lost on its way to Stripe is no longer read as a fresh decline. When the try
--      was sent is kept (try_sent_at), apart from the job's later check; a failure whose
--      latest charge is older than the try means the try never reached the card: it is given
--      back and sent again (charge_try_lost).
--   2. No "confirm your payment" email while the customer is on the pay page doing it.
--   3. A per-customer limit on the pay page's calls to Stripe, kept in the database.
--   4. The cleaner is emailed when their block goes on hold, comes back on, or ends on hold.
--      Never why.
--   5. A late card webhook can't replace a newer card (the SetupIntent's created time).

-- ---------------------------------------------------------------- 1. when the try was sent
-- Server-only, like charge_started_at: not in the column grants, so customers and cleaners
-- never read them.
alter table public.payments add column try_sent_at timestamptz;
alter table public.payments add column try_by_customer boolean not null default false;
update public.payments set try_sent_at = charge_started_at where charge_started_at is not null;

-- As 20261113100000_late_cancel.sql, plus: a sent try records when, and whose; and every row
-- says which try it is (try_sent_at), so the check's answer is only ever judged against the
-- try the check looked at.
drop function public.charge_claim(integer);
create function public.charge_claim(p_limit integer default 10)
returns table (payment_id uuid, mode text, visit_id uuid, amount_pence integer, application_fee_pence integer,
               stripe_customer_id text, payment_method_id text, cleaner_account_id text, payment_intent_id text,
               attempt integer, idempotency_key text, try_sent_at timestamptz)
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
        -- The check: when it was last asked about. try_sent_at keeps when the try itself went.
        update public.payments set charge_started_at = clock_timestamp() where id = p.id;
        payment_id := p.id; mode := 'check'; visit_id := p.visit_id; amount_pence := p.amount_pence;
        application_fee_pence := p.application_fee_pence; stripe_customer_id := null; payment_method_id := null;
        cleaner_account_id := p.cleaner_account_id; payment_intent_id := p.stripe_payment_intent_id;
        attempt := p.attempts; idempotency_key := p.idempotency_key; try_sent_at := p.try_sent_at;
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
        update public.payments as pay set charge_started_at = clock_timestamp(), try_sent_at = clock_timestamp(), try_by_customer = false
         where pay.id = p.id
        returning * into p;
      elsif v_customer is null or v_card is null then
        -- No saved card: a failed try, on the same schedule as a declined card.
        update public.payments set attempts = attempts + 1 where id = p.id;
        perform private.payment_failed_now(p.id, 'no_saved_card');
        exit one_row;
      else
        update public.payments
           set status = 'processing', attempts = attempts + 1, charge_started_at = clock_timestamp(),
               try_sent_at = clock_timestamp(), try_by_customer = false,
               next_retry_at = null, cleaner_account_id = v_account
         where id = p.id
        returning * into p;
      end if;

      payment_id := p.id;
      mode := case when p.stripe_payment_intent_id is null then 'create' else 'retry' end;
      visit_id := p.visit_id; amount_pence := p.amount_pence; application_fee_pence := p.application_fee_pence;
      stripe_customer_id := v_customer; payment_method_id := v_card; cleaner_account_id := v_account;
      payment_intent_id := p.stripe_payment_intent_id; attempt := p.attempts; idempotency_key := p.idempotency_key;
      try_sent_at := p.try_sent_at;
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

-- As 20261113100000_late_cancel.sql, plus: the customer's try records when, and that it's theirs.
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
         try_sent_at = clock_timestamp(), try_by_customer = true,
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

-- The job's check found Stripe saying "failed", and the latest charge on the PaymentIntent
-- was made at p_charge_at. If that is before the current try was sent, the try never reached
-- the card (lost on the way): it isn't counted as a decline, and the payment goes back to
-- being due. The next send always uses a NEW Stripe key (as charge_retry_not_sent does), so
-- if the lost request did reach Stripe somehow, Stripe can't replay its old answer for a day.
--   * the job's try: given back (attempts - 1) and due again now;
--   * the customer's own try: back on the schedule it was on. Their try is NOT given back
--     (customer_tries stays), so their next "Pay now" can never reuse a key either.
-- p_try_sent_at is the try the check looked at (from charge_claim): if the row has moved on to
-- a newer try since (a webhook and a fresh "Pay now" while the job was asking Stripe), it is
-- not judged. Only for three days from when the charge first fell due, so a try that keeps
-- getting lost can't go round for ever; after that it counts as a decline.
--   'returned' (due again) | 'not_lost' (record Stripe's answer as usual) | 'unknown'
create function public.charge_try_lost(p_payment uuid, p_charge_at timestamptz, p_try_sent_at timestamptz) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
begin
  perform set_config('app.actor', 'job:charge-visits', true);
  select * into p from public.payments where id = p_payment for update;
  if not found then return 'unknown'; end if;
  -- Compared to the millisecond: the time makes a round trip through JSON.
  if p.status <> 'processing' or p.stripe_payment_intent_id is null or p.try_sent_at is null
     or p_try_sent_at is null or date_trunc('milliseconds', p.try_sent_at) <> date_trunc('milliseconds', p_try_sent_at)
     or p_charge_at is null or p_charge_at >= date_trunc('second', p.try_sent_at)
     or p.created_at < now() - interval '3 days' then
    return 'not_lost';
  end if;
  update public.payments
     set idempotency_key = 'payment:' || p.id || ':l' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint
   where id = p.id;
  if p.try_by_customer then
    -- Where the schedule says (the email for this try number already went: queue_notice's
    -- dedupe stops a second).
    perform private.payment_failed_now(p.id, coalesce(p.last_error_code, 'payment_failed'));
  else
    update public.payments
       set status = 'failed', attempts = greatest(attempts - 1, 0), next_retry_at = now()
     where id = p.id;
  end if;
  return 'returned';
end $$;
revoke all on function public.charge_try_lost(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.charge_try_lost(uuid, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------- 2. what Stripe said (as payments_review_fixes, plus 1 and 2)
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
  -- must not fail the current one. Measured from when the try was sent, never from the
  -- job's later check (which moves charge_started_at).
  stale := p_event_at is not null and coalesce(p.try_sent_at, p.charge_started_at) is not null
           and p_event_at < date_trunc('second', coalesce(p.try_sent_at, p.charge_started_at));

  if p_outcome = 'requires_action' then
    if p.status <> 'processing' or stale then
      return 'ignored';
    end if;
    -- The customer pressed "Pay now" and is on the pay page doing their bank's step right now:
    -- no email telling them to do what they're doing. Left as the pay page records it; if they
    -- walk away, the job's check finds it after 10 minutes and the email and alert go then.
    if p.try_by_customer and p.try_sent_at > now() - interval '10 minutes' then
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

-- ---------------------------------------------------------------- 3. a limit on the pay page's Stripe calls
-- One row per customer and kind: the current hour's window and how many calls it has had.
-- Kept in the database because Vercel runs many copies of the app at once.
create table private.customer_stripe_calls (
  customer_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('card_form', 'check')),
  window_start timestamptz not null default now(),
  calls integer not null default 0 check (calls >= 0),
  primary key (customer_id, kind)
);
alter table private.customer_stripe_calls enable row level security;
revoke all on private.customer_stripe_calls from public, anon, authenticated;

-- Counts one call and says whether it may go ahead. Atomic: two copies of the app can't both
-- take the last call. Limits per customer per hour:
--   card_form  "Use a different card" (a new SetupIntent at Stripe each time)       6
--   check      checking a payment after the bank's step, or confirming a new card  30
create function public.customer_stripe_call(p_customer uuid, p_kind text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer;
  most integer := case p_kind when 'card_form' then 6 when 'check' then 30 end;
begin
  if most is null or p_customer is null then
    raise exception 'Unknown kind of call' using errcode = '22023';
  end if;
  insert into private.customer_stripe_calls as c (customer_id, kind, window_start, calls)
  values (p_customer, p_kind, now(), 1)
  on conflict (customer_id, kind) do update
     set window_start = case when c.window_start <= now() - interval '1 hour' then now() else c.window_start end,
         calls = case when c.window_start <= now() - interval '1 hour' then 1 else least(c.calls + 1, 1000000) end
  returning calls into n;
  return n <= most;
end $$;
revoke all on function public.customer_stripe_call(uuid, text) from public, anon, authenticated;
grant execute on function public.customer_stripe_call(uuid, text) to service_role;

-- ---------------------------------------------------------------- 4. the cleaner is told
-- The same outbox as the customer's emails. For these kinds customer_id holds the cleaner
-- (the person the email goes to); the series says which block. Never a payment: the cleaner
-- must not learn the customer's card failed.
alter table private.customer_notices drop constraint customer_notices_kind_check;
alter table private.customer_notices add constraint customer_notices_kind_check check (kind in
  ('payment_failed', 'payment_needs_confirming', 'block_on_hold', 'block_ended_unpaid',
   'cleaner_block_on_hold', 'cleaner_block_back_on', 'cleaner_block_ended'));
alter table private.customer_notices add constraint customer_notices_cleaner_has_no_payment
  check (kind not like 'cleaner\_%' or (payment_id is null and series_id is not null));

create function private.queue_cleaner_notice(p_kind text, p_series uuid, p_dedupe text) returns void
language sql volatile security definer set search_path = '' as $$
  insert into private.customer_notices (customer_id, kind, payment_id, series_id, dedupe)
  select s.cleaner_id, p_kind, null, s.id, left(p_dedupe, 200)
  from public.series s where s.id = p_series and s.cleaner_id is not null
  on conflict (dedupe) do nothing
$$;
revoke all on function private.queue_cleaner_notice(text, uuid, text) from public, anon, authenticated;

-- As 20261112110000_payment_hold.sql, plus: the cleaner is told.
create or replace function private.hold_block_for_payment(p_visit uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  sid uuid;
  s public.series;
  hid uuid;
begin
  if (select failed_payment_pauses_block from public.settings limit 1) is not true then
    return false;
  end if;
  select series_id into sid from public.visits where id = p_visit;
  select * into s from public.series where id = sid for update;
  if not found then return false; end if;
  if s.status = 'paused' then
    return exists (select 1 from private.series_holds h where h.series_id = sid and h.released_at is null);
  end if;
  if s.status <> 'claimed' then
    return false;  -- already ended, or back on the board: nothing to hold
  end if;
  update public.series set status = 'paused' where id = sid;
  insert into private.series_holds (series_id, reason) values (sid, 'payment_failed')
  on conflict (series_id) where released_at is null do nothing
  returning id into hid;
  -- The cleaner is told not to go (never why).
  if hid is not null then
    perform private.queue_cleaner_notice('cleaner_block_on_hold', sid, 'cleaner_block_on_hold:' || hid);
  end if;
  return true;
end $$;

-- As 20261112130000_payments_review_fixes.sql, plus: the cleaner is told.
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
  -- The cleaner is told it's back on (unless that was the block's last clean, and it ended).
  if (select status from public.series where id = p_series) = 'claimed' then
    perform private.queue_cleaner_notice('cleaner_block_back_on', p_series, 'cleaner_block_back_on:' || h.id);
  end if;
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
      -- Queued first: the notice is for the cleaner the block had.
      perform private.queue_cleaner_notice('cleaner_block_ended', h.series_id, 'cleaner_block_ended:' || h.id);
      perform private.close_block(h.series_id, null, 'This block was on hold and has now ended.');
      update private.series_holds set released_at = now(), outcome = 'ended' where id = h.id;
      perform private.queue_notice('block_ended_unpaid', null, h.series_id, 'block_ended_unpaid:' || h.id);
      ended := ended + 1;
    end if;
  end loop;
  return ended;
end $$;

-- As 20261112110000_payment_hold.sql, plus the block's town and day for the cleaner's emails.
drop function public.notices_claim(integer);
create function public.notices_claim(p_limit integer default 20)
returns table (notice_id uuid, kind text, email text, full_name text, payment_id uuid, amount_pence integer, clean_date date,
               town text, weekday smallint)
language plpgsql volatile security definer set search_path = '' as $$
declare
  n private.customer_notices;
begin
  for n in
    select c.* from private.customer_notices c
    where c.sent_at is null and c.attempts < 5
      and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
    order by c.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update of c skip locked
  loop
    update private.customer_notices set claimed_at = clock_timestamp(), attempts = attempts + 1 where id = n.id;
    notice_id := n.id; kind := n.kind; payment_id := n.payment_id;
    email := null; full_name := null; amount_pence := null; clean_date := null; town := null; weekday := null;
    select pr.email, pr.full_name into email, full_name from public.profiles pr where pr.id = n.customer_id;
    select pay.amount_pence, v.scheduled_date into amount_pence, clean_date
      from public.payments pay join public.visits v on v.id = pay.visit_id where pay.id = n.payment_id;
    -- The cleaner's emails name the block by its town and day, never the address.
    if n.kind like 'cleaner\_%' then
      select pp.town, s.preferred_day into town, weekday
        from public.series s join public.properties pp on pp.id = s.property_id where s.id = n.series_id;
    end if;
    return next;
  end loop;
end $$;

-- ---------------------------------------------------------------- 5. an older card never replaces a newer one
alter table private.customer_billing add column card_setup_at timestamptz;

-- As 20261112140000_card_before_cleaners.sql, plus p_setup_created (the SetupIntent's own
-- created time, from Stripe). 'saved' | 'older' | 'no_series' | 'mismatch'
drop function public.stripe_card_saved(uuid, text, text, text, text, smallint, smallint);
create function public.stripe_card_saved(
  p_series uuid, p_stripe_customer text, p_payment_method text,
  p_brand text, p_last4 text, p_exp_month smallint, p_exp_year smallint, p_setup_created timestamptz default null
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  s public.series;
  linked text;
  had_card boolean;
  newest timestamptz;
begin
  perform set_config('app.actor', 'stripe-webhook', true);
  select * into s from public.series where id = p_series;
  if not found or s.status = 'ended' then
    return 'no_series';
  end if;
  select stripe_customer_id, card_setup_at into linked, newest from private.customer_billing where customer_id = s.customer_id for update;
  if linked is distinct from p_stripe_customer then
    return 'mismatch';
  end if;
  had_card := private.series_has_card(s.id);
  -- A late webhook for a card saved BEFORE the customer's current one: it never replaces
  -- that card. A block with no card of its own still gets it (it is a good card).
  if p_setup_created is not null and newest is not null and p_setup_created < newest then
    insert into public.series_billing (series_id, stripe_payment_method_id)
    values (s.id, p_payment_method)
    on conflict (series_id) do update set stripe_payment_method_id = excluded.stripe_payment_method_id
      where public.series_billing.stripe_payment_method_id is null;
    return 'older';
  end if;
  insert into public.series_billing (series_id, stripe_payment_method_id)
  values (s.id, p_payment_method)
  on conflict (series_id) do update set stripe_payment_method_id = excluded.stripe_payment_method_id;
  -- The newest card is the customer's card from now on (one card per customer, C13).
  update private.customer_billing
     set default_payment_method_id = p_payment_method, card_brand = left(p_brand, 20), card_last4 = p_last4,
         card_exp_month = p_exp_month, card_exp_year = p_exp_year,
         card_setup_at = coalesce(p_setup_created, card_setup_at)
   where customer_id = s.customer_id;
  -- The first card: the customer's blocks that were waiting for one go out to cleaners now,
  -- with the full tier windows ahead of them. (A first-refusal window still in the future is kept.)
  if not had_card then
    update public.series set offering_since = greatest(offering_since, now())
     where customer_id = s.customer_id and status = 'offering' and offering_since is not null;
  end if;
  return 'saved';
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.charge_claim(integer) from public, anon, authenticated;
grant execute on function public.charge_claim(integer) to service_role;
revoke all on function public.notices_claim(integer) from public, anon, authenticated;
grant execute on function public.notices_claim(integer) to service_role;
revoke all on function public.stripe_card_saved(uuid, text, text, text, text, smallint, smallint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.stripe_card_saved(uuid, text, text, text, text, smallint, smallint, timestamptz) to service_role;
