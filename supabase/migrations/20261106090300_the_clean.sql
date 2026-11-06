-- Ping Clean V1 — 4/7 The clean: checklists, photos, customer reviews, admin QC.
--
-- Note: the spec lists one "reviews" table holding both the customer rating and the
-- admin QC score. They are split here (reviews + visit_qc) because RLS works on rows,
-- not columns: in one table the customer could read the internal QC score.

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  version integer not null default 1 check (version > 0),
  is_default boolean not null default false,
  -- [{ "key": "kitchen.surfaces", "room": "Kitchen", "label": "Worktops wiped and dried" }]
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.checklist_templates enable row level security;
create unique index checklist_templates_one_default on public.checklist_templates (is_default) where is_default;
create trigger checklist_templates_touch before update on public.checklist_templates
  for each row execute function private.touch_updated_at();

revoke all on public.checklist_templates from anon;
create policy checklist_templates_read on public.checklist_templates
  for select to authenticated
  using ((select private.is_active_cleaner()) or (select private.is_admin()));
create policy checklist_templates_admin_write on public.checklist_templates
  for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- One row per tick on a visit, copied from the template when the visit starts.
create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id) on delete cascade,
  item_key text not null,
  room text not null,
  label text not null,
  position smallint not null default 0,
  done boolean not null default false,
  done_at timestamptz,
  unique (visit_id, item_key),
  constraint checklist_done_time check (done = (done_at is not null))
);
alter table public.checklist_items enable row level security;

-- The server stamps the time; the phone's clock is never trusted.
create function private.stamp_checklist_tick() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.done_at := case when new.done then coalesce(old.done_at, now()) end;
  return new;
end $$;
create trigger checklist_items_stamp before insert or update on public.checklist_items
  for each row execute function private.stamp_checklist_tick();

revoke all on public.checklist_items from anon;
revoke insert, update, delete on public.checklist_items from authenticated;
grant update (done) on public.checklist_items to authenticated;

create policy checklist_items_select on public.checklist_items
  for select to authenticated
  using (exists (
    select 1 from public.visits v
    where v.id = checklist_items.visit_id
      and (v.customer_id = (select auth.uid()) or v.cleaner_id = (select auth.uid()) or (select private.is_admin()))
  ));

-- The cleaner ticks items only while the visit is in progress.
create policy checklist_items_cleaner_tick on public.checklist_items
  for update to authenticated
  using (exists (
    select 1 from public.visits v
    where v.id = checklist_items.visit_id and v.cleaner_id = (select auth.uid()) and v.status = 'in_progress'
  ))
  with check (exists (
    select 1 from public.visits v
    where v.id = checklist_items.visit_id and v.cleaner_id = (select auth.uid()) and v.status = 'in_progress'
  ));

-- ---------------------------------------------------------------- photos
create table public.visit_photos (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id) on delete cascade,
  kind public.photo_kind not null,
  room text check (char_length(room) <= 60),
  -- Path inside the private visit-photos bucket: <visit_id>/<file>.
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[^/]+$'),
  taken_at timestamptz not null default now(),
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint photos_path_visit check (split_part(storage_path, '/', 1) = visit_id::text)
);
alter table public.visit_photos enable row level security;
create index visit_photos_visit_idx on public.visit_photos (visit_id);

revoke all on public.visit_photos from anon;
revoke insert, update, delete on public.visit_photos from authenticated;
grant insert (visit_id, kind, room, storage_path, taken_at, uploaded_by) on public.visit_photos to authenticated;

create policy visit_photos_select on public.visit_photos
  for select to authenticated
  using (exists (
    select 1 from public.visits v
    where v.id = visit_photos.visit_id
      and (v.customer_id = (select auth.uid()) or v.cleaner_id = (select auth.uid()) or (select private.is_admin()))
  ));

create policy visit_photos_cleaner_insert on public.visit_photos
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.visits v
      where v.id = visit_photos.visit_id and v.cleaner_id = (select auth.uid()) and v.status = 'in_progress'
    )
  );

-- ---------------------------------------------------------------- reviews (customer)
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null unique references public.visits (id) on delete cascade,
  customer_id uuid not null references public.profiles (id),
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.reviews enable row level security;
create trigger reviews_touch before update on public.reviews
  for each row execute function private.touch_updated_at();

revoke all on public.reviews from anon;
revoke insert, update, delete on public.reviews from authenticated;
grant insert (visit_id, customer_id, rating, comment) on public.reviews to authenticated;
grant update (rating, comment) on public.reviews to authenticated;

create policy reviews_select on public.reviews
  for select to authenticated
  using (
    customer_id = (select auth.uid())
    or (select private.is_admin())
    or exists (select 1 from public.visits v where v.id = reviews.visit_id and v.cleaner_id = (select auth.uid()))
  );

-- A customer reviews only their own completed visit, once.
create policy reviews_customer_insert on public.reviews
  for insert to authenticated
  with check (
    customer_id = (select auth.uid())
    and exists (
      select 1 from public.visits v
      where v.id = reviews.visit_id and v.customer_id = (select auth.uid()) and v.status = 'completed'
    )
  );

create policy reviews_customer_update on public.reviews
  for update to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));

-- ---------------------------------------------------------------- QC (admin)
create table public.visit_qc (
  visit_id uuid primary key references public.visits (id) on delete cascade,
  score smallint not null check (score between 1 and 10),
  notes text check (char_length(notes) <= 1000),
  reviewed_by uuid not null references public.profiles (id),
  reviewed_at timestamptz not null default now()
);
alter table public.visit_qc enable row level security;
create trigger visit_qc_audit after insert or update or delete on public.visit_qc
  for each row execute function private.audit_row('notes');

revoke all on public.visit_qc from anon;

-- The cleaner sees their own scores (that's how they improve); customers never do.
create policy visit_qc_select on public.visit_qc
  for select to authenticated
  using (
    (select private.is_admin())
    or exists (select 1 from public.visits v where v.id = visit_qc.visit_id and v.cleaner_id = (select auth.uid()))
  );

create policy visit_qc_admin_write on public.visit_qc
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()) and reviewed_by = (select auth.uid()));
