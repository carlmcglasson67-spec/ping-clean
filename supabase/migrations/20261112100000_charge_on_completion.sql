-- Ping Clean: payments PR 6, charging when a clean is complete (payments plan signed off by
-- Carl on 8 Nov 2026, build step 5; intent/payments/charge-plan.md). Stripe TEST mode only.
--
--   complete_visit(visit)          the cleaner: as before, and now writes the "to charge" row
--   admin_charge_visit(visit)      the Ping team: charge a clean that was held for them
--   charge_claim(limit)            server (the charge job): takes the charges that are due
--   charge_not_sent(payment, why)  server: Stripe refused the request outright
--   stripe_payment_result(…)       server (job and webhook): what Stripe said about a charge
--   private.kick_charge_job()      cron, every minute: calls the job when something is due
--
-- No browser ever writes a money row. Every move goes along the payment state map
-- (private.check_payment_move), is safe to repeat, and is audited (payments_audit).

-- ---------------------------------------------------------------- the current try
-- When the current try was sent to Stripe. Two uses: a try that died half way is picked up
-- again after 10 minutes, and a failure Stripe reports for an OLDER try is ignored.
-- Not in the column grants, so customers and cleaners never read it.
alter table public.payments add column charge_started_at timestamptz;
create index payments_due_idx on public.payments (next_retry_at)
  where status in ('pending', 'failed', 'processing');

-- ---------------------------------------------------------------- alerts for the team
--   charge_held             a clean with "couldn't do" items, not charged until someone decides
--   charge_blocked          a charge that can't go ahead and isn't the customer's fault
--   payment_needs_customer  the bank wants the customer to confirm
--   payment_failed          the last try failed
alter table public.engine_alerts drop constraint engine_alerts_kind_check;
alter table public.engine_alerts add constraint engine_alerts_kind_check
  check (kind in ('release_failed', 'generate_failed', 'visit_needs_cover', 'visit_no_show', 'visit_unfinished',
                  'block_overlap', 'block_stalled', 'block_closed',
                  'charge_held', 'charge_blocked', 'payment_needs_customer', 'payment_failed'));
-- One open alert per clean and kind, not one every minute.
create unique index engine_alerts_one_open_payment on public.engine_alerts (visit_id, kind)
  where kind in ('charge_held', 'charge_blocked', 'payment_needs_customer', 'payment_failed') and resolved_at is null;

create function private.payment_alert(p_kind text, p_visit uuid, p_message text) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.engine_alerts (kind, series_id, visit_id, message)
  select p_kind, v.series_id, v.id, left(p_message, 500) from public.visits v where v.id = p_visit
  on conflict (visit_id, kind)
    where kind in ('charge_held', 'charge_blocked', 'payment_needs_customer', 'payment_failed') and resolved_at is null
    do nothing
$$;

create function private.settle_payment_alerts(p_visit uuid, p_kinds text[]) returns void
language sql volatile security definer set search_path = '' as $$
  update public.engine_alerts set resolved_at = now()
  where visit_id = p_visit and resolved_at is null and kind = any (p_kinds)
$$;

-- ---------------------------------------------------------------- the "to charge" row
-- One payment row for a completed clean: the clean's own price, split exactly as the clean
-- was split (payments_match_visit checks it again). Does nothing if the clean already has a
-- live charge. Returns the payment's id, or null when nothing was written.
create function private.insert_visit_charge(p_visit uuid) returns uuid
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
  insert into public.payments (id, visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence,
                               kind, idempotency_key)
  values (pid, v.id, v.customer_id, v.price_pence, v.ping_fee_pence, v.cleaner_earnings_pence, 'visit', 'payment:' || pid)
  on conflict (visit_id, kind) where status not in ('failed', 'failed_final') do nothing
  returning id into made;
  return made;
end $$;

