-- Ping Clean V1 — 1/7 Foundations: types, helpers, profiles, audit log.
--
-- Conventions for every migration in this repo:
--   * RLS enabled in the same migration that creates the table (scripts/check-rls.sh).
--   * Policies use (select auth.uid()) so Postgres evaluates it once per query.
--   * Role checks go through private.* security-definer helpers. The private schema
--     is not exposed by the Supabase API, so nobody can call them directly over HTTP.
--   * Money is integer pence (see 3/7 and lib/money). Never numeric, never float.
--   * Writes that need business rules (booking, claiming, completing, approving) go
--     through functions added in later PRs, not open UPDATE grants.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------- enums
create type public.user_role as enum ('customer', 'cleaner', 'admin');
create type public.cleaner_tier as enum ('new', 'approved', 'top');
create type public.cleaner_status as enum ('applicant', 'active', 'suspended', 'left');
create type public.document_kind as enum ('insurance', 'dbs', 'photo_id', 'right_to_work');
create type public.document_status as enum ('pending', 'verified', 'rejected', 'expired');
create type public.series_frequency as enum ('weekly', 'fortnightly', 'four_weekly');
create type public.series_status as enum ('offering', 'unclaimed', 'claimed', 'paused', 'ended');
create type public.visit_status as enum ('scheduled', 'in_progress', 'completed', 'skipped', 'cancelled', 'no_show');
create type public.offer_status as enum ('pending', 'open', 'claimed', 'expired', 'withdrawn');
create type public.photo_kind as enum ('before', 'after');
create type public.commission_type as enum ('percent', 'per_hour');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');
create type public.payout_status as enum ('pending', 'paid', 'failed', 'cancelled');

-- ---------------------------------------------------------------- shared triggers
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'customer',
  full_name text check (char_length(full_name) <= 120),
  phone text check (phone ~ '^\+?[0-9 ]{7,20}$'),
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Role helpers. Security definer so they can read profiles without tripping the
-- profiles policies (which call them). Stable so the planner can cache them.
create function private.my_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid())
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.profiles where id = (select auth.uid())), false)
$$;

revoke all on function private.my_role(), private.is_admin() from public;
grant execute on function private.my_role(), private.is_admin() to authenticated, service_role;

-- Every new login becomes a customer. The role is never read from sign-up metadata:
-- cleaners get their role through the application flow, admins only from an admin.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, role, full_name, email)
  values (
    new.id,
    'customer',
    left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 120),
    new.email
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Nobody edits their own role or email through the API. Name and phone only.
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke select on public.profiles from anon;
grant update (full_name, phone) on public.profiles to authenticated;

create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------- audit log
-- Written only by triggers (security definer). Admins can read it; nobody edits it.
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create policy audit_admin_read on public.audit_log
  for select to authenticated using ((select private.is_admin()));

create index audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);

-- Generic row audit. Trigger args are columns to leave out of the diff (personal
-- data or file paths), so the log never stores names, addresses or documents.
create function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  old_j jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else '{}'::jsonb end;
  new_j jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else '{}'::jsonb end;
  diff jsonb := '{}'::jsonb;
  k text;
  skip text[] := coalesce(tg_argv::text[], '{}') || array['updated_at', 'created_at'];
begin
  for k in select jsonb_object_keys(old_j || new_j) loop
    continue when k = any (skip);
    if (old_j -> k) is distinct from (new_j -> k) then
      diff := diff || jsonb_build_object(k, jsonb_build_object('from', old_j -> k, 'to', new_j -> k));
    end if;
  end loop;

  if tg_op = 'UPDATE' and diff = '{}'::jsonb then
    return new;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    case when coalesce(new_j ->> 'id', old_j ->> 'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then coalesce(new_j ->> 'id', old_j ->> 'id')::uuid end,
    diff
  );
  return coalesce(new, old);
end $$;

-- Role changes are the most sensitive edit in the system, so they are audited too.
create trigger profiles_audit_role after update of role on public.profiles
  for each row execute function private.audit_row('full_name', 'phone', 'email');
