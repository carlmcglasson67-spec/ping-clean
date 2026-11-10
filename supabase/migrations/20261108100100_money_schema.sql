-- Ping Clean: payments PR 2b, the money schema (payments plan, signed off by Carl on
-- 8 Nov 2026; intent/payments/plan.md appendix C). Stripe TEST mode only; no Stripe code here.
--
-- Rules (ping-money-rules): integer pence; price = cleaner earnings + Ping fee everywhere;
-- every number from settings; every money row written only by the server (service role)
-- or an admin function, never by a browser; every state change idempotent and audited.

-- ---------------------------------------------------------------- settings
-- Carl's decisions, 8 Nov 2026 (set here; admins can change them later):
--   * dispute window (payout delay): 72 hours                    → dispute_window_hours = 72
--   * late-cancellation notice: 24 hours                          → cancel_notice_hours = 24
--   * late-cancellation FEE: not set yet                          → late_cancel_fee_pence stays NULL
--   * cleaner's share of a late-cancel fee: the same split as a normal clean
--                                                                  → late_cancel_split = 'same_as_clean'
--   * failed charges: retry after 24 h and 72 h, then alert the admin and pause the rest of the block
--                                                                  → payment_retry_hours = {24,72},
--                                                                    failed_payment_pauses_block = true
--   * Ping pays Stripe's card fees out of its fee (destination charges: Stripe takes its fee
--     from the platform, so the cleaner always receives exactly cleaner_earnings_pence).
--   * cleaners must finish Stripe Connect set-up before they can claim (private.cleaner_payable,
--     enforced in claiming in payments PR 4).
--   * a customer who never pays: the cleaner is paid only from what's collected (a payout row
--     is only ever made from a succeeded payment); the admin may pay goodwill (PR 7).
-- Everything else without a decision stays NULL; its rule doesn't run and the admin is told:
--   couldnt_do_rule, no_access_rule, card_expiry_notice_days, late_cancel_when_unclaimed.
alter table public.settings
  add column late_cancel_split text check (late_cancel_split in ('same_as_clean', 'fixed_share')),
  add column payment_retry_hours integer[] check (
    payment_retry_hours is null
    or (cardinality(payment_retry_hours) between 1 and 5 and 0 < all (payment_retry_hours) and 721 > all (payment_retry_hours))),
  add column failed_payment_pauses_block boolean,
  add column couldnt_do_rule text check (couldnt_do_rule in ('charge_full', 'hold_for_admin')),
  add column no_access_rule text check (no_access_rule in ('no_charge', 'late_cancel_fee', 'admin_decides')),
  add column card_expiry_notice_days integer check (card_expiry_notice_days between 1 and 60),
  add column late_cancel_when_unclaimed text check (late_cancel_when_unclaimed in ('no_fee', 'charge_fee')),
  -- 'fixed_share' needs a share. With 'same_as_clean' the share comes from the clean's own split
  -- and late_cancel_cleaner_share_bps is ignored (the migration clears it).
  add constraint settings_late_cancel_share check (
    late_cancel_split is distinct from 'fixed_share' or late_cancel_cleaner_share_bps is not null);

update public.settings set
  dispute_window_hours = 72,
  cancel_notice_hours = 24,
  late_cancel_split = 'same_as_clean',
  late_cancel_cleaner_share_bps = null,
  payment_retry_hours = '{24,72}',
  failed_payment_pauses_block = true
where id;

grant update (late_cancel_split, payment_retry_hours, failed_payment_pauses_block, couldnt_do_rule,
              no_access_rule, card_expiry_notice_days, late_cancel_when_unclaimed)
  on public.settings to authenticated;  -- admins only, by policy