-- As 20261107090100_visit_day.sql, plus the last step: the charge is queued in the same
-- transaction as the clean being marked complete, so a completed clean can never be missed.
create or replace function public.complete_visit(p_visit uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  sid uuid;
  v public.visits;
  left_to_do integer;
  skipped integer;
  missing text;
  rule text;
begin
  if not private.is_active_cleaner() then
    raise exception 'Only active Ping cleaners can complete a clean' using errcode = '42501';
  end if;

  select series_id into sid from public.visits where id = p_visit and cleaner_id = me;
  if not found then
    raise exception 'That clean isn''t yours' using errcode = 'PC010';
  end if;
  -- Lock order: series, cleaner, visit. The series is locked for update because finishing
  -- the last clean of a block ends it; two taps on the same visit wait for each other.
  perform 1 from public.series where id = sid for no key update;
  perform 1 from public.cleaners where id = me for no key update;
  select * into v from public.visits where id = p_visit for update;

  if v.cleaner_id is distinct from me then
    raise exception 'That clean isn''t yours' using errcode = 'PC010';
  end if;
  if v.status = 'completed' then
    return;  -- already done: a retry must never count it twice
  end if;
  if v.status <> 'in_progress' then
    raise exception 'That clean isn''t in progress' using errcode = 'PC012';
  end if;
  if v.scheduled_date <> private.london_today() then
    raise exception 'That clean is booked for another day' using errcode = 'PC011';
  end if;

  select count(*) filter (where not ci.done and (ci.skipped_reason is null or ci.skipped_reason !~ '[[:alnum:]]{3,}')),
         count(*) filter (where ci.skipped_reason ~ '[[:alnum:]]{3,}')
  into left_to_do, skipped
  from public.checklist_items ci where ci.visit_id = v.id;
  if left_to_do > 0 or not exists (select 1 from public.checklist_items where visit_id = v.id) then
    raise exception 'Tick every item, or mark it "couldn''t do" with a reason'
      using errcode = 'PC013', detail = left_to_do::text;
  end if;

  -- A photo counts only if its file really is in the private bucket, uploaded by this
  -- cleaner, and isn't empty: a row on its own (no upload) is not evidence of a clean.
  select string_agg(k::text, ',' order by k) into missing
  from unnest(array['before', 'after']::public.photo_kind[]) as k
  where not exists (
    select 1 from public.visit_photos ph
    join storage.objects o on o.bucket_id = 'visit-photos' and o.name = ph.storage_path
    where ph.visit_id = v.id and ph.kind = k and ph.uploaded_by = me
      and o.owner = me
      and coalesce((o.metadata ->> 'size')::bigint, 0) > 0
  );
  if missing is not null then
    raise exception 'Add at least one before and one after photo' using errcode = 'PC014', detail = missing;
  end if;

  update public.visits
  set status = 'completed', completed_at = now(), couldnt_do_count = skipped
  where id = v.id;
  update public.cleaners set completed_visits = completed_visits + 1 where id = me;
  perform private.end_block_if_done(sid);

  -- The charge. With "couldn't do" items it follows Carl's rule (settings.couldnt_do_rule):
  -- 'charge_full' charges as normal; 'hold_for_admin', or no rule set yet, holds it for the
  -- Ping team (plan: a rule that isn't set doesn't run, and the admin is told instead).
  select couldnt_do_rule into rule from public.settings limit 1;
  if skipped > 0 and rule is distinct from 'charge_full' then
    if v.price_pence > 0 then
      perform private.payment_alert('charge_held', v.id,
        'This clean had "couldn''t do" items, so the customer hasn''t been charged. Check it, then charge it or leave it.');
    end if;
  else
    perform private.insert_visit_charge(v.id);
  end if;
end $$;

-- The Ping team charges a held clean (or one that never got a charge). The job then sends it
-- like any other. Returns the payment's id.
create function public.admin_charge_visit(p_visit uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.visits;
  made uuid;
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
  made := private.insert_visit_charge(v.id);
  if made is null then
    raise exception 'That clean already has a charge' using errcode = 'PC051';
  end if;
  update public.engine_alerts set resolved_at = now(), resolved_by = (select auth.uid())
  where visit_id = v.id and kind = 'charge_held' and resolved_at is null;
  return made;
end $$;

-- ---------------------------------------------------------------- a failed try
-- Counts as one of the customer's tries (attempts was raised when the try was claimed).
-- Carl's schedule (settings.payment_retry_hours) is hours after the charge was first due:
-- {24,72} = try again a day later, and again three days later. After the last try, or with
-- no schedule set, it's final and the Ping team is told. (Pausing the rest of the block is
-- not built: nothing pauses a block yet, see TODO(pause) in the engine.)
create function private.payment_failed_now(p_payment uuid, p_code text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
  hours integer[];
  next_at timestamptz;
begin
  select * into p from public.payments where id = p_payment for update;
  select payment_retry_hours into hours from public.settings limit 1;
  if hours is not null and p.attempts between 1 and cardinality(hours) and p.attempts < 10 then
    next_at := greatest(p.created_at + hours[p.attempts] * interval '1 hour', now() + interval '1 hour');
  end if;
  update public.payments
     set status = 'failed', last_error_code = left(coalesce(nullif(p_code, ''), 'unknown'), 100), next_retry_at = next_at
   where id = p.id;
  if next_at is null then
    update public.payments set status = 'failed_final' where id = p.id;
    perform private.payment_alert('payment_failed', p.visit_id,
      'The customer''s card couldn''t be charged for this clean and there are no more tries left. Contact the customer, and agree what happens to the rest of the block.');
  end if;
end $$;

-- ---------------------------------------------------------------- the job takes what's due
--   mode 'create'  no PaymentIntent yet: make one (key payment:<id>; safe to send again)
--   mode 'retry'   a failed try that is due again: confirm the same PaymentIntent
--   mode 'check'   sent more than 10 minutes ago with no answer: ask Stripe what happened
-- Rows are locked and skipped if another run holds them, then moved to 'processing' before
-- anything is sent, so two runs can never send the same try.
create function public.charge_claim(p_limit integer default 10)
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
        or (pay.status = 'failed' and pay.next_retry_at <= now())
        or (pay.status = 'processing' and pay.charge_started_at < now() - interval '10 minutes'
            and (pay.stripe_payment_intent_id is not null or pay.charge_started_at > now() - interval '23 hours')))
    order by pay.created_at
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
    for update of pay skip locked
  loop
    if p.status = 'processing' and p.stripe_payment_intent_id is not null then
      update public.payments set charge_started_at = clock_timestamp() where id = p.id;
      payment_id := p.id; mode := 'check'; visit_id := p.visit_id; amount_pence := p.amount_pence;
      application_fee_pence := p.application_fee_pence; stripe_customer_id := null; payment_method_id := null;
      cleaner_account_id := p.cleaner_account_id; payment_intent_id := p.stripe_payment_intent_id;
      attempt := p.attempts; idempotency_key := p.idempotency_key;
      return next;
      continue;
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
        continue;
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
      continue;
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
  end loop;
end $$;

-- Stripe refused the request itself (not the card): nothing was charged and there's no
-- PaymentIntent. Counted as a failed try so it can't loop for ever; the code says why.
create function public.charge_not_sent(p_payment uuid, p_error text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
begin
  perform set_config('app.actor', 'job:charge-visits', true);
  select * into p from public.payments where id = p_payment for update;
  if not found then return 'unknown'; end if;
  if p.status <> 'processing' or p.stripe_payment_intent_id is not null then return 'ignored'; end if;
  perform private.payment_failed_now(p.id, p_error);
  return 'failed';
end $$;

-- ---------------------------------------------------------------- what Stripe said
-- Called by the job (Stripe's immediate answer) and by the webhook (the source of truth).
-- The payment id comes from the PaymentIntent's metadata, which Ping set itself; it is still
-- checked: the PaymentIntent, amount, fee and destination must be this row's, or nothing
-- changes and the team is told.
--   p_outcome   'succeeded' | 'requires_action' | 'failed' | 'processing'
--   p_event_at  when Stripe says it happened (webhooks), so news about an older try is ignored
-- Returns 'succeeded' | 'requires_action' | 'failed' | 'already' | 'ignored' | 'unknown' | 'mismatch'.
create function public.stripe_payment_result(
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
    update public.payments set status = 'requires_action', last_error_code = 'authentication_required' where id = p.id;
    perform private.payment_alert('payment_needs_customer', p.visit_id,
      'The customer''s bank wants them to confirm this payment. Ask the customer to confirm it; nothing is retried without them.');
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

-- ---------------------------------------------------------------- the cron kick
-- The database decides when there is something to charge; the Stripe call itself lives in
-- the app (app/api/stripe/charge-due), because that's where the Stripe client and its
-- test-key guard are. The address and the shared secret are read from Supabase Vault:
--   ping_charge_job_url   https://<site>/api/stripe/charge-due
--   ping_job_secret       the same value as the app's PING_JOB_SECRET
-- Without Vault, pg_net or either secret this does nothing (tests, local, not set up yet).
create function private.charges_due() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.payments pay
    where pay.kind = 'visit'
      and ((pay.status = 'pending' and (pay.next_retry_at is null or pay.next_retry_at <= now()))
        or (pay.status = 'failed' and pay.next_retry_at <= now())
        or (pay.status = 'processing' and pay.charge_started_at < now() - interval '10 minutes')))
$$;

create function private.kick_charge_job() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  if not private.charges_due() then
    return 'nothing_due';
  end if;
  if to_regclass('vault.decrypted_secrets') is null
     or not exists (select 1 from pg_catalog.pg_proc f join pg_catalog.pg_namespace n on n.oid = f.pronamespace
                    where n.nspname = 'net' and f.proname = 'http_post') then
    return 'not_set_up';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'ping_charge_job_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'ping_job_secret';
  if v_url is null or v_secret is null or v_url !~ '^https://[A-Za-z0-9.-]+/api/stripe/charge-due$' or char_length(v_secret) < 32 then
    return 'not_set_up';
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 55000)'
    using v_url, jsonb_build_object('authorization', 'Bearer ' || v_secret, 'content-type', 'application/json'), '{}'::jsonb;
  return 'kicked';
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ping-charge-visits', '* * * * *', 'select private.kick_charge_job()');
  end if;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function private.payment_alert(text, uuid, text), private.settle_payment_alerts(uuid, text[]),
  private.insert_visit_charge(uuid), private.payment_failed_now(uuid, text), private.charges_due(),
  private.kick_charge_job() from public, anon, authenticated;
revoke all on function public.admin_charge_visit(uuid), public.charge_claim(integer), public.charge_not_sent(uuid, text),
  public.stripe_payment_result(uuid, text, text, integer, integer, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_charge_visit(uuid) to authenticated;  -- admins only, checked inside
grant execute on function public.charge_claim(integer), public.charge_not_sent(uuid, text),
  public.stripe_payment_result(uuid, text, text, integer, integer, text, text, text, timestamptz) to service_role;
