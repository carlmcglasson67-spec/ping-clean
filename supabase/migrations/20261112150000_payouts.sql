-- Ping Clean: payments PR 9, paying cleaners after the check period (payments plan signed
-- off by Carl on 8 Nov 2026, build step 6; intent/payments/payout-plan.md). TEST mode only.
--
--   (trigger)                       a payment succeeds → the cleaner's payout row is written
--   payout_due_cleaners()           server (the payout job): who has earnings past the check period
--   payout_batch_open(cleaner, £)   server: put the oldest earnings that fit into one bank payout
--   payout_batch_sent(batch, …)     server: Stripe took the payout request
--   payout_batch_not_sent(batch, …) server: Stripe refused it; the earnings go back to waiting
--   payout_batches_open()           server: bank payouts with no final answer yet
--   stripe_payout_result(…)         server (job and webhook): what Stripe said about a bank payout
--   private.kick_payout_job()       cron, hourly: calls the job when there's something to do
--
-- No browser ever writes a money row. Every move goes along the payout and batch state maps,
-- is safe to repeat, and is audited. Cleaners are paid only from what was collected: a payout
-- row exists only for a succeeded payment, and only goes to the bank while it still stands
-- (private.check_payout_matches_payment).

alter table public.payout_batches add column sent_at timestamptz;  -- when Stripe took the request
revoke select on public.payout_batches from authenticated;
grant select (id, cleaner_id, amount_pence, status, arrival_date, created_at, updated_at)
  on public.payout_batches to authenticated;  -- never the Stripe id, key or failure text

-- ---------------------------------------------------------------- alerts for the team
alter table public.engine_alerts drop constraint engine_alerts_kind_check;
alter table public.engine_alerts add constraint engine_alerts_kind_check
  check (kind in ('release_failed', 'generate_failed', 'visit_needs_cover', 'visit_no_show', 'visit_unfinished',
                  'block_overlap', 'block_stalled', 'block_closed',
                  'charge_held', 'charge_blocked', 'payment_needs_customer', 'payment_failed',
                  'payout_failed', 'payout_stuck'));

