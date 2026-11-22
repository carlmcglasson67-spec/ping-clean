-- Ping Clean: the charge and payout jobs no longer fail quietly (#60), 22 Nov 2026.
--
-- private.kick_charge_job() and private.kick_payout_job() call the app with pg_net, which
-- answers later (net._http_response). Until now nobody read the answer: a 401 (the Vault's
-- job secret doesn't match PING_JOB_SECRET), a redirect (the address is wrong) or a timeout
-- all looked like "sent", and a mistyped Vault value only ever said 'not_set_up' to cron's log.
--
-- Now each job keeps its last call's request id. On every cron tick it first reads that
-- call's answer: anything but 200 raises an office alert (job_call_failed, one open per job);
-- a 200 closes it. A missing or mistyped Vault value while work is due raises the same alert.
-- Plan: intent/payments-followups/plan.md.

-- ---------------------------------------------------------------- alerts for the team
alter table public.engine_alerts drop constraint engine_alerts_kind_check;
alter table public.engine_alerts add constraint engine_alerts_kind_check
  check (kind in ('release_failed', 'generate_failed', 'visit_needs_cover', 'visit_no_show', 'visit_unfinished',
                  'block_overlap', 'block_stalled', 'block_closed',
                  'charge_held', 'charge_blocked', 'payment_needs_customer', 'payment_failed',
                  'payout_failed', 'payout_stuck',
                  'refund_failed', 'refund_after_payout', 'payment_disputed',
                  'visit_cancelled_late',
                  'cleaner_check_lapsed', 'cleaner_check_expiring',
                  'job_call_failed'));

-- ---------------------------------------------------------------- each job's last call
create table private.job_calls (
  job text primary key check (job in ('charge', 'payout')),
  request_id bigint,
  called_at timestamptz,
  checked_at timestamptz
);
alter table private.job_calls enable row level security;
revoke all on private.job_calls from public, anon, authenticated;

-- One open alert per job: the message ends with the job's tag, and this index makes a second
-- open one for the same job impossible, however many ticks run at once.
create unique index engine_alerts_one_open_job_call on public.engine_alerts ((substring(message from '\[([a-z]+) job\]$')))
  where kind = 'job_call_failed' and resolved_at is null;

create function private.job_call_alert(p_job text, p_message text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  tag text := ' [' || p_job || ' job]';
begin
  insert into public.engine_alerts (kind, message)
  values ('job_call_failed', left(p_message, 500 - char_length(tag)) || tag)
  on conflict do nothing;
end $$;

create function private.job_call_ok(p_job text) returns void
language sql volatile security definer set search_path = '' as $$
  update public.engine_alerts set resolved_at = now()
   where kind = 'job_call_failed' and resolved_at is null and message like '%' || ' [' || p_job || ' job]'
$$;

-- The Vault and pg_net are right now: a "can't call the app" alert is over (one about a
-- call's answer stays until a call comes back 200).
create function private.job_set_up_ok(p_job text) returns void
language sql volatile security definer set search_path = '' as $$
  update public.engine_alerts set resolved_at = now()
   where kind = 'job_call_failed' and resolved_at is null and message like '%can''t call the app:%'
     and message like '%' || ' [' || p_job || ' job]'
$$;

-- What the job does, in the team's words.
create function private.job_words(p_job text) returns text
language sql immutable set search_path = '' as $$
  select case p_job when 'charge' then 'The charge job (it charges customers for finished cleans)'
                    else 'The payout job (it pays cleaners)' end
$$;

-- Reads the answer to the job's last call, once. Nothing to read yet: waits (up to 10 minutes).
create function private.check_job_call(p_job text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  c private.job_calls;
  v_status integer;
  v_timed_out boolean;
  answered boolean;
begin
  select * into c from private.job_calls where job = p_job for update;
  if not found or c.request_id is null or c.checked_at is not null then
    return;
  end if;
  if to_regclass('net._http_response') is null then
    return;
  end if;
  execute 'select true, status_code, timed_out from net._http_response where id = $1'
    into answered, v_status, v_timed_out using c.request_id;
  if answered is null then
    if c.called_at > now() - interval '10 minutes' then
      return;  -- still on its way
    end if;
    perform private.job_call_alert(p_job, private.job_words(p_job) ||
      ' called the app and never heard back, so it may not have run: customers may not be charged, or cleaners paid, until it runs. Check the app is up on Vercel and that pg_net is working in Supabase.');
  elsif v_status = 200 then
    perform private.job_call_ok(p_job);
  elsif v_status is null then
    perform private.job_call_alert(p_job, private.job_words(p_job) || ' didn''t get an answer from the app (' ||
      case when v_timed_out then 'it timed out' else 'the call failed' end ||
      '). It may still have run, so check Stripe before doing anything by hand. If it keeps happening, customers may not be charged, or cleaners paid: check the app is up on Vercel and the job''s address in the Vault.');
  else
    perform private.job_call_alert(p_job, private.job_words(p_job) || ' called the app and got HTTP ' || v_status ||
      ' back, not 200, so it didn''t run: customers may not be charged, or cleaners paid, until it runs. ' ||
      case when v_status = 401 then 'The secret in the Vault (ping_job_secret) doesn''t match PING_JOB_SECRET on Vercel.'
           when v_status = 503 then 'PING_JOB_SECRET isn''t set on Vercel.'
           when v_status between 300 and 399 then 'The address in the Vault (ping_charge_job_url) is being redirected: use the site''s final address.'
           else 'Check the app''s logs on Vercel.' end);
  end if;
  update private.job_calls set checked_at = now() where job = p_job;
end $$;

-- Keeps the call it is watching until that call's answer has been read, so a call that never
-- answers is noticed even though cron calls again every minute.
create function private.job_called(p_job text, p_request bigint) returns void
language sql volatile security definer set search_path = '' as $$
  insert into private.job_calls as c (job, request_id, called_at, checked_at) values (p_job, p_request, now(), null)
  on conflict (job) do update set request_id = excluded.request_id, called_at = excluded.called_at, checked_at = null
   where c.checked_at is not null or c.request_id is null
$$;

-- ---------------------------------------------------------------- the kicks (as before, plus the checks)
-- As 20261112100000_charge_on_completion.sql.
create or replace function private.kick_charge_job() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  v_request bigint;
  v_problem text;
begin
  -- Reading the last call's answer must never stop the job: an error there is an alert.
  begin
    perform private.check_job_call('charge');
  exception when others then
    perform private.job_call_alert('charge', private.job_words('charge') ||
      ' couldn''t read the answer to its last call (' || sqlstate || '). It still runs; tell the main session.');
  end;
  if to_regclass('vault.decrypted_secrets') is null
     or not exists (select 1 from pg_catalog.pg_proc f join pg_catalog.pg_namespace n on n.oid = f.pronamespace
                    where n.nspname = 'net' and f.proname = 'http_post') then
    v_problem := 'pg_net or the Vault isn''t switched on in Supabase';
  else
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'ping_charge_job_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'ping_job_secret';
    if v_url is null or v_secret is null or v_url !~ '^https://[A-Za-z0-9.-]+/api/stripe/charge-due$' or char_length(v_secret) < 32 then
      v_problem := 'ping_charge_job_url or ping_job_secret in the Vault is missing or mistyped';
    end if;
  end if;
  if v_problem is null then
    perform private.job_set_up_ok('charge');  -- set up right now, whether or not there's work
  end if;
  if not private.charges_due() then
    return 'nothing_due';
  end if;
  if v_problem is not null then
    perform private.job_call_alert('charge', private.job_words('charge') || ' has work to do but can''t call the app: ' || v_problem ||
      '. Customers may not be charged until it runs.');
    return 'not_set_up';
  end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 55000)'
    into v_request
    using v_url, jsonb_build_object('authorization', 'Bearer ' || v_secret, 'content-type', 'application/json'), '{}'::jsonb;
  perform private.job_called('charge', v_request);
  return 'kicked';
end $$;

-- As 20261112150000_payouts.sql.
create or replace function private.kick_payout_job() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
  v_request bigint;
  v_problem text;
begin
  -- Reading the last call's answer must never stop the job: an error there is an alert.
  begin
    perform private.check_job_call('payout');
  exception when others then
    perform private.job_call_alert('payout', private.job_words('payout') ||
      ' couldn''t read the answer to its last call (' || sqlstate || '). It still runs; tell the main session.');
  end;
  if to_regclass('vault.decrypted_secrets') is null
     or not exists (select 1 from pg_catalog.pg_proc f join pg_catalog.pg_namespace n on n.oid = f.pronamespace
                    where n.nspname = 'net' and f.proname = 'http_post') then
    v_problem := 'pg_net or the Vault isn''t switched on in Supabase';
  else
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'ping_charge_job_url';
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'ping_job_secret';
    if v_url is null or v_secret is null or v_url !~ '^https://[A-Za-z0-9.-]+/api/stripe/charge-due$' or char_length(v_secret) < 32 then
      v_problem := 'ping_charge_job_url or ping_job_secret in the Vault is missing or mistyped';
    end if;
  end if;
  if v_problem is null then
    perform private.job_set_up_ok('payout');  -- set up right now, whether or not there's work
  end if;
  if not private.payouts_due() then
    return 'nothing_due';
  end if;
  if v_problem is not null then
    perform private.job_call_alert('payout', private.job_words('payout') || ' has work to do but can''t call the app: ' || v_problem ||
      '. Cleaners may not be paid until it runs.');
    return 'not_set_up';
  end if;
  v_url := regexp_replace(v_url, '/charge-due$', '/payouts-due');
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 55000)'
    into v_request
    using v_url, jsonb_build_object('authorization', 'Bearer ' || v_secret, 'content-type', 'application/json'), '{}'::jsonb;
  perform private.job_called('payout', v_request);
  return 'kicked';
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function private.job_call_alert(text, text), private.job_call_ok(text), private.job_set_up_ok(text), private.job_words(text),
  private.check_job_call(text), private.job_called(text, bigint), private.kick_charge_job(), private.kick_payout_job()
  from public, anon, authenticated;
