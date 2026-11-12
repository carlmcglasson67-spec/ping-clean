-- Ping Clean: payments PR 8, the customer sorts a payment themselves, and the emails go out
-- (intent/payments/hold-plan.md, "Next PR"). Stripe TEST mode only.
--
--   customer_pay_begin(payment, customer)   server: the customer pressed "Pay now"
--   customer_payment_intent(payment, cust.) server: the PaymentIntent to check after the
--                                           bank's confirmation step
--   customer_card_series(payment, customer) server: the block a replacement card is saved for
--
-- All three are called by the server with the signed-in customer's id; each checks the
-- payment is that customer's. No browser calls them, and none of them changes an amount.

-- The customer's own tries are counted apart from the automatic ones: pressing "Pay now" and
-- being declined must not use up the tries Carl's schedule promises, or put the block on
-- hold early. Not readable by customers or cleaners (column grants).
alter table public.payments add column customer_tries smallint not null default 0 check (customer_tries between 0 and 10);

-- "Pay now": takes a payment that is waiting on the customer (their bank wants them to
-- confirm, or a try failed, or every try failed) and marks one more try as sent. The same
-- columns as charge_claim, plus `problem` when it can't go ahead:
--   not_found · already_paid · in_progress (a try is out, or about to be) · no_card ·
--   not_ready (the cleaner's account can't take money right now) · too_many
create function public.customer_pay_begin(p_payment uuid, p_customer uuid)
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
   where pay.id = p_payment and pay.customer_id = p_customer and pay.kind = 'visit' for update;
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

create function public.customer_payment_intent(p_payment uuid, p_customer uuid) returns text
language sql stable security definer set search_path = '' as $$
  select stripe_payment_intent_id from public.payments
  where id = p_payment and customer_id = p_customer and kind = 'visit'
$$;

create function public.customer_card_series(p_payment uuid, p_customer uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select v.series_id from public.payments p join public.visits v on v.id = p.visit_id
  where p.id = p_payment and p.customer_id = p_customer
$$;

-- The cron kick now also fires when an email is waiting (the same handler sends them).
create or replace function private.charges_due() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.payments pay
    where pay.kind = 'visit'
      and ((pay.status = 'pending' and (pay.next_retry_at is null or pay.next_retry_at <= now()))
        or (pay.status = 'failed' and pay.next_retry_at <= now())
        or (pay.status = 'processing' and pay.charge_started_at < now() - interval '10 minutes')))
    or exists (
    select 1 from private.customer_notices c
    where c.sent_at is null and c.attempts < 5
      and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes'))
$$;

revoke all on function public.customer_pay_begin(uuid, uuid), public.customer_payment_intent(uuid, uuid),
  public.customer_card_series(uuid, uuid) from public, anon, authenticated;
grant execute on function public.customer_pay_begin(uuid, uuid), public.customer_payment_intent(uuid, uuid),
  public.customer_card_series(uuid, uuid) to service_role;
