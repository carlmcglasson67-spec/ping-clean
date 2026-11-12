-- Ping Clean: payments PR 7, what happens after the last failed try (Carl's decisions,
-- 12 Nov 2026; intent/payments/hold-plan.md). Stripe TEST mode only.
--
--   * The block goes ON HOLD: the cleaner is told not to go, cleans that fall during the hold
--     are skipped and never charged, and it comes back on as soon as the customer pays.
--   * If it's still unpaid after settings.payment_pause_days (7), the block ends and the
--     cleaner is freed up.
--   * The customer is emailed: a failed payment, a payment their bank wants confirmed, the
--     block going on hold, the block ending. Emails are QUEUED here; the sender, and the
--     page the emails link to, arrive in the next PR (nothing is sent until then).
--
-- This is the first thing that pauses a block (TODO(pause) in the engine). A held block keeps
-- its cleaner and its dates; the block does not get longer to make up for skipped cleans.

-- ---------------------------------------------------------------- settings
alter table public.settings add column payment_pause_days integer check (payment_pause_days between 1 and 60);
update public.settings set payment_pause_days = 7 where id;
grant update (payment_pause_days) on public.settings to authenticated;  -- admins only, by policy

-- ---------------------------------------------------------------- why a block is on hold
-- Private: the cleaner sees that the block is paused (series.status), never that it is
-- because the customer's card failed.
create table private.series_holds (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id),
  reason text not null check (reason in ('payment_failed')),
  held_at timestamptz not null default now(),
  released_at timestamptz,
  outcome text check (outcome in ('resumed', 'ended')),
  constraint series_holds_outcome check ((released_at is null) = (outcome is null))
);
alter table private.series_holds enable row level security;
revoke all on private.series_holds from public, anon, authenticated;
create unique index series_holds_one_open on private.series_holds (series_id) where released_at is null;
create trigger series_holds_audit after insert or update on private.series_holds
  for each row execute function private.audit_row();

-- A clean skipped because its block was on hold.
alter table public.visits drop constraint visits_cancel_reason_check;
alter table public.visits add constraint visits_cancel_reason_check check (cancel_reason in
  ('customer', 'customer_late', 'block_ended', 'cleaner_no_show', 'no_access', 'admin', 'payment_hold'));

-- ---------------------------------------------------------------- emails to the customer
-- An outbox: rows are written in the same transaction as the thing they're about, and the
-- server sends them (lib/notify). `dedupe` makes each notice happen once however often the
-- thing that caused it is replayed. No message text here, only what it is about.
create table private.customer_notices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id),
  kind text not null check (kind in ('payment_failed', 'payment_needs_confirming', 'block_on_hold', 'block_ended_unpaid')),
  payment_id uuid references public.payments (id) on delete restrict,
  series_id uuid references public.series (id),
  dedupe text not null unique check (char_length(dedupe) <= 200),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  attempts smallint not null default 0 check (attempts between 0 and 10),
  sent_at timestamptz,
  last_error text check (char_length(last_error) <= 200)
);
alter table private.customer_notices enable row level security;
revoke all on private.customer_notices from public, anon, authenticated;
create index customer_notices_unsent_idx on private.customer_notices (created_at) where sent_at is null;

create function private.queue_notice(p_kind text, p_payment uuid, p_series uuid, p_dedupe text) returns void
language sql volatile security definer set search_path = '' as $$
  insert into private.customer_notices (customer_id, kind, payment_id, series_id, dedupe)
  select coalesce(p.customer_id, s.customer_id), p_kind, p.id, coalesce(s.id, v.series_id), left(p_dedupe, 200)
  from (select 1) one
  left join public.payments p on p.id = p_payment
  left join public.visits v on v.id = p.visit_id
  left join public.series s on s.id = coalesce(p_series, v.series_id)
  where coalesce(p.customer_id, s.customer_id) is not null
  on conflict (dedupe) do nothing
$$;

