-- Ping Clean: register interest before booking opens (signed off by Carl, 7 Nov 2026).
--
--   Someone outside the launch area, or before booking opens, leaves a postcode and EITHER
--   an email OR a mobile number (their choice), and ticks "Tell me when booking opens near
--   me". Unticked means nothing is stored: there is no count-only list.
--
--   public.register_interest(…)          anyone: the only way in. Always answers 'thanks'.
--   public.interest_retention_months()   anyone: the number the consent wording quotes
--   public.admin_interest_counts()       admin: sign-ups per postcode district
--   public.admin_export_interest(…)      admin: the contact list, writes an audit row
--   private.purge_interest()             cron, nightly: deletes rows past their date
--
-- Nobody but an admin can read the table, not even the person who registered: there is no
-- account to prove a row is theirs. Built for customers now; `kind` leaves room for
-- cleaners later without a new table.

-- ---------------------------------------------------------------- settings
-- Carl's number (7 Nov 2026): keep each registration for 6 months. NULL stops new sign-ups
-- (register_interest refuses), the same way booking refuses until prices are set.
alter table public.settings
  add column interest_retention_months integer check (interest_retention_months between 1 and 24);
update public.settings set interest_retention_months = 6 where id;
grant update (interest_retention_months) on public.settings to authenticated;  -- admins only, by policy

-- ---------------------------------------------------------------- the table
create table public.interest_signups (
  id uuid primary key default gen_random_uuid(),
  -- 'customer' only for now. Cleaners ("tell me when you need cleaners in CA25") come later.
  kind text not null default 'customer' check (kind in ('customer')),
  postcode text not null check (postcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2}$'),
  postcode_district text generated always as (split_part(postcode, ' ', 1)) stored,
  -- Exactly one way to reach them, the one they chose. Stored normalised so the same
  -- person registering twice for the same area updates their row.
  email text check (email = lower(email) and length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone ~ '^\+[0-9]{9,15}$'),
  consent_text_version text not null check (consent_text_version ~ '^[a-z0-9-]{1,40}$'),
  source text not null check (source in ('instant_price', 'holding_page')),
  created_at timestamptz not null default now(),
  -- When they last registered (or registered again). The retention clock runs from here.
  registered_at timestamptz not null default now(),
  notified_at timestamptz,      -- the one "booking is open" message went out
  unsubscribed_at timestamptz,  -- from the link in that message (built with the message)
  delete_after timestamptz not null,
  constraint interest_one_contact check (num_nonnulls(email, phone) = 1)
);
alter table public.interest_signups enable row level security;

create unique index interest_signups_email_key on public.interest_signups (kind, email, postcode_district) where email is not null;
create unique index interest_signups_phone_key on public.interest_signups (kind, phone, postcode_district) where phone is not null;
create index interest_signups_district_idx on public.interest_signups (postcode_district, registered_at desc);
create index interest_signups_delete_idx on public.interest_signups (delete_after);

-- Admins only. Read for the console; mark as notified after sending; delete on request.
-- Every write goes through RLS and is audited (without the contact details).
revoke all on public.interest_signups from anon, authenticated;
grant select, delete on public.interest_signups to authenticated;
grant update (notified_at) on public.interest_signups to authenticated;

create policy interest_admin_read on public.interest_signups
  for select to authenticated using ((select private.is_admin()));
create policy interest_admin_mark on public.interest_signups
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy interest_admin_delete on public.interest_signups
  for delete to authenticated using ((select private.is_admin()));

