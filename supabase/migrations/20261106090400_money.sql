-- Ping Clean V1 — 5/7 Payments and payouts.
-- Rows are written only by the server (service role) in response to Stripe, never by
-- a browser. See .claude/skills/ping-money-rules. Live keys stay off until Kate signs off.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id),
  customer_id uuid not null references public.profiles (id),
  amount_pence integer not null check (amount_pence > 0),
  application_fee_pence integer not null check (application_fee_pence >= 0),
  refunded_pence integer not null default 0 check (refunded_pence >= 0),
  kind text not null default 'visit' check (kind in ('visit', 'late_cancel')),
  status public.payment_status not null default 'pending',
  stripe_payment_intent_id text unique,
  idempotency_key text not null unique,
  failure_reason text check (char_length(failure_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_fee_within_amount check (application_fee_pence <= amount_pence),
  constraint payments_refund_within_amount check (refunded_pence <= amount_pence)
);
alter table public.payments enable row level security;

-- At most one live charge of each kind per visit.
create unique index payments_one_per_visit on public.payments (visit_id, kind) where status <> 'failed';
create index payments_customer_idx on public.payments (customer_id, created_at desc);
create trigger payments_touch before update on public.payments
  for each row execute function private.touch_updated_at();
create trigger payments_audit after insert or update on public.payments
  for each row execute function private.audit_row('failure_reason');

revoke all on public.payments from anon;
revoke insert, update, delete on public.payments from authenticated;

create policy payments_select on public.payments
  for select to authenticated
  using (customer_id = (select auth.uid()) or (select private.is_admin()));

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id),
  cleaner_id uuid not null references public.cleaners (id),
  amount_pence integer not null check (amount_pence > 0),
  status public.payout_status not null default 'pending',
  -- Not before the dispute window has closed.
  available_after timestamptz not null,
  stripe_transfer_id text unique,
  idempotency_key text not null unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payouts_paid_has_time check (status <> 'paid' or paid_at is not null)
);
alter table public.payouts enable row level security;

create unique index payouts_one_per_visit on public.payouts (visit_id) where status <> 'failed' and status <> 'cancelled';
create index payouts_cleaner_idx on public.payouts (cleaner_id, created_at desc);
create trigger payouts_touch before update on public.payouts
  for each row execute function private.touch_updated_at();
create trigger payouts_audit after insert or update on public.payouts
  for each row execute function private.audit_row();

revoke all on public.payouts from anon;
revoke insert, update, delete on public.payouts from authenticated;

create policy payouts_select on public.payouts
  for select to authenticated
  using (cleaner_id = (select auth.uid()) or (select private.is_admin()));
