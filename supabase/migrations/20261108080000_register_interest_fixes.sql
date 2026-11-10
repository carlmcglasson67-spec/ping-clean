-- Ping Clean: register interest, the review fixes that missed the #20 merge.
--
-- PR #20 was merged at c56b8a7, before its final review rounds. This migration brings the
-- database up to the version those reviews passed (commits 25ffda7, 10d4600, 127d84c on
-- main-session/register-interest), without editing the already-merged migration.
-- Carl signed off this feature's table (7 Nov 2026); the small suppression table is part of it.
--
--   * Opted out means out, from any district, for good: register_interest checks every
--     unsubscribed row and a hash-only suppression list (private.interest_suppressions).
--   * The purge adds an unsubscribed contact's hash before deleting its row; an admin
--     deletion on request (erasure) adds the hash of EVERY contact it deletes.
--   * Matching uses a canonical form (gmail/googlemail dots and +tags, +tags elsewhere,
--     never collapsing a +tag-only address); the address is still stored as typed.
--   * normalise_email drops a trailing dot on the domain.
--   * admin_mark_interest_notified refuses a null told / not told.

-- ---------------------------------------------------------------- emails: trailing dot
create or replace function private.normalise_email(p text) returns text
language sql immutable set search_path = '' as $$
  select case when t ~ '^[!-~]+$' and t ~ '^[^@]+@[^@]+\.[^@]+$' and length(t) <= 254 then t end
  from (select regexp_replace(lower(btrim(coalesce(p, ''))), '\.+$', '') as t) x
$$;

-- Rows already stored with a trailing dot are tidied further down, once the suppression
-- list exists (private.tidy_trailing_dot_emails).

-- ---------------------------------------------------------------- suppression list
-- Someone who unsubscribed, or asked for their details to be deleted, must never be put
-- back on the list, from any district, even after their row is gone. Before the purge
-- deletes an unsubscribed row, and whenever an admin deletes an entry on request, a
-- SHA-256 hash of the canonical contact goes here, and register_interest checks it.
-- Deliberately minimal: one hash per contact, no postcode, no date, no kind, nothing
-- readable. Entries never expire (they are what honours the opt-out). Nobody can read
-- or write it except the functions in this migration.
create table private.interest_suppressions (
  contact_hash bytea primary key check (octet_length(contact_hash) = 32)
);
alter table private.interest_suppressions enable row level security;
revoke all on private.interest_suppressions from public, anon, authenticated;

