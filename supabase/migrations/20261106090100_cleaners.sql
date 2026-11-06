-- Ping Clean V1 — 2/7 Cleaners and their vetting documents.

create function private.valid_districts(d text[]) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(bool_and(x ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$'), true) from unnest(d) as x
$$;

create table public.cleaners (
  id uuid primary key references public.profiles (id) on delete cascade,
  status public.cleaner_status not null default 'applicant',
  tier public.cleaner_tier not null default 'new',
  -- Outward postcode districts they will travel to, e.g. {CA14,CA28}.
  areas text[] not null default '{}'
    check (private.valid_districts(areas) and cardinality(areas) <= 40),
  -- Weekly availability: [{ "day": 1-7 (Mon=1), "from": "08:00", "to": "14:00" }].
  availability jsonb not null default '[]'::jsonb check (jsonb_typeof(availability) = 'array'),
  bio text check (char_length(bio) <= 600),
  rating_avg numeric(3, 2) check (rating_avg between 1 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  completed_visits integer not null default 0 check (completed_visits >= 0),
  drop_outs integer not null default 0 check (drop_outs >= 0),
  no_shows integer not null default 0 check (no_shows >= 0),
  stripe_account_id text unique,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cleaners_active_needs_approval check (status <> 'active' or approved_at is not null)
);
alter table public.cleaners enable row level security;

create index cleaners_areas_idx on public.cleaners using gin (areas);
create trigger cleaners_touch before update on public.cleaners
  for each row execute function private.touch_updated_at();
create trigger cleaners_audit after insert or update or delete on public.cleaners
  for each row execute function private.audit_row('bio', 'availability');

create function private.is_active_cleaner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cleaners c
    join public.profiles p on p.id = c.id
    where c.id = (select auth.uid()) and c.status = 'active' and p.role = 'cleaner'
  )
$$;
revoke all on function private.is_active_cleaner() from public;
grant execute on function private.is_active_cleaner() to authenticated, service_role;

-- Cleaners edit where and when they work, and their bio. Status, tier, ratings and
-- Stripe account change only through admin functions or the service role.
revoke insert, update, delete on public.cleaners from anon, authenticated;
revoke select on public.cleaners from anon;
grant update (areas, availability, bio) on public.cleaners to authenticated;

create policy cleaners_select on public.cleaners
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()));

create policy cleaners_update_self on public.cleaners
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Becoming a cleaner applicant. The only way a login gets the cleaner role
-- without an admin. Applicants see no jobs until an admin approves them.
create function public.apply_as_cleaner() returns public.cleaners
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  current_role_ public.user_role;
  result public.cleaners;
begin
  if me is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  select role into current_role_ from public.profiles where id = me;
  if current_role_ = 'admin' then
    raise exception 'Admins cannot apply as cleaners' using errcode = '42501';
  end if;
  if exists (select 1 from public.series s where s.customer_id = me and s.status <> 'ended') then
    raise exception 'End your own regular clean before applying to clean for Ping' using errcode = '42501';
  end if;

  update public.profiles set role = 'cleaner' where id = me;
  insert into public.cleaners (id) values (me)
    on conflict (id) do nothing;
  select * into result from public.cleaners where id = me;
  return result;
end $$;
-- (public.series is created in 3/7; plpgsql resolves it at call time.)
revoke all on function public.apply_as_cleaner() from public, anon;
grant execute on function public.apply_as_cleaner() to authenticated;

-- ---------------------------------------------------------------- documents
create table public.cleaner_documents (
  id uuid primary key default gen_random_uuid(),
  cleaner_id uuid not null references public.cleaners (id) on delete cascade,
  kind public.document_kind not null,
  -- Path inside the private cleaner-documents bucket: <cleaner_id>/<file>.
  storage_path text not null check (storage_path ~ '^[0-9a-f-]{36}/[^/]+$'),
  expires_on date,
  status public.document_status not null default 'pending',
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  rejection_reason text check (char_length(rejection_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_path_owner check (split_part(storage_path, '/', 1) = cleaner_id::text)
);
alter table public.cleaner_documents enable row level security;

create index cleaner_documents_cleaner_idx on public.cleaner_documents (cleaner_id, kind);
create trigger cleaner_documents_touch before update on public.cleaner_documents
  for each row execute function private.touch_updated_at();
create trigger cleaner_documents_audit after insert or update or delete on public.cleaner_documents
  for each row execute function private.audit_row('storage_path', 'rejection_reason');

-- Cleaners upload (status is always pending); only admins review.
revoke insert, update, delete on public.cleaner_documents from anon, authenticated;
revoke select on public.cleaner_documents from anon;
grant insert (cleaner_id, kind, storage_path, expires_on) on public.cleaner_documents to authenticated;
grant update (status, reviewed_by, reviewed_at, rejection_reason, expires_on) on public.cleaner_documents to authenticated;

create policy documents_select on public.cleaner_documents
  for select to authenticated
  using (cleaner_id = (select auth.uid()) or (select private.is_admin()));

create policy documents_insert_own on public.cleaner_documents
  for insert to authenticated
  with check (
    cleaner_id = (select auth.uid())
    and exists (select 1 from public.cleaners c where c.id = (select auth.uid()) and c.status in ('applicant', 'active'))
  );

create policy documents_admin_review on public.cleaner_documents
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()) and reviewed_by = (select auth.uid()));
