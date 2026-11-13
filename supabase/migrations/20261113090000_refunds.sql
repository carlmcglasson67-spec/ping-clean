-- Ping Clean: payments PR 10, refunds and chargebacks (payments plan signed off by Carl on
-- 8 Nov 2026, step 4, C9, appendix A; intent/payments/refund-plan.md). TEST mode only.
--
--   admin_refund(payment, pence, reason, note)  the Ping team: ask for a refund
--   refund_to_send(refund)                      server: what to send Stripe for it
--   refunds_open()                              server (job): refunds with no final answer yet
--   stripe_refund_result(refund, …)             server (action, job, webhook): what Stripe said
--   stripe_dispute(payment intent, outcome)     server (webhook): a chargeback opened, won or lost
--
-- No new tables or columns. Every move follows the refund, payment and payout state maps, is
-- safe to repeat, and is audited. No browser writes a money row: admin_refund is the only
-- way in, checks the caller is an admin, and works out who carries what itself.

-- ---------------------------------------------------------------- alerts
alter table public.engine_alerts drop constraint engine_alerts_kind_check;
alter table public.engine_alerts add constraint engine_alerts_kind_check
  check (kind in ('release_failed', 'generate_failed', 'visit_needs_cover', 'visit_no_show', 'visit_unfinished',
                  'block_overlap', 'block_stalled', 'block_closed',
                  'charge_held', 'charge_blocked', 'payment_needs_customer', 'payment_failed',
                  'payout_failed', 'payout_stuck',
                  'refund_failed', 'refund_after_payout', 'payment_disputed'));
-- One open alert per clean for a dispute or a failed refund, however often Stripe repeats itself.
create unique index engine_alerts_one_open_refund on public.engine_alerts (visit_id, kind)
  where kind in ('payment_disputed', 'refund_failed') and resolved_at is null;
create unique index engine_alerts_one_open_stuck_clean on public.engine_alerts (visit_id, kind)
  where kind = 'payout_stuck' and visit_id is not null and resolved_at is null;

create function private.money_alert(p_kind text, p_visit uuid, p_message text) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.engine_alerts (kind, series_id, visit_id, message)
  select p_kind, v.series_id, v.id, left(p_message, 500) from public.visits v where v.id = p_visit
  on conflict do nothing