-- The form used ONLY for matching opt-outs (the address is stored as typed). So that
-- "jo.bloggs+ping@googlemail.com" can't slip past an opt-out of "jobloggs@gmail.com":
--   gmail.com / googlemail.com: dots and anything after "+" removed, domain gmail.com
--   every other domain: anything after "+" removed
--   mobiles: already normalised (+447…)
-- Only when something is left: "+abc@example.com" stays as it is, so it never collapses
-- into "@example.com" and blocks a different "+zzz@example.com".
create function private.contact_canonical(p_email text, p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_email is null then 'p:' || p_phone
    when split_part(p_email, '@', 2) in ('gmail.com', 'googlemail.com')
      then 'e:' || coalesce(nullif(replace(split_part(split_part(p_email, '@', 1), '+', 1), '.', ''), ''),
                            split_part(p_email, '@', 1)) || '@gmail.com'
    else 'e:' || coalesce(nullif(split_part(split_part(p_email, '@', 1), '+', 1), ''), split_part(p_email, '@', 1))
              || '@' || split_part(p_email, '@', 2)
  end
$$;

-- The canonical contact, hashed. The same person always hashes the same.
create function private.contact_hash(p_email text, p_phone text) returns bytea
language sql immutable set search_path = '' as $$
  select sha256(convert_to(private.contact_canonical(p_email, p_phone), 'UTF8'))
$$;

-- True when this contact opted out: an unsubscribed row in any district, or on the list.
create function private.interest_opted_out(p_email text, p_phone text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.interest_suppressions s where s.contact_hash = private.contact_hash(p_email, p_phone))
      or exists (select 1 from public.interest_signups i
                 where i.unsubscribed_at is not null
                   and private.contact_canonical(i.email, i.phone) = private.contact_canonical(p_email, p_phone))
$$;

-- ---------------------------------------------------------------- tidying trailing dots
-- Rows stored before this change with a trailing dot on the domain ("x@example.com.") would
-- break the email check, so they're tidied to the new form. None exist in production yet
-- (the form isn't live), but it's done safely anyway, per group of rows that become the same
-- address in the same area (kind, district):
--   * one row survives: the one already in the clean form, or else the earliest;
--   * if ANY row in the group had opted out, the contact's hash goes on the suppression list
--     and the survivor keeps the opt-out (and "told", if any row was told);
--   * the other rows are deleted (audited, contacts redacted), then the survivor is tidied.
-- Kept as a function so the tests can run it on seeded rows; nobody else can call it.
create function private.tidy_trailing_dot_emails() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  g record;
  keep uuid;
  n integer := 0;
  v_actor text := current_setting('app.actor', true);
begin
  perform set_config('app.actor', 'migration:tidy-emails', true);
  for g in
    select i.kind, i.postcode_district, regexp_replace(i.email, '\.+$', '') as clean,
           array_agg(i.id order by (i.email = regexp_replace(i.email, '\.+$', '')) desc, i.created_at, i.id) as ids,
           min(i.unsubscribed_at) as unsub, max(i.notified_at) as told
    from public.interest_signups i
    where i.email is not null
    group by 1, 2, 3
    having bool_or(i.email ~ '\.$')
  loop
    keep := g.ids[1];
    if g.unsub is not null then
      insert into private.interest_suppressions (contact_hash)
      values (private.contact_hash(g.clean, null)) on conflict do nothing;
    end if;
    delete from public.interest_signups where id = any (g.ids[2:]);
    update public.interest_signups
       set email = g.clean,
           unsubscribed_at = coalesce(unsubscribed_at, g.unsub),
           notified_at = coalesce(notified_at, g.told)
     where id = keep;
    n := n + 1;
  end loop;
  perform set_config('app.actor', coalesce(v_actor, ''), true);
  return n;
end $$;
revoke all on function private.tidy_trailing_dot_emails() from public, anon, authenticated;
select private.tidy_trailing_dot_emails();

-- ---------------------------------------------------------------- register_interest
create or replace function public.register_interest(
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

  -- Someone who opted out stays out, whatever district is typed in: anyone could type
  -- their address. Nothing is stored or changed.
  if private.interest_opted_out(v_email, v_phone) then
    return 'thanks';
  end if;

  -- Registering again renews consent and the retention clock. It never clears "told",
  -- so nobody can make Ping message a person twice.
  if v_email is not null then
    insert into public.interest_signups as i (postcode, email, consent_text_version, source, delete_after)
    values (v_postcode, v_email, p_consent_version, p_source, now() + make_interval(months => v_months))
    on conflict (kind, email, postcode_district) where email is not null do update
      set postcode = excluded.postcode, consent_text_version = excluded.consent_text_version,
          source = excluded.source, registered_at = now(), delete_after = excluded.delete_after
      where i.unsubscribed_at is null;
  else
    insert into public.interest_signups as i (postcode, phone, consent_text_version, source, delete_after)
    values (v_postcode, v_phone, p_consent_version, p_source, now() + make_interval(months => v_months))
    on conflict (kind, phone, postcode_district) where phone is not null do update
      set postcode = excluded.postcode, consent_text_version = excluded.consent_text_version,
          source = excluded.source, registered_at = now(), delete_after = excluded.delete_after
      where i.unsubscribed_at is null;
  end if;
  return 'thanks';
end $$;

-- ---------------------------------------------------------------- admin and purge
create or replace function public.admin_mark_interest_notified(p_ids uuid[], p_notified boolean default true)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  perform private.require_admin();
  if p_notified is null then
    raise exception 'Say told (true) or not told (false)' using errcode = '22004';
  end if;
  update public.interest_signups
     set notified_at = case when p_notified then now() end
   where id = any (p_ids)
     and (notified_at is null) = p_notified;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

create or replace function public.admin_delete_interest(p_ids uuid[]) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  perform private.require_admin();
  with gone as (
    delete from public.interest_signups where id = any (p_ids)
    returning email, phone, unsubscribed_at
  ), suppressed as (
    insert into private.interest_suppressions (contact_hash)
    select distinct private.contact_hash(email, phone) from gone
    on conflict do nothing
  )
  select count(*) into v_rows from gone;
  return v_rows;
end $$;

create or replace function private.purge_interest() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
  v_months integer;
  v_actor text := current_setting('app.actor', true);
begin
  select interest_retention_months into v_months from public.settings where id;
  perform set_config('app.actor', 'cron:purge-interest', true);
  -- Opted-out contacts go on the suppression list before their rows go, so they can never
  -- be re-enrolled.
  with gone as (
    delete from public.interest_signups
    where delete_after <= now()
       or (v_months is not null and registered_at + make_interval(months => v_months) <= now())
       or unsubscribed_at <= now() - interval '30 days'
    returning email, phone, unsubscribed_at
  ), suppressed as (
    insert into private.interest_suppressions (contact_hash)
    select distinct private.contact_hash(email, phone) from gone where unsubscribed_at is not null
    on conflict do nothing
  )
  select count(*) into v_rows from gone;
  perform set_config('app.actor', coalesce(v_actor, ''), true);
  if v_rows > 0 then
    insert into public.audit_log (actor_label, action, entity, detail)
    values ('cron:purge-interest', 'purge', 'interest_signups', jsonb_build_object('rows', v_rows));
  end if;
  return v_rows;
end $$;

-- ---------------------------------------------------------------- grants
-- New helpers: nobody calls them directly. (create or replace keeps the grants the merged
-- migration gave the functions above: register_interest to service_role only, the admin
-- functions to authenticated, checked inside.)
revoke all on function private.contact_hash(text, text), private.contact_canonical(text, text),
  private.interest_opted_out(text, text) from public, anon, authenticated;