-- Audited: an admin marking someone as told, and every deletion. (Someone registering
-- again for the same area is not an admin action, so it isn't logged.)
create trigger interest_signups_audit_mark after update on public.interest_signups
  for each row when (new.notified_at is not null and old.notified_at is distinct from new.notified_at)
  execute function private.audit_row('email', 'phone', 'postcode');
create trigger interest_signups_audit after delete on public.interest_signups
  for each row execute function private.audit_row('email', 'phone', 'postcode');

-- ---------------------------------------------------------------- normalising
-- "ca14 3xx", "CA143XX" → "CA14 3XX". NULL if it isn't a UK postcode shape.
create function private.normalise_postcode(p text) returns text
language sql immutable set search_path = '' as $$
  select case when t ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$'
              then left(t, length(t) - 3) || ' ' || right(t, 3) end
  from (select upper(regexp_replace(coalesce(p, ''), '\s', '', 'g')) as t) x
$$;

-- "07700 900321", "+44 7700 900321", "447700900321" → "+447700900321". UK mobiles only
-- (07…): the one message is a text, so a landline is no use. NULL if it isn't one.
create function private.normalise_uk_mobile(p text) returns text
language sql immutable set search_path = '' as $$
  select case when t ~ '^07[0-9]{9}$' then '+44' || substr(t, 2)
              when t ~ '^447[0-9]{9}$' then '+' || t
              when t ~ '^\+447[0-9]{9}$' then t end
  from (select regexp_replace(coalesce(p, ''), '[\s().-]', '', 'g') as t) x
$$;

-- Lower-cased and trimmed. NULL if it isn't a plain address (no spaces, one @, a dot after it).
create function private.normalise_email(p text) returns text
language sql immutable set search_path = '' as $$
  select case when t ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(t) <= 254 then t end
  from (select lower(btrim(coalesce(p, ''))) as t) x
$$;

-- ---------------------------------------------------------------- register_interest
-- The only way to add to the list. Granted to anon and authenticated.
-- Always returns 'thanks', whether the person is new, already on the list, or didn't tick
-- the box (then nothing is stored), so it can't be used to find out who has registered.
-- Error codes, for input the person can fix:
--   PC030 postcode not valid · PC031 email or mobile not valid (or both / neither given)
--   PC032 registering interest isn't open (retention not set) · PC033 bad source/version
create function public.register_interest(
  p_postcode text,
  p_email text,
  p_phone text,
  p_notify boolean,
  p_source text,
  p_consent_version text
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_postcode text := private.normalise_postcode(p_postcode);
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_months integer;
begin
  select interest_retention_months into v_months from public.settings where id;
  if v_months is null then
    raise exception 'Registering interest is not open' using errcode = 'PC032';
  end if;
  if v_postcode is null then
    raise exception 'Postcode not valid' using errcode = 'PC030';
  end if;
  if num_nonnulls(v_email, v_phone) <> 1 then
    raise exception 'Give an email address or a mobile number' using errcode = 'PC031';
  end if;
  if v_email is not null then
    v_email := private.normalise_email(v_email);
    if v_email is null then raise exception 'Email not valid' using errcode = 'PC031'; end if;
  else
    v_phone := private.normalise_uk_mobile(v_phone);
    if v_phone is null then raise exception 'Mobile not valid' using errcode = 'PC031'; end if;
  end if;
  if p_source is null or p_source not in ('instant_price', 'holding_page')
     or p_consent_version is null or p_consent_version !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'Form details not valid' using errcode = 'PC033';
  end if;

  -- Carl's rule: only store when "Tell me when booking opens near me" is ticked.
  if p_notify is not true then
    return 'thanks';
  end if;

  -- Registering again renews it: fresh consent, a fresh retention clock, and back on the
  -- list if they had unsubscribed or already been told.
  if v_email is not null then
    insert into public.interest_signups as i (postcode, email, consent_text_version, source, delete_after)
    values (v_postcode, v_email, p_consent_version, p_source, now() + make_interval(months => v_months))
    on conflict (kind, email, postcode_district) where email is not null do update
      set postcode = excluded.postcode, consent_text_version = excluded.consent_text_version,
          source = excluded.source, registered_at = now(), delete_after = excluded.delete_after,
          notified_at = null, unsubscribed_at = null;
  else
    insert into public.interest_signups as i (postcode, phone, consent_text_version, source, delete_after)
    values (v_postcode, v_phone, p_consent_version, p_source, now() + make_interval(months => v_months))
    on conflict (kind, phone, postcode_district) where phone is not null do update
      set postcode = excluded.postcode, consent_text_version = excluded.consent_text_version,
          source = excluded.source, registered_at = now(), delete_after = excluded.delete_after,
          notified_at = null, unsubscribed_at = null;
  end if;
  return 'thanks';
end $$;

-- What the consent wording says ("we delete it anyway after 6 months"). Anyone may read it.
create function public.interest_retention_months() returns integer
language sql stable security definer set search_path = '' as $$
  select interest_retention_months from public.settings where id
$$;

-- ---------------------------------------------------------------- admin
-- Where demand is: sign-ups per postcode district, excluding anyone who unsubscribed.
create function public.admin_interest_counts()
returns table (postcode_district text, signups bigint, not_yet_notified bigint, newest timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select i.postcode_district, count(*), count(*) filter (where i.notified_at is null), max(i.registered_at)
    from public.interest_signups i
    where i.unsubscribed_at is null
    group by i.postcode_district
    order by max(i.registered_at) desc;
end $$;

-- The contact list for one district (or all, with NULL), for sending the one message.
-- Never includes anyone who unsubscribed. Every export writes an audit row: who, when,
-- which district and how many rows, never the contacts themselves.
create function public.admin_export_interest(p_district text default null)
returns table (id uuid, postcode text, postcode_district text, email text, phone text,
               registered_at timestamptz, notified_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  if not private.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select i.id, i.postcode, i.postcode_district, i.email, i.phone, i.registered_at, i.notified_at
    from public.interest_signups i
    where i.unsubscribed_at is null
      and (p_district is null or i.postcode_district = upper(btrim(p_district)))
    order by i.postcode_district, i.registered_at;
  get diagnostics v_rows = row_count;
  insert into public.audit_log (actor_id, action, entity, detail)
  values ((select auth.uid()), 'export', 'interest_signups',
          jsonb_build_object('district', coalesce(upper(btrim(p_district)), 'all'), 'rows', v_rows));
end $$;

-- ---------------------------------------------------------------- purge
-- Nightly. Deletes rows past delete_after, and rows unsubscribed more than 30 days ago
-- (Kate to confirm the 30). One audit row with the count, never the contacts.
create function private.purge_interest() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  perform set_config('app.actor', 'cron:purge-interest', true);
  -- The row trigger would write one audit entry per deleted row; one summary is enough.
  alter table public.interest_signups disable trigger interest_signups_audit;
  delete from public.interest_signups
  where delete_after <= now()
     or unsubscribed_at <= now() - interval '30 days';
  get diagnostics v_rows = row_count;
  alter table public.interest_signups enable trigger interest_signups_audit;
  if v_rows > 0 then
    insert into public.audit_log (actor_label, action, entity, detail)
    values ('cron:purge-interest', 'purge', 'interest_signups', jsonb_build_object('rows', v_rows));
  end if;
  return v_rows;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function private.normalise_postcode(text), private.normalise_uk_mobile(text),
  private.normalise_email(text), private.purge_interest() from public, anon, authenticated;
revoke all on function public.register_interest(text, text, text, boolean, text, text),
  public.interest_retention_months(), public.admin_interest_counts(),
  public.admin_export_interest(text) from public, anon, authenticated;
grant execute on function public.register_interest(text, text, text, boolean, text, text),
  public.interest_retention_months() to anon, authenticated;
grant execute on function public.admin_interest_counts(), public.admin_export_interest(text) to authenticated;

-- ---------------------------------------------------------------- schedule
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('ping-purge-interest', '40 3 * * *', 'select private.purge_interest()');
  end if;
end $$;