-- One open alert per bank payout and kind. The message names the cleaner (admins only read alerts).
create function private.payout_alert(p_kind text, p_batch uuid, p_message text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  tag text := ' [bank payout ' || left(p_batch::text, 8) || ']';
begin
  if exists (select 1 from public.engine_alerts a where a.kind = p_kind and a.resolved_at is null and a.message like '%' || tag) then
    return;
  end if;
  insert into public.engine_alerts (kind, message)
  select p_kind, left(coalesce(pr.full_name, 'A cleaner') || ': ' || p_message, 500 - char_length(tag)) || tag
  from public.payout_batches b left join public.profiles pr on pr.id = b.cleaner_id where b.id = p_batch;
end $$;

-- ---------------------------------------------------------------- a paid clean → earnings waiting
-- Written the moment the payment first succeeds, in the same transaction. Available after the
-- clean's own completion time plus Carl's check period (settings.dispute_window_hours); with
-- no check period set, nothing is written and the team's settings checklist says why.
create function private.payout_for_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v public.visits;
  hours integer;
begin
  if new.kind <> 'visit' or new.cleaner_amount_pence <= 0 then return null; end if;
  select * into v from public.visits where id = new.visit_id;
  if v.cleaner_id is null or v.status <> 'completed' then return null; end if;
  select dispute_window_hours into hours from public.settings limit 1;
  if hours is null then return null; end if;
  insert into public.payouts (visit_id, cleaner_id, payment_id, amount_pence, available_after, idempotency_key)
  values (v.id, v.cleaner_id, new.id, new.cleaner_amount_pence,
          coalesce(v.completed_at, now()) + hours * interval '1 hour', 'payout:' || new.id)
  on conflict do nothing;
  return null;
end $$;
create trigger payments_make_payout after update of status on public.payments
  for each row when (new.status = 'succeeded' and old.status is distinct from 'succeeded')
  execute function private.payout_for_payment();

-- ---------------------------------------------------------------- who is due
-- Earnings past their check period, for a payment that still stands, for a cleaner whose
-- Stripe account can pay out. "Failed" earnings (the bank said no) are due again only once
-- Stripe has told Ping something about the account since (the cleaner fixed their details).
create function private.payout_rows_due(p_cleaner uuid) returns setof public.payouts
language sql stable security definer set search_path = '' as $$
  select po.* from public.payouts po
  join public.payments pay on pay.id = po.payment_id
  join public.cleaners c on c.id = po.cleaner_id
  where (p_cleaner is null or po.cleaner_id = p_cleaner)
    and pay.status = 'succeeded'
    and c.stripe_account_id is not null and c.stripe_payouts_enabled
    and ((po.status = 'pending' and po.available_after <= now())
      or (po.status = 'failed' and c.stripe_status_at > po.updated_at))
$$;

create function public.payout_due_cleaners()
returns table (cleaner_id uuid, cleaner_account_id text, due_pence integer)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform set_config('app.actor', 'job:pay-cleaners', true);
  return query
    select d.cleaner_id, c.stripe_account_id, sum(d.amount_pence)::integer
    from private.payout_rows_due(null) d join public.cleaners c on c.id = d.cleaner_id
    -- One request at a time per cleaner: never while an earlier one hasn't reached Stripe.
    where not exists (select 1 from public.payout_batches b
                      where b.cleaner_id = d.cleaner_id and b.status = 'created' and b.stripe_payout_id is null)
    group by d.cleaner_id, c.stripe_account_id
    order by min(d.available_after)
    limit 100;
end $$;

-- ---------------------------------------------------------------- one bank payout
-- Takes the cleaner's due earnings, oldest first, for as long as they fit inside what Stripe
-- says has cleared (p_available_pence, read from Stripe by the server). Returns nothing when
-- nothing fits: those earnings wait for the next run.
create function public.payout_batch_open(p_cleaner uuid, p_available_pence integer)
returns table (batch_id uuid, cleaner_account_id text, amount_pence integer, idempotency_key text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.cleaners;
  r public.payouts;
  ids uuid[] := '{}';
  total integer := 0;
  bid uuid := gen_random_uuid();
begin
  perform set_config('app.actor', 'job:pay-cleaners', true);
  select * into c from public.cleaners where id = p_cleaner for update;  -- one run per cleaner at a time
  if not found or c.stripe_account_id is null or not c.stripe_payouts_enabled then return; end if;
  if exists (select 1 from public.payout_batches b
             where b.cleaner_id = p_cleaner and b.status = 'created' and b.stripe_payout_id is null) then
    return;
  end if;
  for r in select d.* from private.payout_rows_due(p_cleaner) d
           join public.payouts lock_it on lock_it.id = d.id
           order by d.available_after, d.created_at for update of lock_it loop
    exit when total + r.amount_pence > coalesce(p_available_pence, 0);
    total := total + r.amount_pence;
    ids := ids || r.id;
  end loop;
  if total = 0 then return; end if;

  insert into public.payout_batches (id, cleaner_id, amount_pence, idempotency_key)
  values (bid, p_cleaner, total, 'payout-batch:' || bid);
  update public.payouts set status = 'pending', held_reason = null where id = any (ids) and status = 'failed';
  update public.payouts set status = 'in_batch', batch_id = bid where id = any (ids);

  batch_id := bid; cleaner_account_id := c.stripe_account_id; amount_pence := total;
  idempotency_key := 'payout-batch:' || bid;
  return next;
end $$;

create function public.payout_batch_sent(p_batch uuid, p_stripe_payout text, p_arrival date) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.payout_batches;
begin
  perform set_config('app.actor', 'job:pay-cleaners', true);
  select * into b from public.payout_batches where id = p_batch for update;
  if not found then return 'unknown'; end if;
  if b.stripe_payout_id is not null then
    return case when b.stripe_payout_id = p_stripe_payout then 'already' else 'mismatch' end;
  end if;
  update public.payout_batches
     set stripe_payout_id = p_stripe_payout, arrival_date = p_arrival, sent_at = now() where id = b.id;
  update public.payouts set stripe_payout_id = p_stripe_payout where batch_id = b.id;
  return 'sent';
end $$;

-- Marks a bank payout failed and its cleans with it. p_return: Stripe never took the request,
-- so the earnings go straight back to waiting; otherwise they stay "failed" until the
-- cleaner's account changes.
create function private.fail_batch(p_batch uuid, p_error text, p_return boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.payout_batches
     set status = 'failed', failure_reason = left(coalesce(nullif(p_error, ''), 'unknown'), 300) where id = p_batch;
  update public.payouts set status = 'failed' where batch_id = p_batch and status = 'in_batch';
  if p_return then
    update public.payouts set status = 'pending', batch_id = null, stripe_payout_id = null
     where batch_id = p_batch and status = 'failed';
  end if;
end $$;

create function public.payout_batch_not_sent(p_batch uuid, p_error text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.payout_batches;
begin
  perform set_config('app.actor', 'job:pay-cleaners', true);
  select * into b from public.payout_batches where id = p_batch for update;
  if not found then return 'unknown'; end if;
  if b.status <> 'created' or b.stripe_payout_id is not null then return 'ignored'; end if;
  perform private.fail_batch(b.id, p_error, true);
  -- Money that hasn't cleared yet is normal and waits quietly; anything else, the team hears.
  if p_error is distinct from 'stripe_balance_insufficient' then
    perform private.payout_alert('payout_failed', b.id,
      'Stripe wouldn''t take a bank payout request (' || left(coalesce(p_error, 'unknown'), 80) || '). Their earnings are still waiting and will be tried again tomorrow.');
  end if;
  return 'returned';
end $$;

-- Bank payouts with no final answer: not sent yet (send again, same key, while Stripe still
-- remembers it), or sent and not yet heard back on (ask Stripe). One never sent and older
-- than 23 hours can't be sent again safely: a person looks at it.
create function public.payout_batches_open()
returns table (batch_id uuid, mode text, cleaner_account_id text, amount_pence integer, idempotency_key text, stripe_payout_id text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform set_config('app.actor', 'job:pay-cleaners', true);
  perform private.payout_alert('payout_stuck', b.id,
            'A bank payout got stuck before it reached Stripe. Check their Stripe account, then tell the main session.')
  from public.payout_batches b
  where b.status = 'created' and b.stripe_payout_id is null and b.created_at < now() - interval '23 hours';
  return query
    select b.id, case when b.stripe_payout_id is null then 'send' else 'check' end, c.stripe_account_id,
           b.amount_pence, b.idempotency_key, b.stripe_payout_id
    from public.payout_batches b join public.cleaners c on c.id = b.cleaner_id
    where b.status = 'created' and c.stripe_account_id is not null
      and ((b.stripe_payout_id is null and b.created_at between now() - interval '23 hours' and now() - interval '10 minutes')
        or (b.stripe_payout_id is not null and b.sent_at < now() - interval '30 minutes'))
    order by b.created_at
    limit 100;
end $$;

-- ---------------------------------------------------------------- what Stripe said
-- From the job (asking Stripe) and the Connect webhook (the source of truth). The batch id
-- comes from the payout's metadata, which Ping set; it is still checked: the Stripe payout id,
-- the cleaner's account and the amount must be this batch's, or nothing changes.
--   p_outcome 'paid' | 'failed' | 'in_transit'
-- Returns 'paid' | 'failed' | 'already' | 'ignored' | 'unknown' | 'mismatch'.
create function public.stripe_payout_result(
  p_batch uuid, p_stripe_payout text, p_account text, p_outcome text, p_amount integer, p_arrival date, p_error text
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.payout_batches;
  acct text;
begin
  perform set_config('app.actor', 'stripe', true);
  if p_outcome not in ('paid', 'failed', 'in_transit') or p_stripe_payout is null then
    raise exception 'Unknown payout result' using errcode = '22023';
  end if;
  select * into b from public.payout_batches where id = p_batch for update;
  if not found then return 'unknown'; end if;
  select stripe_account_id into acct from public.cleaners where id = b.cleaner_id;
  if (b.stripe_payout_id is not null and b.stripe_payout_id <> p_stripe_payout)
     or p_account is distinct from acct or p_amount is distinct from b.amount_pence then
    perform private.payout_alert('payout_stuck', b.id,
      'Stripe reported a bank payout that doesn''t match Ping''s record (payout, account or amount). Nothing was recorded. Check Stripe, then tell the main session.');
    return 'mismatch';
  end if;
  if b.stripe_payout_id is null then
    update public.payout_batches set stripe_payout_id = p_stripe_payout, sent_at = coalesce(sent_at, now()) where id = b.id;
    update public.payouts set stripe_payout_id = p_stripe_payout where batch_id = b.id;
  end if;
  if p_arrival is not null and p_arrival is distinct from b.arrival_date then
    update public.payout_batches set arrival_date = p_arrival where id = b.id;
  end if;

  if p_outcome = 'in_transit' then
    update public.payout_batches set sent_at = now() where id = b.id and status = 'created';  -- asked; ask again later
    return 'ignored';
  end if;

  if p_outcome = 'paid' then
    if b.status <> 'created' then return 'already'; end if;  -- paid already, or failed: never moved back
    update public.payout_batches set status = 'paid' where id = b.id;
    update public.payouts set status = 'paid', paid_at = now() where batch_id = b.id and status = 'in_batch';
    return 'paid';
  end if;

  -- failed
  if b.status = 'failed' then return 'already'; end if;
  if b.status = 'paid' then
    -- The bank sent it back after Stripe had said paid. The cleans stay "paid" (their map is
    -- final); the team sorts it out with the cleaner.
    update public.payout_batches set status = 'failed', failure_reason = left(coalesce(nullif(p_error, ''), 'unknown'), 300) where id = b.id;
    perform private.payout_alert('payout_failed', b.id,
      'Their bank sent a payout back after it had shown as paid (' || left(coalesce(p_error, 'unknown'), 80) || '). The app still shows those cleans as paid. Speak to the cleaner and tell the main session.');
    return 'failed';
  end if;
  perform private.fail_batch(b.id, p_error, false);
  perform private.payout_alert('payout_failed', b.id,
    'Their bank didn''t accept a payout (' || left(coalesce(p_error, 'unknown'), 80) || '). They''ve been asked in the app to check their bank details with Stripe; it''s tried again once they have.');
  return 'failed';
end $$;

-- ---------------------------------------------------------------- the cron kick
-- Hourly. New bank payouts are only started in the 6 o'clock hour (London): once a day, as
-- Carl chose (C14). The other hours only chase answers Stripe hasn't given yet.
-- Uses the charge job's Vault secrets: the same site, the same shared secret.
create function private.payouts_due() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.payout_batches b
      where b.status = 'created'
        and ((b.stripe_payout_id is null and b.created_at < now() - interval '10 minutes')
          or (b.stripe_payout_id is not null and b.sent_at < now() - interval '30 minutes')))
    or (extract(hour from now() at time zone 'Europe/London') = 6
        and exists (select 1 from private.payout_rows_due(null)))
$$;

create function private.kick_payout_job() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  if not private.payouts_due() then
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
  v_url := regexp_replace(v_url, '/charge-due$', '/payouts-due');
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 55000)'
    using v_url, jsonb_build_object('authorization', 'Bearer ' || v_secret, 'content-type', 'application/json'), '{}'::jsonb;
  return 'kicked';
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ping-pay-cleaners', '20 * * * *', 'select private.kick_payout_job()');
  end if;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function private.payout_alert(text, uuid, text), private.payout_for_payment(), private.payout_rows_due(uuid),
  private.fail_batch(uuid, text, boolean), private.payouts_due(), private.kick_payout_job() from public, anon, authenticated;
revoke all on function public.payout_due_cleaners(), public.payout_batch_open(uuid, integer),
  public.payout_batch_sent(uuid, text, date), public.payout_batch_not_sent(uuid, text), public.payout_batches_open(),
  public.stripe_payout_result(uuid, text, text, text, integer, date, text) from public, anon, authenticated;
grant execute on function public.payout_due_cleaners(), public.payout_batch_open(uuid, integer),
  public.payout_batch_sent(uuid, text, date), public.payout_batch_not_sent(uuid, text), public.payout_batches_open(),
  public.stripe_payout_result(uuid, text, text, text, integer, date, text) to service_role;
