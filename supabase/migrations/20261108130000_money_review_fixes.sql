-- Ping Clean: payments PR 2c, fixes from the independent security review of the money
-- schema (8 Nov 2026). These only tighten what Carl signed off; no setting he chose changes.
--
--   1. A cleaner can't read their own Stripe account id.
--   2. A payout must come from a succeeded payment for the same clean, cleaner and amount.
--   3. A payment must belong to its clean's customer, and a clean's charge must be its price.
--   4. Settings: the cleaner's late-cancel share must be empty while it follows the clean's split.
--   5. Money rows can never be deleted or truncated, by anyone (the owner included).
--   6. Refunds and bank payouts only move along their maps; every money row starts at the
--      start; no refund on a payment that can't be refunded.
--   7. The audit log never stores Stripe ids, idempotency keys or a cleaner's Stripe account.
--   8. A held payout says why from a fixed list.

-- ---------------------------------------------------------------- 1. cleaners' Stripe account id
-- Readable only by server code (service role) and security-definer functions. Every other
-- column stays readable (RLS still decides which rows). Columns added later aren't granted
-- until someone decides they should be.
revoke select on public.cleaners from authenticated;
do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'cleaners' and column_name <> 'stripe_account_id';
  execute format('grant select (%s) on public.cleaners to authenticated', cols);
end $$;

-- ---------------------------------------------------------------- 3. payments belong to their visit
-- The customer on a payment is the clean's customer (no paying on someone else's clean).
alter table public.visits add constraint visits_id_customer_key unique (id, customer_id);
alter table public.payments add constraint payments_visit_customer_fkey
  foreign key (visit_id, customer_id) references public.visits (id, customer_id) on delete restrict;

-- A clean's own charge is exactly the clean's price, split exactly as the clean was split.
-- (Late-cancel fees are checked when the late-cancel flow is built, payments PR 7.)
create function private.check_payment_matches_visit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v public.visits;
begin
  if new.kind <> 'visit' then return null; end if;
  select * into v from public.visits where id = new.visit_id;
  if new.amount_pence <> v.price_pence
     or new.cleaner_amount_pence <> v.cleaner_earnings_pence
     or new.application_fee_pence <> v.ping_fee_pence then
    raise exception 'A charge for a clean must be the clean''s price and split' using errcode = 'PC044';
  end if;
  return null;
end $$;
-- After the row's own checks (so a split that doesn't add up still reports as a check failure).
create constraint trigger payments_match_visit
  after insert or update of visit_id, customer_id, kind, amount_pence, application_fee_pence, cleaner_amount_pence
  on public.payments for each row execute function private.check_payment_matches_visit();

