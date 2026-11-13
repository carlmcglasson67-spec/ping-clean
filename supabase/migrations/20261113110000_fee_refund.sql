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
    raise exception 'That reason doesn''t fit this payment' using errcode = 'PC049';
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
