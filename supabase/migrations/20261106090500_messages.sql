-- Ping Clean V1 — 6/7 Customer ↔ cleaner messages on a series.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
create index messages_series_idx on public.messages (series_id, created_at);

revoke all on public.messages from anon;
revoke insert, update, delete on public.messages from authenticated;
grant insert (series_id, sender_id, body) on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;

-- Participants: the customer, and the cleaner while they hold the series and are active.
create function private.is_series_participant(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.series s
    where s.id = sid
      and (s.customer_id = (select auth.uid())
           or (s.cleaner_id = (select auth.uid()) and s.status in ('claimed', 'paused')
               and private.is_active_cleaner()))
  )
$$;
revoke all on function private.is_series_participant(uuid) from public;
grant execute on function private.is_series_participant(uuid) to authenticated, service_role;

create policy messages_select on public.messages
  for select to authenticated
  using ((select private.is_admin()) or private.is_series_participant(series_id));

create policy messages_insert on public.messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and private.is_series_participant(series_id));

-- Only the recipient marks a message read.
create policy messages_mark_read on public.messages
  for update to authenticated
  using (sender_id <> (select auth.uid()) and private.is_series_participant(series_id))
  with check (sender_id <> (select auth.uid()) and private.is_series_participant(series_id));
