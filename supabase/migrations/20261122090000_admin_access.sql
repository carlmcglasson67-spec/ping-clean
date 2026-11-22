-- Making (and unmaking) an admin from the console, not with a line of SQL (#60).
--
-- Until now the only way was an UPDATE in the Supabase SQL editor (go-live list, step 11).
-- That still works for the very first admin, because someone has to be first. Every admin
-- after that is made here, by an admin, with a reason, and is recorded against them.
--
-- An address only counts once its email link has been used. Since the sign-up fix (#60),
-- using that link replaces the account's password and the owner chooses their own, so a
-- confirmed account is the owner's.
--
-- public.admin_add_admin(p_email, p_reason)      a confirmed customer account becomes an admin
-- public.admin_remove_admin(p_profile, p_reason) an admin goes back to being a customer;
--                                                 by id, so a changed email can't misdirect it
-- Errors:
--   42501  the caller isn't an admin (checked again after waiting for the lock)
--   22023  the reason is missing or too long
--   PC066  no email given
--   PC060  no single confirmed, active Ping account has that email
--   PC061  that account is a cleaner's (or an applicant's)
--   PC062  nothing to change: already an admin (add), or not an admin (remove)
--   PC063  removing your own admin access
--   PC064  removing the last admin (two admins removing each other at once: the second)
--   PC065  that customer has cleans booked: an admin can't manage or pay for their own
--
-- Reasons are kept in public.team_changes, not the audit log: the audit log is never
-- edited and promises no personal details, and a free-text reason might hold some.

create table public.team_changes (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  made_admin boolean not null,
  reason text not null check (char_length(reason) between 1 and 300),
  actor_id uuid not null references public.profiles (id),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.team_changes enable row level security;
revoke all on public.team_changes from anon, authenticated, service_role;
grant select on public.team_changes to authenticated;
create policy team_changes_admin_read on public.team_changes
  for select to authenticated using ((select private.is_admin()));
create index team_changes_recent_idx on public.team_changes (created_at desc);

-- The shared start: who's asking, the reason, and every admin row locked in id order, so two
-- of the team changing the team at the same moment take turns.
create function private.team_change_begin(p_reason text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  reason_ text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not private.is_admin() then
    raise exception 'Only the Ping team can change who is an admin' using errcode = '42501';
  end if;
  if reason_ is null or reason_ !~ '[[:alnum:]]{3,}' or char_length(reason_) > 300 then
    raise exception 'Say why (up to 300 characters)' using errcode = '22023';
  end if;
  perform 1 from public.profiles where role = 'admin' order by id for update;
  -- Asked again now the lock is held: someone may have removed the caller while they waited.
  if not private.is_admin() then
    raise exception 'Only the Ping team can change who is an admin' using errcode = '42501';
  end if;
  return reason_;
end $$;
revoke all on function private.team_change_begin(text) from public, anon, authenticated;

create function public.admin_add_admin(p_email text, p_reason text)
returns table (id uuid, email text, full_name text)
language plpgsql security definer set search_path = '' as $$
declare
  email_ text := lower(btrim(coalesce(p_email, '')));
  reason_ text;
  target public.profiles;
  n integer;
  ok integer;
begin
  reason_ := private.team_change_begin(p_reason);
  if email_ = '' or char_length(email_) > 254 then
    raise exception 'Enter their email address' using errcode = 'PC066';
  end if;

  -- Exactly one account with that address, and it confirmed, not deleted, not banned.
  select count(*),
         count(*) filter (where u.email_confirmed_at is not null and u.deleted_at is null
                            and (u.banned_until is null or u.banned_until < now()))
    into n, ok
    from auth.users u where lower(u.email) = email_;
  if n <> 1 or ok <> 1 then
    raise exception 'No confirmed Ping account has that email' using errcode = 'PC060';
  end if;
  select p.* into target
    from public.profiles p join auth.users u on u.id = p.id
   where lower(u.email) = email_
   for update of p;
  if not found then
    raise exception 'No confirmed Ping account has that email' using errcode = 'PC060';
  end if;

  if target.role = 'admin' then
    raise exception 'Already an admin' using errcode = 'PC062';
  end if;
  if target.role = 'cleaner' then
    raise exception 'That account is a cleaner''s' using errcode = 'PC061';
  end if;
  if exists (select 1 from public.series s where s.customer_id = target.id and s.status <> 'ended') then
    raise exception 'That customer has cleans booked' using errcode = 'PC065';
  end if;

  update public.profiles set role = 'admin' where profiles.id = target.id;
  insert into public.team_changes (profile_id, made_admin, reason, actor_id)
  values (target.id, true, reason_, (select auth.uid()));

  return query select target.id, u.email::text, target.full_name from auth.users u where u.id = target.id;
end $$;

create function public.admin_remove_admin(p_profile uuid, p_reason text)
returns table (id uuid, email text, full_name text)
language plpgsql security definer set search_path = '' as $$
declare
  reason_ text;
  target public.profiles;
  others integer;
begin
  reason_ := private.team_change_begin(p_reason);
  select * into target from public.profiles where profiles.id = p_profile for update;
  if not found or target.role <> 'admin' then
    raise exception 'Not an admin' using errcode = 'PC062';
  end if;
  if target.id = (select auth.uid()) then
    raise exception 'You can''t remove your own admin access' using errcode = 'PC063';
  end if;
  select count(*) into others from public.profiles where role = 'admin' and profiles.id <> target.id;
  if others = 0 then
    raise exception 'That''s the last admin' using errcode = 'PC064';
  end if;

  update public.profiles set role = 'customer' where profiles.id = target.id;
  insert into public.team_changes (profile_id, made_admin, reason, actor_id)
  values (target.id, false, reason_, (select auth.uid()));

  return query select target.id, u.email::text, target.full_name from auth.users u where u.id = target.id;
end $$;

revoke all on function public.admin_add_admin(text, text) from public, anon;
grant execute on function public.admin_add_admin(text, text) to authenticated;
revoke all on function public.admin_remove_admin(uuid, text) from public, anon;
grant execute on function public.admin_remove_admin(uuid, text) to authenticated;