-- ---------------------------------------------------------------- customers' saved cards
-- One Stripe customer per Ping customer (C13; fixes A-4's "a second booking makes a second
-- Stripe customer"). Private: only server functions read or write it. Customers see their
-- card's brand, last four digits and expiry through public.my_saved_card(), nothing else.
create table private.customer_billing (
  customer_id uuid primary key references public.profiles (id),
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{6,64}$'),
  default_payment_method_id text check (default_payment_method_id ~ '^pm_[A-Za-z0-9]{6,64}$'),
  card_brand text check (char_length(card_brand) <= 20),
  card_last4 text check (card_last4 ~ '^[0-9]{4}$'),
  card_exp_month smallint check (card_exp_month between 1 and 12),
  card_exp_year smallint check (card_exp_year between 2000 and 2100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.customer_billing enable row level security;
revoke all on private.customer_billing from public, anon, authenticated;
create trigger customer_billing_touch before update on private.customer_billing
  for each row execute function private.touch_updated_at();
create trigger customer_billing_audit after insert or update on private.customer_billing
  for each row execute function private.audit_row('stripe_customer_id', 'default_payment_method_id', 'card_last4');

-- The Stripe customer now lives on the customer, not on each block.
alter table public.series_billing drop column stripe_customer_id;

create function public.my_saved_card()
returns table (brand text, last4 text, exp_month smallint, exp_year smallint)
language sql stable security definer set search_path = '' as $$
  select b.card_brand, b.card_last4, b.card_exp_month, b.card_exp_year
  from private.customer_billing b
  where b.customer_id = (select auth.uid()) and b.default_payment_method_id is not null
$$;

-- ---------------------------------------------------------------- cleaners' Stripe status
-- Written only from Stripe's account.updated webhook (service role). Not in the cleaner's
-- own update grant, so a cleaner can read but never set them.
alter table public.cleaners
  add column stripe_charges_enabled boolean not null default false,
  add column stripe_payouts_enabled boolean not null default false,
  add column stripe_details_submitted boolean not null default false,
  add column stripe_requirements_due boolean not null default false,
  add column stripe_status_at timestamptz,
  add constraint cleaners_stripe_account_shape check (stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]{6,64}$');

-- Can money for a clean reach this cleaner? (C10: required before claiming; used in PR 4.)
create function private.cleaner_payable(p_cleaner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.stripe_account_id is not null and c.stripe_charges_enabled and c.stripe_payouts_enabled
                   from public.cleaners c where c.id = p_cleaner), false)
$$;

-- ---------------------------------------------------------------- visits: why a clean was cancelled
alter table public.visits
  add column cancel_reason text check (cancel_reason in
    ('customer', 'customer_late', 'block_ended', 'cleaner_no_show', 'no_access', 'admin'));
-- Earlier cancellations (ending a block, before this column) were all blocks ending.
update public.visits set cancel_reason = 'block_ended' where status = 'cancelled' and cancel_reason is null;

-- ---------------------------------------------------------------- payments
-- One row per charge (a clean, or a late-cancellation fee). The cleaner's part and Ping's fee
-- are stored separately and must add up to the charge.
alter table public.payments
  add column cleaner_amount_pence integer check (cleaner_amount_pence >= 0),
  add column cleaner_account_id text check (cleaner_account_id ~ '^acct_[A-Za-z0-9]{6,64}$'),
  add column stripe_charge_id text unique,
  add column attempts smallint not null default 0 check (attempts between 0 and 10),
  add column next_retry_at timestamptz,
  add column last_error_code text check (char_length(last_error_code) <= 100),
  add column disputed_at timestamptz,
  add column dispute_status text check (dispute_status in ('open', 'won', 'lost'));
update public.payments set cleaner_amount_pence = amount_pence - application_fee_pence where cleaner_amount_pence is null;
alter table public.payments
  alter column cleaner_amount_pence set not null,
  add constraint payments_split_adds_up check (amount_pence = cleaner_amount_pence + application_fee_pence),
  add constraint payments_stripe_ids_shape check (
    (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]{6,64}$')
    and (stripe_charge_id is null or stripe_charge_id ~ '^(ch|py)_[A-Za-z0-9_]{6,64}$'));

-- A failed-for-good charge doesn't block a new one for the same clean either.
drop index public.payments_one_per_visit;
create unique index payments_one_per_visit on public.payments (visit_id, kind)
  where status not in ('failed', 'failed_final');

-- Only the moves on the map in money_states.sql. Anything else is refused (PC040), so a late
-- or replayed webhook can never send a refunded payment back to "succeeded".
create function private.check_payment_move() returns trigger
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
    when 'disputed'           then new.status::text in ('succeeded', 'partially_refunded', 'dispute_lost')
    else false                                                                      -- refunded, dispute_lost: final
  end;
  if not ok then
    raise exception 'A payment can''t go from % to %', old.status, new.status using errcode = 'PC040';
  end if;
  return new;
end $$;
create trigger payments_move before update of status on public.payments
  for each row execute function private.check_payment_move();

-- ---------------------------------------------------------------- refunds
-- Full or part. The reason decides who carries it (plan, step 4): the clean's fault → the
-- cleaner and Ping in proportion; Ping's fault → Ping alone; goodwill → as the admin chose.
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  amount_pence integer not null check (amount_pence > 0),
  cleaner_part_pence integer not null check (cleaner_part_pence >= 0),
  ping_part_pence integer not null check (ping_part_pence >= 0),
  reason text not null check (reason in ('clean_quality', 'ping_error', 'goodwill', 'no_show', 'other')),
  -- For the Ping team only (column grants below): customers and cleaners never see it.
  note text check (note is null or (note ~ '[[:alnum:]]{3,}' and char_length(note) <= 300)),
  requested_by uuid references public.profiles (id),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  stripe_refund_id text unique check (stripe_refund_id ~ '^re_[A-Za-z0-9_]{6,64}$'),
  idempotency_key text not null unique,
  failure_reason text check (char_length(failure_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refunds_parts_add_up check (amount_pence = cleaner_part_pence + ping_part_pence)
);
alter table public.refunds enable row level security;
create index refunds_payment_idx on public.refunds (payment_id);
create trigger refunds_touch before update on public.refunds
  for each row execute function private.touch_updated_at();
create trigger refunds_audit after insert or update on public.refunds
  for each row execute function private.audit_row('note', 'failure_reason');

-- Refunds that haven't failed never add up to more than the payment.
create function private.check_refund_total() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  total integer;
  paid integer;
begin
  select amount_pence into paid from public.payments where id = new.payment_id for update;
  select coalesce(sum(amount_pence), 0) into total from public.refunds
  where payment_id = new.payment_id and status <> 'failed';
  if total > paid then
    raise exception 'Refunds can''t add up to more than the payment' using errcode = 'PC042';
  end if;
  return new;
end $$;
create constraint trigger refunds_within_payment after insert or update of amount_pence, status on public.refunds
  for each row execute function private.check_refund_total();

revoke all on public.refunds from anon, authenticated;
grant select (id, payment_id, amount_pence, cleaner_part_pence, ping_part_pence, reason, status, created_at, updated_at)
  on public.refunds to authenticated;
create policy refunds_select on public.refunds
  for select to authenticated
  using ((select private.is_admin())
         or exists (select 1 from public.payments p where p.id = payment_id and p.customer_id = (select auth.uid())));

-- ---------------------------------------------------------------- payouts
-- One row per clean: the cleaner's earnings for it. Many are paid in one bank payout (a batch).
create table public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  cleaner_id uuid not null references public.cleaners (id),
  amount_pence integer not null check (amount_pence > 0),
  status text not null default 'created' check (status in ('created', 'paid', 'failed')),
  stripe_payout_id text unique check (stripe_payout_id ~ '^po_[A-Za-z0-9_]{6,64}$'),
  idempotency_key text not null unique,
  arrival_date date,
  failure_reason text check (char_length(failure_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payout_batches enable row level security;
create index payout_batches_cleaner_idx on public.payout_batches (cleaner_id, created_at desc);
create trigger payout_batches_touch before update on public.payout_batches
  for each row execute function private.touch_updated_at();
create trigger payout_batches_audit after insert or update on public.payout_batches
  for each row execute function private.audit_row('failure_reason');
revoke all on public.payout_batches from anon, authenticated;
grant select on public.payout_batches to authenticated;
create policy payout_batches_select on public.payout_batches
  for select to authenticated
  using (cleaner_id = (select auth.uid()) or (select private.is_admin()));

alter table public.payouts rename column stripe_transfer_id to stripe_payout_id;
alter table public.payouts drop constraint payouts_stripe_transfer_id_key;  -- one bank payout pays many cleans
alter table public.payouts
  add column payment_id uuid references public.payments (id) on delete restrict,
  add column batch_id uuid references public.payout_batches (id) on delete restrict,
  add column held_reason text check (held_reason is null or (held_reason ~ '[[:alnum:]]{3,}' and char_length(held_reason) <= 300)),
  add constraint payouts_held_has_reason check (status <> 'held' or held_reason is not null),
  add constraint payouts_batched check (status not in ('in_batch', 'paid') or batch_id is not null or stripe_payout_id is not null);
create index payouts_waiting_idx on public.payouts (available_after) where status = 'pending';

create function private.check_payout_move() returns trigger
language plpgsql set search_path = '' as $$
declare
  ok boolean;
begin
  if new.status = old.status then return new; end if;
  ok := case old.status::text
    when 'pending'  then new.status::text in ('in_batch', 'held', 'cancelled')
    when 'held'     then new.status::text in ('pending', 'cancelled')
    when 'in_batch' then new.status::text in ('paid', 'failed')
    when 'failed'   then new.status::text in ('pending', 'held')
    else false                                                   -- paid, cancelled: final
  end;
  if not ok then
    raise exception 'A payout can''t go from % to %', old.status, new.status using errcode = 'PC041';
  end if;
  return new;
end $$;
create trigger payouts_move before update of status on public.payouts
  for each row execute function private.check_payout_move();

-- ---------------------------------------------------------------- Stripe events
-- Every webhook event, once: a replay finds its id here and does nothing. No API role can
-- read or write it; only the webhook functions (service role, PR 3) do.
create table private.stripe_events (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9_]{6,64}$'),
  type text not null check (char_length(type) <= 100),
  account text check (account ~ '^acct_[A-Za-z0-9]{6,64}$'),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text check (char_length(error) <= 300)
);
alter table private.stripe_events enable row level security;
revoke all on private.stripe_events from public, anon, authenticated;

-- ---------------------------------------------------------------- what people can read
-- Customers (their payments) and cleaners (their payouts) read amounts and states, never
-- Stripe ids, idempotency keys or the cleaner's Stripe account. Admins read the same columns
-- directly; anything more goes through admin functions (PR 7).
revoke select on public.payments from authenticated;
grant select (id, visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, refunded_pence,
              kind, status, attempts, next_retry_at, last_error_code, dispute_status, created_at, updated_at)
  on public.payments to authenticated;
revoke select on public.payouts from authenticated;
grant select (id, visit_id, cleaner_id, payment_id, batch_id, amount_pence, status, available_after, held_reason,
              paid_at, created_at, updated_at)
  on public.payouts to authenticated;
revoke select on public.payout_batches from authenticated;
grant select (id, cleaner_id, amount_pence, status, arrival_date, created_at, updated_at)
  on public.payout_batches to authenticated;

-- ---------------------------------------------------------------- grants
revoke all on function private.cleaner_payable(uuid), private.check_payment_move(), private.check_payout_move(),
  private.check_refund_total() from public, anon, authenticated;
revoke all on function public.my_saved_card() from public, anon;
grant execute on function public.my_saved_card() to authenticated;
