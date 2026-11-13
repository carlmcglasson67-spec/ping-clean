-- Payments 12: the Ping team can refund a late-cancellation fee (intent/payments/fee-refund-plan.md).
-- No new table. One new reason, and admin_refund takes fees as well as cleans.

-- ---------------------------------------------------------------- the reason
alter table public.refunds drop constraint refunds_reason_check;
alter table public.refunds add constraint refunds_reason_check
  check (reason in ('clean_quality', 'ping_error', 'goodwill', 'no_show', 'other', 'fee_waived'));

-- ---------------------------------------------------------------- asking for a refund
-- As before (refunds), and now for a paid late-cancellation fee too. Who carries it:
--   clean_quality, no_show      a clean only: the cleaner and Ping, as the clean was split
--   fee_waived                  a fee only:   the cleaner and Ping, as the fee was split
--   ping_error, goodwill, other either:       Ping alone
create or replace function public.admin_refund(p_payment uuid, p_amount_pence integer, p_reason text, p_note text)
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
  if p_reason is null or p_reason not in ('clean_quality', 'ping_error', 'goodwill', 'no_show', 'other', 'fee_waived') then
    raise exception 'Choose why this is being refunded' using errcode = 'PC049';
  end if;
  select * into p from public.payments where id = p_payment for update;
  if not found or p.kind not in ('visit', 'late_cancel') or p.status not in ('succeeded', 'partially_refunded') or p.stripe_payment_intent_id is null then
    raise exception 'That payment can''t be refunded' using errcode = 'PC048';
  end if;
  -- A reason has to suit what was paid for: there was no clean to fault on a fee, and a
  -- clean's payment isn't a fee to waive.
  if (p.kind = 'late_cancel' and p_reason in ('clean_quality', 'no_show')) or (p.kind = 'visit' and p_reason = 'fee_waived') then
    raise exception 'That reason doesn''t fit this payment' using errcode = 'PC036';
  end if;
  if exists (select 1 from public.refunds r where r.payment_id = p.id and r.status = 'pending') then
    raise exception 'A refund for this payment is already on its way' using errcode = 'PC049';
  end if;
  if p_amount_pence is null or p_amount_pence <= 0 or p_amount_pence > p.amount_pence - p.refunded_pence then
    raise exception 'A refund can''t be more than is left of the payment' using errcode = 'PC042';
  end if;

  select p.application_fee_pence - coalesce(sum(r.ping_part_pence) filter (where r.reason in ('clean_quality', 'no_show', 'fee_waived')), 0),
         p.cleaner_amount_pence - coalesce(sum(r.cleaner_part_pence), 0)
    into fee_left, cleaner_left
  from public.refunds r where r.payment_id = p.id and r.status = 'succeeded';

  if p_reason in ('clean_quality', 'no_show', 'fee_waived') then
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

-- ---------------------------------------------------------------- alerts that say what was refunded
-- As before (refunds, late cancel). Only the words change: a refund or a lost chargeback on a
-- fee says "late-cancellation fee", not "clean".
create or replace function public.stripe_refund_result(
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
          'A refund took ' || to_char(r.cleaner_part_pence / 100.0, 'FM£999990.00') || ' from a cleaner whose ' || case when p.kind = 'late_cancel' then 'part of this late-cancellation fee' else 'pay for this clean' end || ' was already with their bank. Stripe takes it from their next earnings; if there are none, Ping covers it. Review it with the cleaner.');
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

create or replace function public.stripe_dispute(p_payment_intent text, p_outcome text) returns text
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
      case when p.kind = 'late_cancel'
        then 'The customer''s bank has disputed a late-cancellation fee (a chargeback). Stripe sets a deadline: answer it in Stripe with when the clean was booked for, when they cancelled, and the terms they agreed to. '
        else 'The customer''s bank has disputed this clean''s payment (a chargeback). Stripe sets a deadline: answer it in Stripe with the clean''s photos and checklist. ' end
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
    'The chargeback on this ' || case when p.kind = 'late_cancel' then 'late-cancellation fee' else 'clean' end || ' was lost: the customer''s bank kept the money and Ping carries it. '
    || case when paid_out then 'The cleaner was already paid for it; review it with them.'
            else 'The cleaner won''t be paid for it by Ping, but their part is still in their Stripe balance: reverse the transfer in Stripe, then tell the main session.' end);
  return 'lost';
end $$;
