-- Ping Clean: register interest before booking opens (signed off by Carl, 7 Nov 2026).
--
--   Someone outside the launch area, or before booking opens, leaves a postcode and EITHER
--   an email OR a mobile number (their choice), and ticks "Tell me when booking opens near
--   me". Unticked means nothing is stored: there is no count-only list.
--
--   public.register_interest(…)            SERVER ONLY (service role): called by the Server
--                                          Action in lib/interest/actions.ts after the
--                                          honeypot and Turnstile. Always answers 'thanks'.
--   public.interest_retention_months()     anyone: the number the consent wording quotes
--   public.admin_interest_counts()         admin: sign-ups per postcode district   (audited)
--   public.admin_list_interest(…)          admin: the list, contacts masked        (audited)
--   public.admin_export_interest(…)        admin: the contact list                 (audited)
--   public.admin_mark_interest_notified(…) admin: "told" / "not told"              (audited)
--   public.admin_delete_interest(…)        admin: delete on request                (audited)
--   private.purge_interest()               cron, nightly: deletes rows past their date
--   private.interest_suppressions          opted-out contacts, as hashes only (see below)
--
-- Nobody reads or writes the table directly, admins included: every way in is a function
-- above, and every admin one leaves an audit line without contact details. Built for
-- customers now; `kind` leaves room for cleaners later without a new table.

-- ---------------------------------------------------------------- settings
-- Carl's number (7 Nov 2026): keep each registration for 6 months. NULL stops new sign-ups
-- (register_interest refuses), the same way booking refuses until prices are set.
alter table public.settings
  add column interest_retention_months integer check (interest_retention_months between 1 and 24);
update public.settings set interest_retention_months = 6 where id;
grant update (interest_retention_months) on public.settings to authenticated;  -- admins only, by policy

-- ---------------------------------------------------------------- normalising
-- The real UK postcode areas (the letters at the start), so "ZZ9 9ZZ" is refused.
-- Includes Guernsey, Jersey and the Isle of Man; leaves out the non-geographic BF and BX.
create function private.uk_postcode_areas() returns text[]
language sql immutable set search_path = '' as $$
  select array['AB','AL','B','BA','BB','BD','BH','BL','BN','BR','BS','BT','CA','CB','CF','CH','CM','CO',
    'CR','CT','CV','CW','DA','DD','DE','DG','DH','DL','DN','DT','DY','E','EC','EH','EN','EX','FK','FY','G',
    'GL','GU','GY','HA','HD','HG','HP','HR','HS','HU','HX','IG','IM','IP','IV','JE','KA','KT','KW','KY','L',
    'LA','LD','LE','LL','LN','LS','LU','M','ME','MK','ML','N','NE','NG','NN','NP','NR','NW','OL','OX','PA',
    'PE','PH','PL','PO','PR','RG','RH','RM','S','SA','SE','SG','SK','SL','SM','SN','SO','SP','SR','SS','ST',
    'SW','SY','TA','TD','TF','TN','TQ','TR','TS','TW','UB','W','WA','WC','WD','WF','WN','WR','WS','WV','YO','ZE']
$$;

-- "ca14 3xx", "CA143XX" → "CA14 3XX". NULL if it isn't a real UK postcode shape and area.
create function private.normalise_postcode(p text) returns text
language sql immutable set search_path = '' as $$
  select case when t ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$'
               and substring(t from '^[A-Z]+') = any (private.uk_postcode_areas())
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

-- Lower-cased and trimmed. Plain printable ASCII only (no invisible or right-to-left
-- characters), one @, a dot after it. NULL otherwise.
create function private.normalise_email(p text) returns text
language sql immutable set search_path = '' as $$
  select case when t ~ '^[!-~]+$' and t ~ '^[^@]+@[^@]+\.[^@]+$' and length(t) <= 254 then t end
  from (select lower(btrim(coalesce(p, ''))) as t) x
$$;

-- For admin screens: enough to recognise an entry, not enough to contact anyone.
create function private.mask_contact(p_email text, p_phone text) returns text
language sql immutable set search_path = '' as $$
  select case when p_email is not null then left(p_email, 1) || '•••@' || split_part(p_email, '@', 2)
              when p_phone is not null then '•••' || right(p_phone, 3) end
$$;