$$;
revoke all on function private.money_alert(text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- the payout guard, with refunds
-- As before, except: a cleaner's earnings for a clean may be less than their part of the
-- payment by exactly what succeeded refunds took from them, and a part-refunded payment can
-- (or one Ping refunded in full out of its own pocket) can still go to the bank. The amount is checked when the row is written, when its amount
-- changes and when it goes into a bank payout; a row already with the bank keeps the amount
-- that was sent.
create or replace function private.check_payout_matches_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.payments;
  visit_cleaner uuid;
  net integer;
begin
  if tg_op = 'UPDATE' and (new.payment_id, new.visit_id, new.cleaner_id) is distinct from (old.payment_id, old.visit_id, old.cleaner_id) then
    raise exception 'A payout can''t be moved to another payment, clean or cleaner' using errcode = 'PC043';
  end if;
  select * into p from public.payments where id = new.payment_id;
  select cleaner_id into visit_cleaner from public.visits where id = new.visit_id;
  if p.visit_id is distinct from new.visit_id or visit_cleaner is distinct from new.cleaner_id then
    raise exception 'A payout must be the cleaner''s part of a payment for their own clean' using errcode = 'PC043';
  end if;
  if tg_op = 'INSERT' or new.amount_pence is distinct from old.amount_pence
     or (new.status = 'in_batch' and old.status is distinct from 'in_batch') then
    select p.cleaner_amount_pence - coalesce(sum(r.cleaner_part_pence), 0) into net
    from public.refunds r where r.payment_id = p.id and r.status = 'succeeded';
    if new.amount_pence <> net then
      raise exception 'A payout must be the cleaner''s part of a payment for their own clean' using errcode = 'PC043';
    end if;
  end if;
  if new.batch_id is not null
     and (select b.cleaner_id from public.payout_batches b where b.id = new.batch_id) is distinct from new.cleaner_id then
    raise exception 'A payout can only go into its own cleaner''s bank payout' using errcode = 'PC043';
  end if;
  -- Made only from money actually collected; sent to the bank only while it still stands
  -- (not disputed or lost) and no refund is part-way through.
  if tg_op = 'INSERT' and p.status <> 'succeeded' then
    raise exception 'A payout needs a succeeded payment' using errcode = 'PC043';
  end if;
  if tg_op = 'UPDATE' and new.status = 'in_batch' and old.status is distinct from 'in_batch'
     and (p.status not in ('succeeded', 'partially_refunded', 'refunded')
          or exists (select 1 from public.refunds r where r.payment_id = p.id and r.status = 'pending')) then
    raise exception 'A payout needs a payment that still stands' using errcode = 'PC043';
  end if;
  return null;
end $$;

-- Who is due (as PR 9): a part-refunded clean still pays out what's left of it.
create or replace function private.payout_rows_due(p_cleaner uuid) returns setof public.payouts
language sql stable security definer set search_path = '' as $$
  select po.* from public.payouts po
  join public.payments pay on pay.id = po.payment_id
  join public.cleaners c on c.id = po.cleaner_id
  where (p_cleaner is null or po.cleaner_id = p_cleaner)
    -- Refunded in full still pays the cleaner when Ping carried the refund: a refund the cleaner
    -- shared in full has already cancelled their row.
    and pay.status in ('succeeded', 'partially_refunded', 'refunded')
    and not exists (select 1 from public.refunds r where r.payment_id = pay.id and r.status = 'pending')
    and c.stripe_account_id is not null and c.stripe_payouts_enabled
    and ((po.status = 'pending' and po.available_after <= now())
      or (po.status = 'failed' and c.stripe_status_at > po.updated_at + interval '1 hour'
          and (select count(*) from public.payout_batches f
               where f.cleaner_id = po.cleaner_id and f.status = 'failed' and f.stripe_payout_id is not null
                 and f.created_at > now() - interval '7 days') < 3))
    and not exists (select 1 from public.payout_batches recent
                    where recent.cleaner_id = po.cleaner_id and recent.created_at > now() - interval '20 hours')
$$;

-- ---------------------------------------------------------------- the payment map, with one more move
-- As before, plus disputed → refunded: a chargeback won on a payment that had been refunded
-- in full while the dispute was open.
create or replace function private.check_payment_move() returns trigger
language plpgsql set search_path = '' as $$
declare
  ok boolean;
begin
  if new.status = old.status then return new; end if;
  ok := case old.status::text
    when 'pending'            then new.status::text in ('processing', 'failed')
    when 'processing'         then new.status::text in ('succeeded', 'requires_action', 'failed')
    when 'requires_action'    then new.status::text in ('processing', 'succeeded', 'failed')
    when 'failed'             then new.status::text in ('processing', 'failed_final')
    when 'failed_final'       then new.status::text in ('processing')               -- an admin retry
    when 'succeeded'          then new.status::text in ('partially_refunded', 'refunded', 'disputed')
    when 'partially_refunded' then new.status::text in ('refunded', 'disputed')
    when 'disputed'           then new.status::text in ('succeeded', 'partially_refunded', 'refunded', 'dispute_lost')
    else false                                                                      -- refunded, dispute_lost: final
  end;
  if not ok then
    raise exception 'A payment can''t go from % to %', old.status, new.status using errcode = 'PC040';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- keeping a cleaner's earnings right
-- What a cleaner is owed for a clean = their part of the payment, less their part of every
-- refund that has succeeded. This puts every row of theirs that hasn't gone to the bank
-- (waiting, held, or sent back by the bank) on exactly that figure, or cancels it when nothing
-- is left. Called whenever a refund settles and whenever rows come back out of a bank payout,
-- so a row can never be left on a figure the payout guard would refuse.
create function private.settle_payout_amount(p_payment uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  net integer;
  po public.payouts;
begin
  select p.cleaner_amount_pence - coalesce((select sum(r.cleaner_part_pence) from public.refunds r
                                            where r.payment_id = p.id and r.status = 'succeeded'), 0)
    into net from public.payments p where p.id = p_payment;
  for po in select * from public.payouts where payment_id = p_payment and status in ('pending', 'held', 'failed') for update loop
    if net <= 0 then
      if po.status = 'failed' then  -- the map has no failed → cancelled
        update public.payouts set status = 'held', held_reason = 'admin_review' where id = po.id;
      end if;
      update public.payouts set status = 'cancelled' where id = po.id;
    elsif po.amount_pence <> net then
      update public.payouts set amount_pence = net where id = po.id;
    end if;
  end loop;
end $$;
revoke all on function private.settle_payout_amount(uuid) from public, anon, authenticated;

-- Rows coming back out of a bank payout (PR 9's fail_batch), now put right on the way out: a
-- refund may have settled while they were with the bank.
create or replace function private.fail_batch(p_batch uuid, p_error text, p_return boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  pay uuid;
begin
  update public.payout_batches
     set status = 'failed', failure_reason = left(coalesce(nullif(p_error, ''), 'unknown'), 300) where id = p_batch;
  update public.payouts set status = 'failed' where batch_id = p_batch and status = 'in_batch';
  for pay in select distinct payment_id from public.payouts where batch_id = p_batch and status = 'failed' loop
    perform private.settle_payout_amount(pay);
  end loop;
  if p_return then
    update public.payouts set status = 'pending', batch_id = null, stripe_payout_id = null
     where batch_id = p_batch and status = 'failed';
  end if;
end $$;

-- One bank payout (as PR 9), except a row that isn't on the right figure is left out and the
-- team told, instead of stopping every other clean that cleaner is owed for.
create or replace function public.payout_batch_open(p_cleaner uuid, p_available_pence integer)
returns table (batch_id uuid, cleaner_account_id text, amount_pence integer, idempotency_key text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.cleaners;
  r public.payouts;
  ids uuid[] := '{}';
  total integer := 0;
  bid uuid := gen_random_uuid();
  net integer;
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
    select p.cleaner_amount_pence - coalesce((select sum(f.cleaner_part_pence) from public.refunds f
                                              where f.payment_id = p.id and f.status = 'succeeded'), 0)
      into net from public.payments p where p.id = r.payment_id;
    if r.amount_pence <> net then
      perform private.money_alert('payout_stuck', r.visit_id,
        'A cleaner''s earnings for this clean don''t match what''s left after refunds, so they were left out of their bank payout. Nothing wrong was paid. Tell the main session.');
      continue;
    end if;
    exit when total + r.amount_pence > coalesce(p_available_pence, 0);
    total := total + r.amount_pence;
    ids := ids || r.id;
  end loop;
  if total = 0 then return; end if;

  insert into public.payout_batches (id, cleaner_id, amount_pence, idempotency_key)
  values (bid, p_cleaner, total, 'payout-batch:' || bid);
  update public.payouts set status = 'pending', held_reason = null, batch_id = null, stripe_payout_id = null where id = any (ids) and status = 'failed';
  update public.payouts set status = 'in_batch', batch_id = bid where id = any (ids);

  batch_id := bid; cleaner_account_id := c.stripe_account_id; amount_pence := total;
  idempotency_key := 'payout-batch:' || bid;
  return next;
end $$;

-- ---------------------------------------------------------------- asking for a refund
-- The Ping team only. p_reason decides who carries it (plan, step 4):
--   clean_quality, no_show      the cleaner and Ping, in the proportion the clean was split
--   ping_error, goodwill, other Ping alone
-- Ping's part of a shared refund = refund × fee ÷ price, to the nearest penny, and never more
-- than is left of the fee; the cleaner's part is the rest. One refund at a time per payment.
-- While it is with Stripe the cleaner's unpaid earnings for the clean are held.
create function public.admin_refund(p_payment uuid, p_amount_pence integer, p_reason text, p_note text)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
  rid uuid := gen_random_uuid();
  fee_left integer;
  cleaner_left integer;
  ping_part integer;
  cleaner_part integer;
begin
  if not private.is_admin() then
    raise exception 'Only the Ping team can refund a payment' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('clean_quality', 'ping_error', 'goodwill', 'no_show', 'other') then
    raise exception 'Choose why this is being refunded' using errcode = 'PC049';
  end if;
  select * into p from public.payments where id = p_payment for update;
  if not found or p.kind <> 'visit' or p.status not in ('succeeded', 'partially_refunded') or p.stripe_payment_intent_id is null then
    raise exception 'That payment can''t be refunded' using errcode = 'PC048';
  end if;
  if exists (select 1 from public.refunds r where r.payment_id = p.id and r.status = 'pending') then
    raise exception 'A refund for this payment is already on its way' using errcode = 'PC049';
  end if;
  if p_amount_pence is null or p_amount_pence <= 0 or p_amount_pence > p.amount_pence - p.refunded_pence then
    raise exception 'A refund can''t be more than is left of the payment' using errcode = 'PC042';
  end if;

  select p.application_fee_pence - coalesce(sum(r.ping_part_pence) filter (where r.reason in ('clean_quality', 'no_show')), 0),
         p.cleaner_amount_pence - coalesce(sum(r.cleaner_part_pence), 0)
    into fee_left, cleaner_left
  from public.refunds r where r.payment_id = p.id and r.status = 'succeeded';

  if p_reason in ('clean_quality', 'no_show') then
    ping_part := least(round(p_amount_pence::numeric * p.application_fee_pence / p.amount_pence)::integer, fee_left, p_amount_pence);
    cleaner_part := p_amount_pence - ping_part;
    if cleaner_part > cleaner_left then
      -- More than is left of the cleaner's part (earlier refunds were carried by Ping): Ping
      -- carries the difference.
      cleaner_part := cleaner_left;
      ping_part := p_amount_pence - cleaner_part;
    end if;
  else
    ping_part := p_amount_pence;
    cleaner_part := 0;
  end if;

  perform set_config('app.actor', 'admin:' || (select auth.uid()), true);
  insert into public.refunds (id, payment_id, amount_pence, cleaner_part_pence, ping_part_pence, reason, note, requested_by, idempotency_key)
  values (rid, p.id, p_amount_pence, cleaner_part, ping_part, p_reason, nullif(btrim(p_note), ''), (select auth.uid()), 'refund:' || rid);
  if cleaner_part > 0 then
    update public.payouts set status = 'held', held_reason = 'refund_pending'
     where payment_id = p.id and status = 'pending';
  end if;
  return rid;
end $$;

-- ---------------------------------------------------------------- sending it
create function public.refund_to_send(p_refund uuid)
returns table (refund_id uuid, payment_intent_id text, amount_pence integer, shared boolean, idempotency_key text)
language sql stable security definer set search_path = '' as $$
  select r.id, p.stripe_payment_intent_id, r.amount_pence, r.cleaner_part_pence > 0, r.idempotency_key
  from public.refunds r join public.payments p on p.id = r.payment_id
  where r.id = p_refund and r.status = 'pending' and r.stripe_refund_id is null
$$;

-- Refunds with no final answer: never reached Stripe (sent again, same key, while Stripe still
-- remembers it), or with Stripe for over an hour without a word (the job asks Stripe). Either
-- one still open after 23 hours: a person looks.
create function public.refunds_open()
returns table (refund_id uuid, mode text, payment_intent_id text, amount_pence integer, shared boolean, idempotency_key text, stripe_refund_id text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform set_config('app.actor', 'job:refunds', true);
  perform private.money_alert('refund_failed', p.visit_id,
            case when r.stripe_refund_id is null
                 then 'A refund was asked for but never reached Stripe. Nothing has gone back to the customer. Tell the main session.'
                 else 'A refund has been with Stripe for a day with no answer. Check it in Stripe, then tell the main session.' end)
  from public.refunds r join public.payments p on p.id = r.payment_id
  where r.status = 'pending' and r.created_at < now() - interval '23 hours';
  return query
    select r.id, case when r.stripe_refund_id is null then 'send' else 'check' end, p.stripe_payment_intent_id,
           r.amount_pence, r.cleaner_part_pence > 0, r.idempotency_key, r.stripe_refund_id
    from public.refunds r join public.payments p on p.id = r.payment_id
    where r.status = 'pending'
      and ((r.stripe_refund_id is null and r.created_at between now() - interval '23 hours' and now() - interval '10 minutes')
        or (r.stripe_refund_id is not null and r.updated_at < now() - interval '1 hour'))
    order by r.created_at limit 50;
end $$;

-- ---------------------------------------------------------------- what Stripe said
-- From the admin's own request (Stripe's direct answer), the job and the webhook. The Stripe
-- refund id, the amount and (when given) the PaymentIntent must be this refund's, or nothing
-- changes.
--   p_outcome 'succeeded' | 'failed' | 'pending'
-- Returns 'succeeded' | 'failed' | 'pending' | 'already' | 'unknown' | 'mismatch'.
create function public.stripe_refund_result(
  p_refund uuid, p_stripe_refund text, p_outcome text, p_amount integer, p_error text, p_payment_intent text default null
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.refunds;
  p public.payments;
  total integer;
begin
  perform set_config('app.actor', 'stripe', true);
  if p_outcome not in ('succeeded', 'failed', 'pending') then
    raise exception 'Unknown refund result' using errcode = '22023';
  end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return 'unknown'; end if;
  select * into p from public.payments where id = r.payment_id for update;

  if p_stripe_refund is not null then
    if (r.stripe_refund_id is not null and r.stripe_refund_id <> p_stripe_refund)
       or p_amount is distinct from r.amount_pence
       or (p_payment_intent is not null and p_payment_intent is distinct from p.stripe_payment_intent_id) then
      perform private.money_alert('refund_failed', p.visit_id,
        'Stripe reported a refund that doesn''t match Ping''s record (refund, payment or amount). Nothing was recorded. Check Stripe, then tell the main session.');
      return 'mismatch';
    end if;
    if r.stripe_refund_id is null then
      update public.refunds set stripe_refund_id = p_stripe_refund where id = r.id;
    end if;
  end if;

  if p_outcome = 'pending' then
    update public.refunds set updated_at = now() where id = r.id and status = 'pending';  -- asked; ask again in an hour
    return 'pending';
  end if;

  if p_outcome = 'succeeded' then
    if r.status = 'failed' then
      -- Ping recorded this refund as failed, yet Stripe says the customer has it. Nothing is
      -- changed here; a person must look before anyone refunds it again.
      perform private.money_alert('refund_failed', p.visit_id,
        'Stripe says a refund went through that Ping had recorded as failed. The customer may already have the money: do NOT refund it again. Check Stripe and tell the main session.');
      return 'already';
    end if;
    if r.status <> 'pending' then return 'already'; end if;
    if p_stripe_refund is null then return 'mismatch'; end if;
    if p.status = 'dispute_lost' then
      -- The customer's bank already took the whole payment back. The refund guard refuses this.
      perform private.money_alert('refund_failed', p.visit_id,
        'Stripe refunded a payment that was already lost to a chargeback. Check Stripe and tell the main session.');
      return 'mismatch';
    end if;
    update public.refunds set status = 'succeeded' where id = r.id;
    total := p.refunded_pence + r.amount_pence;
    -- A payment under dispute keeps saying so: the chargeback's outcome settles its state
    -- (stripe_dispute), from the refunded total recorded here.
    update public.payments
       set refunded_pence = total,
           status = case when p.status = 'disputed' then status
                         when total >= amount_pence then 'refunded'::public.payment_status
                         else 'partially_refunded'::public.payment_status end
     where id = p.id;
    if r.cleaner_part_pence > 0 then
      if exists (select 1 from public.payouts where payment_id = p.id and status in ('in_batch', 'paid')) then
        perform private.money_alert('refund_after_payout', p.visit_id,
          'A refund took ' || to_char(r.cleaner_part_pence / 100.0, 'FM£999990.00') || ' from a cleaner whose pay for this clean was already with their bank. Stripe takes it from their next earnings; if there are none, Ping covers it. Review it with the cleaner.');
      end if;
      perform private.settle_payout_amount(p.id);
      update public.payouts set status = 'pending', held_reason = null
       where payment_id = p.id and status = 'held' and held_reason = 'refund_pending';
    end if;
    return 'succeeded';
  end if;

  -- failed
  if r.status = 'failed' then return 'already'; end if;
  if r.status = 'succeeded' then
    -- Stripe took a refund back after saying it had gone. The payment stays as it shows; the
    -- cleaner's unpaid earnings for the clean wait for a person rather than go out on a figure
    -- that may be wrong.
    update public.refunds set status = 'failed', failure_reason = left(coalesce(nullif(p_error, ''), 'unknown'), 300) where id = r.id;
    update public.payouts set status = 'held', held_reason = 'admin_review' where payment_id = p.id and status in ('pending', 'failed');
    perform private.settle_payout_amount(p.id);
    perform private.money_alert('refund_failed', p.visit_id,
      'Stripe reversed a refund after it had shown as done (' || left(coalesce(p_error, 'unknown'), 80) || '). The customer has not had the money. The app still shows it refunded, and the cleaner''s unpaid earnings for the clean are held. Tell the main session.');
    return 'failed';
  end if;
  update public.refunds set status = 'failed', failure_reason = left(coalesce(nullif(p_error, ''), 'unknown'), 300) where id = r.id;
  update public.payouts set status = 'pending', held_reason = null
   where payment_id = p.id and status = 'held' and held_reason = 'refund_pending';
  perform private.money_alert('refund_failed', p.visit_id,
    'A refund didn''t go through (' || left(coalesce(p_error, 'unknown'), 80) || '). Nothing has gone back to the customer. Try it again from Payments.');
  return 'failed';
end $$;

-- ---------------------------------------------------------------- chargebacks
-- From the webhook. The payment is found by its PaymentIntent (unique, set by the charge job).
-- payments.dispute_status remembers where the chargeback got to, so an "opened" that arrives
-- after its own "closed" does nothing.
--   p_outcome 'opened' | 'won' | 'lost'
-- Returns 'disputed' | 'won' | 'lost' | 'already' | 'unknown'.
create function public.stripe_dispute(p_payment_intent text, p_outcome text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  p public.payments;
  paid_out boolean;
begin
  perform set_config('app.actor', 'stripe-webhook', true);
  if p_outcome not in ('opened', 'won', 'lost') then
    raise exception 'Unknown dispute result' using errcode = '22023';
  end if;
  select * into p from public.payments where stripe_payment_intent_id = p_payment_intent for update;
  if not found then return 'unknown'; end if;

  if p_outcome = 'opened' then
    if p.dispute_status is not null then return 'already'; end if;
    if p.status not in ('succeeded', 'partially_refunded') then
      -- Refunded in full already, or never paid: nothing of Ping's to hold, but the team should
      -- know the customer's bank has opened one.
      perform private.money_alert('payment_disputed', p.visit_id,
        'The customer''s bank opened a chargeback on a payment that is ' || replace(p.status::text, '_', ' ') || '. Answer it in Stripe (say it was already refunded, if it was).');
      return 'already';
    end if;
    update public.payments set status = 'disputed', dispute_status = 'open' where id = p.id;
    -- Nothing of the cleaner's for this clean goes to the bank while it's open: rows waiting,
    -- rows held for anything else, and rows the bank sent back.
    update public.payouts set status = 'held', held_reason = 'dispute_open' where payment_id = p.id and status in ('pending', 'failed');
    update public.payouts set held_reason = 'dispute_open' where payment_id = p.id and status = 'held';
    select exists (select 1 from public.payouts where payment_id = p.id and status in ('in_batch', 'paid')) into paid_out;
    perform private.money_alert('payment_disputed', p.visit_id,
      'The customer''s bank has disputed this clean''s payment (a chargeback). Stripe sets a deadline: answer it in Stripe with the clean''s photos and checklist. '
      || case when paid_out then 'The cleaner has already been paid for it.' else 'The cleaner''s earnings for it are held until it''s settled.' end);
    return 'disputed';
  end if;

  if p.status <> 'disputed' then return 'already'; end if;
  if p_outcome = 'won' then
    -- Back to where its refunds leave it (a refund may have settled while it was open).
    update public.payments
       set dispute_status = 'won',
           status = (case when p.refunded_pence >= p.amount_pence then 'refunded'
                          when p.refunded_pence > 0 then 'partially_refunded' else 'succeeded' end)::public.payment_status
     where id = p.id;
    perform private.settle_payout_amount(p.id);
    update public.payouts set status = 'pending', held_reason = null
     where payment_id = p.id and status = 'held' and held_reason = 'dispute_open'
       and not exists (select 1 from public.refunds r where r.payment_id = p.id and r.status = 'pending');
    update public.payouts set held_reason = 'refund_pending'
     where payment_id = p.id and status = 'held' and held_reason = 'dispute_open';
    update public.engine_alerts set resolved_at = now() where visit_id = p.visit_id and kind = 'payment_disputed' and resolved_at is null;
    return 'won';
  end if;

  update public.payments set status = 'dispute_lost', dispute_status = 'lost' where id = p.id;
  select exists (select 1 from public.payouts where payment_id = p.id and status in ('in_batch', 'paid')) into paid_out;
  update public.payouts set status = 'cancelled' where payment_id = p.id and status = 'held';
  update public.engine_alerts set resolved_at = now() where visit_id = p.visit_id and kind = 'payment_disputed' and resolved_at is null;
  perform private.money_alert('payment_disputed', p.visit_id,
    'The chargeback on this clean was lost: the customer''s bank kept the money and Ping carries it. '
    || case when paid_out then 'The cleaner was already paid for it; review it with them.'
            else 'The cleaner won''t be paid for it by Ping, but their part is still in their Stripe balance: reverse the transfer in Stripe, then tell the main session.' end);
  return 'lost';
end $$;

-- The hourly job also wakes for refunds with no final answer.
create or replace function private.payouts_due() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
      select 1 from public.payout_batches b
      where b.status = 'created'
        and ((b.stripe_payout_id is null and b.created_at < now() - interval '10 minutes')
          or (b.stripe_payout_id is not null and b.sent_at < now() - interval '30 minutes')))
    or exists (select 1 from private.payout_rows_due(null))
    or exists (select 1 from public.refunds r
               where r.status = 'pending'
                 and ((r.stripe_refund_id is null and r.created_at < now() - interval '10 minutes')
                   or (r.stripe_refund_id is not null and r.updated_at < now() - interval '1 hour')))
$$;

-- ---------------------------------------------------------------- grants
revoke all on function public.admin_refund(uuid, integer, text, text) from public, anon;
grant execute on function public.admin_refund(uuid, integer, text, text) to authenticated;  -- checks is_admin inside
revoke all on function public.refund_to_send(uuid), public.refunds_open(),
  public.stripe_refund_result(uuid, text, text, integer, text, text), public.stripe_dispute(text, text) from public, anon, authenticated;
grant execute on function public.refund_to_send(uuid), public.refunds_open(),
  public.stripe_refund_result(uuid, text, text, integer, text, text), public.stripe_dispute(text, text) to service_role;