-- ---------------------------------------------------------------- hold, skip, resume
-- Puts a clean's block on hold if Carl's setting says a failed payment pauses the block.
-- True when the block is on hold afterwards.
create function private.hold_block_for_payment(p_visit uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  sid uuid;
  s public.series;
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
  on conflict (series_id) where released_at is null do nothing;
  return true;
end $$;

-- Cleans whose day passed while the block was on hold: skipped, never charged.
create function private.skip_held_visits(p_series uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.visits
     set status = 'skipped', cancelled_at = now(), cancel_reason = 'payment_hold'
   where series_id = p_series and status = 'scheduled' and scheduled_date < private.london_today();
  get diagnostics n = row_count;
  return n;
end $$;

-- Back on, once nothing in the block is unpaid for good. Called when a payment succeeds.
create function private.release_payment_hold(p_series uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  h private.series_holds;
  s public.series;
begin
  select * into h from private.series_holds where series_id = p_series and released_at is null for update;
  if not found then return false; end if;
  if exists (select 1 from public.payments p join public.visits v on v.id = p.visit_id
             where v.series_id = p_series and p.status = 'failed_final') then
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

-- Nightly: skip the cleans that passed on hold, and end blocks still unpaid after Carl's
-- limit (settings.payment_pause_days; not set → never ended automatically).
create function private.run_payment_holds() returns integer
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
      perform private.close_block(h.series_id, null,
        'The customer''s card failed and the block was on hold for ' || days || ' days without payment, so it was ended. The unpaid clean is still owed.');
      update private.series_holds set released_at = now(), outcome = 'ended' where id = h.id;
      perform private.queue_notice('block_ended_unpaid', null, h.series_id, 'block_ended_unpaid:' || h.id);
      ended := ended + 1;
    end if;
  end loop;
  return ended;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ping-payment-holds', '45 2 * * *', 'select private.run_payment_holds()');
  end if;
end $$;

-- ---------------------------------------------------------------- a failed try (replaces PR 6's)
-- As before, and now: the customer is emailed about each failed try, and after the last one
-- the block goes on hold (if Carl's setting says so) and the email says that instead.
create or replace function private.payment_failed_now(p_payment uuid, p_code text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
  hours integer[];
  next_at timestamptz;
  held boolean;
begin
  select * into p from public.payments where id = p_payment for update;
  select payment_retry_hours into hours from public.settings limit 1;
  if hours is not null and p.attempts between 1 and cardinality(hours) and p.attempts < 10 then
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

-- ---------------------------------------------------------------- what Stripe said (replaces PR 6's)
-- As before, and now: a success takes the block off hold, and "the bank wants the customer
-- to confirm" emails the customer.
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
    update public.payments set status = 'requires_action', last_error_code = 'authentication_required' where id = p.id;
    perform private.payment_alert('payment_needs_customer', p.visit_id,
      'The customer''s bank wants them to confirm this payment. They''ve been emailed a link; nothing is retried without them.');
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

-- ---------------------------------------------------------------- the cleaner can't start a held clean
-- As 20261107090100_visit_day.sql, plus the hold: a clear "don't go" instead of the general
-- refusal.
create or replace function public.start_visit(p_visit uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  sid uuid;
  s public.series;
  v public.visits;
  tpl public.checklist_templates;
begin
  if not private.is_active_cleaner() then
    raise exception 'Only active Ping cleaners can start a clean' using errcode = '42501';
  end if;

  select series_id into sid from public.visits where id = p_visit and cleaner_id = me;
  if not found then
    raise exception 'That clean isn''t yours' using errcode = 'PC010';
  end if;
  -- Lock order: series, then visit.
  select * into s from public.series where id = sid for share;
  select * into v from public.visits where id = p_visit for update;

  if s.cleaner_id is distinct from me or v.cleaner_id is distinct from me then
    raise exception 'That clean isn''t yours' using errcode = 'PC010';
  end if;
  if v.status = 'in_progress' then
    return;  -- a retry in bad signal is harmless
  end if;
  if v.status = 'scheduled' and s.status = 'paused' then
    raise exception 'This block is on hold, so this clean isn''t going ahead. Ping will tell you when it''s back on.'
      using errcode = 'PC017';
  end if;
  if v.status <> 'scheduled' or s.status <> 'claimed' then
    raise exception 'That clean has already finished or isn''t going ahead' using errcode = 'PC012';
  end if;
  if v.scheduled_date <> private.london_today() then
    raise exception 'That clean is booked for another day' using errcode = 'PC011';
  end if;

  select * into tpl from public.checklist_templates where is_default;
  if not found then
    raise exception 'No checklist has been set up yet. Call the Ping office.' using errcode = 'PC015';
  end if;

  update public.visits set status = 'in_progress', started_at = now() where id = v.id;
  insert into public.checklist_items (visit_id, item_key, room, label, position)
  select v.id, i ->> 'key', i ->> 'room', i ->> 'label', (n - 1)::smallint
  from jsonb_array_elements(tpl.items) with ordinality as x (i, n)
  on conflict (visit_id, item_key) do nothing;
end $$;

-- ---------------------------------------------------------------- sending the emails
-- The server takes what's due (one copy at a time), sends it, and says how it went. A notice
-- that fails is tried again 10 minutes later, five times at most.
create function public.notices_claim(p_limit integer default 20)
returns table (notice_id uuid, kind text, email text, full_name text, payment_id uuid, amount_pence integer, clean_date date)
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
    email := null; full_name := null; amount_pence := null; clean_date := null;
    select pr.email, pr.full_name into email, full_name from public.profiles pr where pr.id = n.customer_id;
    select pay.amount_pence, v.scheduled_date into amount_pence, clean_date
      from public.payments pay join public.visits v on v.id = pay.visit_id where pay.id = n.payment_id;
    return next;
  end loop;
end $$;

create function public.notice_sent(p_notice uuid, p_error text) returns void
language sql volatile security definer set search_path = '' as $$
  update private.customer_notices
     set sent_at = case when p_error is null then now() end, last_error = left(p_error, 200)
   where id = p_notice and sent_at is null
$$;

-- ---------------------------------------------------------------- grants
revoke all on function private.queue_notice(text, uuid, uuid, text), private.hold_block_for_payment(uuid),
  private.skip_held_visits(uuid), private.release_payment_hold(uuid), private.run_payment_holds()
  from public, anon, authenticated;
revoke all on function public.notices_claim(integer), public.notice_sent(uuid, text) from public, anon, authenticated;
grant execute on function public.notices_claim(integer), public.notice_sent(uuid, text) to service_role;
