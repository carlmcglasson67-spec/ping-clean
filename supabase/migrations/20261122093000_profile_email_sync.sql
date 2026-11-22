-- profiles.email follows the login email (issue #21, note 2).
--
-- profiles.email is copied from auth.users when the account is made (handle_new_user) and
-- is what the app shows and mails. Until now it never changed again, so after an email
-- change it kept the old address. This trigger copies every later change across.
-- With Supabase's Secure email change on, auth.users.email only changes once BOTH links
-- (old and new address) are used, so the profile changes at that same moment.
-- No new table and no grant change: people still can't edit profiles.email themselves.

create function private.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

revoke all on function private.sync_profile_email() from public;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function private.sync_profile_email();

-- An email change on a profile is logged (profiles.email is what the admin console works
-- from), with the address redacted: the log says it changed, never to what. Role changes
-- already have their own trigger (profiles_audit_role); this one is for email only.
create trigger profiles_audit_email after update of email on public.profiles
  for each row when (new.email is distinct from old.email)
  execute function private.audit_row('full_name', 'phone', 'email');

-- Bring any profile already out of step back in line, once.
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id and p.email is distinct from u.email;