-- ---------------------------------------------------------------- 2. payouts come from succeeded payments
-- Every payout row is made from one payment (plan: "a payout row is only ever made from a
-- succeeded payment"). Fails loudly if an old payout has none; there are none outside the seed.
alter table public.payouts alter column payment_id set not null;

create function private.check_payout_matches_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p public.payments;
  visit_cleaner uuid;
begin
  if tg_op = 'UPDATE' and (new.payment_id, new.visit_id, new.cleaner_id) is distinct from (old.payment_id, old.visit_id, old.cleaner_id) then
    raise exception 'A payout can''t be moved to another payment, clean or cleaner' using errcode = 'PC043';
  end if;
  select * into p from public.payments where id = new.payment_id;
  select cleaner_id into visit_cleaner from public.visits where id = new.visit_id;
  if p.visit_id is distinct from new.visit_id
     or visit_cleaner is distinct from new.cleaner_id
     or new.amount_pence <> p.cleaner_amount_pence then
    raise exception 'A payout must be the cleaner''s part of a payment for their own clean' using errcode = 'PC043';
  end if;
  -- Made only from money actually collected; sent to the bank only while it still stands
  -- (not refunded, disputed or lost). Partly refunded payouts are settled in payments PR 7.
  if (tg_op = 'INSERT' or (new.status = 'in_batch' and old.status is distinct from 'in_batch'))
     and p.status <> 'succeeded' then
    raise exception 'A payout needs a succeeded payment' using errcode = 'PC043';
  end if;
  return null;
end $$;
create constraint trigger payouts_match_payment
  after insert or update of payment_id, visit_id, cleaner_id, amount_pence, status
  on public.payouts for each row execute function private.check_payout_matches_payment();

-- ---------------------------------------------------------------- 4. settings
alter table public.settings add constraint settings_late_cancel_share_follows_split check (
  late_cancel_split is distinct from 'same_as_clean' or late_cancel_cleaner_share_bps is null);

-- ---------------------------------------------------------------- 5. money rows are never deleted
-- Kept for good (plan, K6). No API role may delete or truncate them, and a trigger refuses
-- even the database owner, row by row and table by table (a TRUNCATE ... CASCADE from
-- visits included).
revoke delete, truncate on public.payments, public.payouts, public.refunds, public.payout_batches
  from service_role, anon, authenticated;

create function private.refuse_money_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Payment records are kept for good and can''t be removed (%)', tg_table_name using errcode = 'PC045';
end $$;
create trigger payments_keep before delete on public.payments for each row execute function private.refuse_money_delete();
create trigger payouts_keep before delete on public.payouts for each row execute function private.refuse_money_delete();
create trigger refunds_keep before delete on public.refunds for each row execute function private.refuse_money_delete();
create trigger payout_batches_keep before delete on public.payout_batches for each row execute function private.refuse_money_delete();
create trigger payments_keep_all before truncate on public.payments for each statement execute function private.refuse_money_delete();
create trigger payouts_keep_all before truncate on public.payouts for each statement execute function private.refuse_money_delete();
create trigger refunds_keep_all before truncate on public.refunds for each statement execute function private.refuse_money_delete();
create trigger payout_batches_keep_all before truncate on public.payout_batches for each statement execute function private.refuse_money_delete();

-- ---------------------------------------------------------------- 6. state maps
-- Every money row starts at the start of its map; it reaches anything else only by moving.
create function private.check_money_start() returns trigger
language plpgsql set search_path = '' as $$
declare
  first text := tg_argv[0];
begin
  if new.status::text <> first then
    raise exception 'A new % row starts as %', tg_table_name, first using errcode = 'PC046';
  end if;
  return new;
end $$;
create trigger payments_start before insert on public.payments for each row execute function private.check_money_start('pending');
create trigger payouts_start before insert on public.payouts for each row execute function private.check_money_start('pending');
create trigger refunds_start before insert on public.refunds for each row execute function private.check_money_start('pending');
create trigger payout_batches_start before insert on public.payout_batches for each row execute function private.check_money_start('created');

-- Refunds: pending → succeeded | failed; Stripe can report a late failure (succeeded → failed).
-- Never back to pending, never off a failed one. A refund stays on its payment.
create function private.check_refund_move() returns trigger
language plpgsql set search_path = '' as $$
declare
  ok boolean;
begin
  if new.payment_id <> old.payment_id then
    raise exception 'A refund can''t be moved to another payment' using errcode = 'PC047';
  end if;
  if new.status = old.status then return new; end if;
  ok := case old.status
          when 'pending'   then new.status in ('succeeded', 'failed')
          when 'succeeded' then new.status = 'failed'
          else false
        end;
  if not ok then
    raise exception 'A refund can''t go from % to %', old.status, new.status using errcode = 'PC047';
  end if;
  return new;
end $$;
create trigger refunds_move before update on public.refunds
  for each row execute function private.check_refund_move();

-- Bank payouts: created → paid | failed; Stripe can report a late failure (paid → failed).
create function private.check_batch_move() returns trigger
language plpgsql set search_path = '' as $$
declare
  ok boolean;
begin
  if new.status = old.status then return new; end if;
  ok := case old.status
          when 'created' then new.status in ('paid', 'failed')
          when 'paid'    then new.status = 'failed'
          else false
        end;
  if not ok then
    raise exception 'A bank payout can''t go from % to %', old.status, new.status using errcode = 'PC041';
  end if;
  return new;
end $$;
create trigger payout_batches_move before update of status on public.payout_batches
  for each row execute function private.check_batch_move();

-- Refunds only on money that was taken and still stands: not on a pending, failed, disputed,
-- lost or fully refunded payment.
create function private.check_refund_payment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.payments
                 where id = new.payment_id and status in ('succeeded', 'partially_refunded')) then
    raise exception 'That payment can''t be refunded' using errcode = 'PC048';
  end if;
  return new;
end $$;
create trigger refunds_on_refundable before insert on public.refunds
  for each row execute function private.check_refund_payment();

-- ---------------------------------------------------------------- 7. audit redaction
-- The log records that these changed, never their values (as customer_billing already does).
drop trigger payments_audit on public.payments;
create trigger payments_audit after insert or update on public.payments
  for each row execute function private.audit_row('failure_reason', 'stripe_payment_intent_id', 'stripe_charge_id',
                                                  'cleaner_account_id', 'idempotency_key');
drop trigger payouts_audit on public.payouts;
create trigger payouts_audit after insert or update on public.payouts
  for each row execute function private.audit_row('stripe_payout_id', 'idempotency_key');
drop trigger refunds_audit on public.refunds;
create trigger refunds_audit after insert or update on public.refunds
  for each row execute function private.audit_row('note', 'failure_reason', 'stripe_refund_id', 'idempotency_key');
drop trigger payout_batches_audit on public.payout_batches;
create trigger payout_batches_audit after insert or update on public.payout_batches
  for each row execute function private.audit_row('failure_reason', 'stripe_payout_id', 'idempotency_key');
drop trigger cleaners_audit on public.cleaners;
create trigger cleaners_audit after insert or update or delete on public.cleaners
  for each row execute function private.audit_row('bio', 'availability', 'stripe_account_id');

-- ---------------------------------------------------------------- 8. why a payout is held
-- Fixed reasons (plan: held for a refund, a dispute or the admin), plus the two the payout
-- job needs. Free-text notes belong in the audit log, not here.
alter table public.payouts drop constraint payouts_held_reason_check;
alter table public.payouts add constraint payouts_held_reason_check check (held_reason in
  ('refund_pending', 'dispute_open', 'admin_review', 'cleaner_not_onboarded', 'payment_not_settled'));

-- ---------------------------------------------------------------- grants
revoke all on function private.check_payment_matches_visit(), private.check_payout_matches_payment(),
  private.refuse_money_delete(), private.check_money_start(), private.check_refund_move(),
  private.check_batch_move(), private.check_refund_payment() from public, anon, authenticated;