-- ---------------------------------------------------------------- the table
create table public.interest_signups (
  id uuid primary key default gen_random_uuid(),
  -- 'customer' only for now. Cleaners ("tell me when you need cleaners in CA25") come later.
  kind text not null default 'customer' check (kind in ('customer')),
  postcode text not null check (private.normalise_postcode(postcode) is not distinct from postcode),
  postcode_district text generated always as (split_part(postcode, ' ', 1)) stored,
  -- Exactly one way to reach them, the one they chose. Stored normalised so the same
  -- person registering twice for the same area updates their row.
  email text check (private.normalise_email(email) is not distinct from email),
  phone text check (private.normalise_uk_mobile(phone) is not distinct from phone),
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
-- No policies and no grants: nobody reaches the table except through the functions below.
revoke all on public.interest_signups from anon, authenticated;

create unique index interest_signups_email_key on public.interest_signups (kind, email, postcode_district) where email is not null;
create unique index interest_signups_phone_key on public.interest_signups (kind, phone, postcode_district) where phone is not null;
create index interest_signups_district_idx on public.interest_signups (postcode_district, registered_at desc);
create index interest_signups_delete_idx on public.interest_signups (delete_after);

-- Per-row audit (contacts redacted) for "told"/"not told" and every deletion. The nightly
-- purge writes one summary line instead, so it marks itself with app.actor and the
-- triggers step aside for it.
create trigger interest_signups_audit_mark after update on public.interest_signups
  for each row when (old.notified_at is distinct from new.notified_at
                     and coalesce(current_setting('app.actor', true), '') <> 'cron:purge-interest')
  execute function private.audit_row('email', 'phone', 'postcode');
create trigger interest_signups_audit after delete on public.interest_signups
  for each row when (coalesce(current_setting('app.actor', true), '') <> 'cron:purge-interest')
  execute function private.audit_row('email', 'phone', 'postcode');

-- ---------------------------------------------------------------- suppression list
-- Someone who unsubscribed must never be put back on the list, from any district, even
-- after their row is purged. Before the purge deletes an unsubscribed row it adds a
-- SHA-256 hash of the normalised contact here, and register_interest checks it.
-- Deliberately minimal: one hash per contact, no postcode, no date, no kind, nothing
-- readable. Entries never expire (they are what honours the opt-out). Nobody can read
-- or write it except the functions in this migration.
create table private.interest_suppressions (
  contact_hash bytea primary key check (octet_length(contact_hash) = 32)
);
alter table private.interest_suppressions enable row level security;
revoke all on private.interest_suppressions from public, anon, authenticated;

-- "e:" or "p:" plus the normalised contact, hashed. The same person always hashes the same.
create function private.contact_hash(p_email text, p_phone text) returns bytea
language sql immutable set search_path = '' as $$
  select sha256(convert_to(case when p_email is not null then 'e:' || p_email else 'p:' || p_phone end, 'UTF8'))
$$;

-- True when this contact opted out: an unsubscribed row in any district, or on the list.
create function private.interest_opted_out(p_email text, p_phone text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.interest_suppressions s where s.contact_hash = private.contact_hash(p_email, p_phone))
      or exists (select 1 from public.interest_signups i
                 where i.unsubscribed_at is not null
                   and ((p_email is not null and i.email = p_email) or (p_phone is not null and i.phone = p_phone)))
$$;

-- One audit line for an admin read or export: who, what, how many. Never the contacts.
create function private.audit_interest(p_action text, p_detail jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, entity, detail)
  values ((select auth.uid()), p_action, 'interest_signups', p_detail)
$$;

-- ---------------------------------------------------------------- register_interest
-- The only way to add to the list, and only the server can call it (service role): the
-- Server Action runs the honeypot and Turnstile first, and supplies the source and
-- consent version itself. Kind is always 'customer' for now.
-- Always returns 'thanks', whether the person is new, already on the list, opted out
-- (from any district, ever), or didn't tick the box (then nothing is stored), so it can't
-- be used to find out who has registered. Error codes, for input the person can fix:
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

-- What the consent wording says ("we delete it after 6 months"). Anyone may read it.
create function public.interest_retention_months() returns integer
language sql stable security definer set search_path = '' as $$
  select interest_retention_months from public.settings where id
$$;

-- ---------------------------------------------------------------- admin
create function private.require_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
end $$;

-- Where demand is: sign-ups per postcode district, excluding anyone who unsubscribed.
create function public.admin_interest_counts()
returns table (postcode_district text, signups bigint, not_yet_notified bigint, newest timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  perform private.require_admin();
  return query
    select i.postcode_district, count(*), count(*) filter (where i.notified_at is null), max(i.registered_at)
    from public.interest_signups i
    where i.unsubscribed_at is null
    group by i.postcode_district
    order by max(i.registered_at) desc;
  get diagnostics v_rows = row_count;
  perform private.audit_interest('view_counts', jsonb_build_object('districts', v_rows));
end $$;

-- The list for the console, contacts masked ("j•••@example.com", "•••321").
create function public.admin_list_interest(p_district text default null)
returns table (id uuid, postcode_district text, contact_type text, contact_masked text, source text,
               registered_at timestamptz, notified_at timestamptz, unsubscribed_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  perform private.require_admin();
  return query
    select i.id, i.postcode_district, case when i.email is not null then 'email' else 'phone' end,
           private.mask_contact(i.email, i.phone), i.source, i.registered_at, i.notified_at, i.unsubscribed_at
    from public.interest_signups i
    where p_district is null or i.postcode_district = upper(btrim(p_district))
    order by i.registered_at desc;
  get diagnostics v_rows = row_count;
  perform private.audit_interest('view_list',
    jsonb_build_object('district', coalesce(upper(btrim(p_district)), 'all'), 'rows', v_rows));
end $$;

-- The contact list for one district (or all, with NULL), for sending the one message.
-- Never includes anyone who unsubscribed. Audited: who, when, which district, how many.
create function public.admin_export_interest(p_district text default null)
returns table (id uuid, postcode text, postcode_district text, email text, phone text,
               registered_at timestamptz, notified_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  perform private.require_admin();
  return query
    select i.id, i.postcode, i.postcode_district, i.email, i.phone, i.registered_at, i.notified_at
    from public.interest_signups i
    where i.unsubscribed_at is null
      and (p_district is null or i.postcode_district = upper(btrim(p_district)))
    order by i.postcode_district, i.registered_at;
  get diagnostics v_rows = row_count;
  perform private.audit_interest('export',
    jsonb_build_object('district', coalesce(upper(btrim(p_district)), 'all'), 'rows', v_rows));
end $$;

-- After sending: mark entries as told (or undo with p_notified = false). Returns how many
-- changed. Each change writes an audit line (the row trigger), contacts redacted.
create function public.admin_mark_interest_notified(p_ids uuid[], p_notified boolean default true)
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

-- Delete on request. Returns how many went. Each deletion writes an audit line.
create function public.admin_delete_interest(p_ids uuid[]) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  perform private.require_admin();
  delete from public.interest_signups where id = any (p_ids);
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- ---------------------------------------------------------------- purge
-- Nightly. Deletes rows past delete_after, rows whose registration is older than the
-- CURRENT retention setting (so lowering it takes effect), and rows unsubscribed more than
-- 30 days ago (Kate to confirm the 30). One audit line with the count, never the contacts.
create function private.purge_interest() returns integer
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
revoke all on function private.uk_postcode_areas(), private.normalise_postcode(text),
  private.normalise_uk_mobile(text), private.normalise_email(text), private.mask_contact(text, text),
  private.audit_interest(text, jsonb), private.require_admin(), private.purge_interest(),
  private.contact_hash(text, text), private.interest_opted_out(text, text)
  from public, anon, authenticated;
revoke all on function public.register_interest(text, text, text, boolean, text, text),
  public.interest_retention_months(), public.admin_interest_counts(), public.admin_list_interest(text),
  public.admin_export_interest(text), public.admin_mark_interest_notified(uuid[], boolean),
  public.admin_delete_interest(uuid[])
  from public, anon, authenticated;
-- The server only (lib/db/admin.ts, from the Server Action). Not anon, not authenticated.
grant execute on function public.register_interest(text, text, text, boolean, text, text) to service_role;
grant execute on function public.interest_retention_months() to anon, authenticated;
grant execute on function public.admin_interest_counts(), public.admin_list_interest(text),
  public.admin_export_interest(text), public.admin_mark_interest_notified(uuid[], boolean),
  public.admin_delete_interest(uuid[]) to authenticated;

-- ---------------------------------------------------------------- schedule
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('ping-purge-interest', '40 3 * * *', 'select private.purge_interest()');
  end if;
end $$;
