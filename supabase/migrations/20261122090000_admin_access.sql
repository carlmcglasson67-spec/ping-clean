-- Making (and unmaking) an admin from the console, not with a line of SQL (#60).
--
-- Until now the only way was an UPDATE in the Supabase SQL editor (go-live list, step 11).
-- That still works for the very first admin, because someone has to be first. Every admin
-- after that is made here, by an admin, with a reason, and is recorded against them.
--
-- public.admin_set_admin(p_email, p_make, p_reason), admins only:
--   p_make = true   the account with that email becomes an admin. It must be a confirmed
--                   account (the email link was used, so the address is really theirs) and
--                   a customer one: a cleaner's account stays a cleaner's (PC061).
--   p_make = false  the account goes back to being a customer. Never your own (PC063), and
--                   never the last admin (PC064), so the console can't be left with nobody.
-- Errors:
--   42501  the caller isn't an admin
--   22023  the email or the reason is missing or too long
--   PC060  no confirmed Ping account has that email
--   PC061  that account is a cleaner's
--   PC062  nothing to change: already an admin (make), or not an admin (remove)
--   PC063  removing your own admin access
--   PC064  removing the last admin
--
-- The profiles role trigger already writes a row to the audit log with the admin as the
-- actor. This adds one more row saying what was done and why.

create function public.admin_set_admin(p_email text, p_make boolean, p_reason text)
returns table (email text, full_name text)
language plpgsql security definer set search_path = '' as $$
declare
  email_ text := lower(btrim(coalesce(p_email, '')));
  reason_ text := nullif(btrim(coalesce(p_reason, '')), '');
  target public.profiles;
  confirmed boolean;
  others integer;
begin
  if not private.is_admin() then
    raise exception 'Only the Ping team can change who is an admin' using errcode = '42501';
  end if;
  if email_ = '' or char_length(email_) > 254 then
    raise exception 'Enter their email address' using errcode = '22023';
  end if;
  if p_make is null then
    raise exception 'Say whether to add or remove' using errcode = '22023';
  end if;
  if reason_ is null or reason_ !~ '[[:alnum:]]{3,}' or char_length(reason_) > 300 then
    raise exception 'Say why (up to 300 characters)' using errcode = '22023';
  end if;

  -- Every admin row is locked first, always in id order, so two of the team removing each
  -- other at the same moment wait in turn and the second sees one admin left.
  perform 1 from public.profiles where role = 'admin' order by id for update;

  select (u.email_confirmed_at is not null) into confirmed
    from auth.users u where lower(u.email) = email_;
  if not found or not confirmed then
    raise exception 'No confirmed Ping account has that email' using errcode = 'PC060';
  end if;
  select p.* into target
    from public.profiles p
    join auth.users u on u.id = p.id
   where lower(u.email) = email_
   for update of p;
  if not found then
    raise exception 'No confirmed Ping account has that email' using errcode = 'PC060';
  end if;

  if p_make then
    if target.role = 'admin' then
      raise exception 'Already an admin' using errcode = 'PC062';
    end if;
    if target.role = 'cleaner' then
      raise exception 'That account is a cleaner''s' using errcode = 'PC061';
    end if;
    update public.profiles set role = 'admin' where id = target.id;
  else
    if target.role <> 'admin' then
      raise exception 'Not an admin' using errcode = 'PC062';
    end if;
    if target.id = (select auth.uid()) then
      raise exception 'You can''t remove your own admin access' using errcode = 'PC063';
    end if;
    select count(*) into others from public.profiles where role = 'admin' and id <> target.id;
    if others = 0 then
      raise exception 'That''s the last admin' using errcode = 'PC064';
    end if;
    update public.profiles set role = 'customer' where id = target.id;
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, detail)
  values ((select auth.uid()), case when p_make then 'make_admin' else 'remove_admin' end,
          'profiles', target.id, jsonb_build_object('reason', reason_));

  return query select u.email::text, target.full_name from auth.users u where u.id = target.id;
end $$;

revoke all on function public.admin_set_admin(text, boolean, text) from public, anon;
grant execute on function public.admin_set_admin(text, boolean, text) to authenticated;
