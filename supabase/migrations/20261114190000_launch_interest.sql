-- Ping Clean: launch interest from customers AND cleaners, with a few short answers
-- (signed off by Carl, 14 Nov 2026; plan in intent/launch-interest/plan.md).
--
--   The /launch page asks people to register interest either as a customer or as someone
--   who wants to clean with Ping, then asks a few optional tap-to-answer questions.
--
--   public.register_launch_interest(…)       SERVER ONLY (service role): called by the Server
--                                            Action after the honeypot and Turnstile.
--   public.admin_list_interest(…)            now also returns kind and the tap answers
--   public.admin_export_interest(…)          now also returns kind, first name and answers
--   public.admin_interest_answer_counts()    admin: tallies per question          (audited)
--
-- Carl's 7 Nov rules all still hold: email OR mobile, the tick is required, kept for
-- settings.interest_retention_months, opt-outs stay out, the reply is always 'thanks'.
-- No new table: interest_signups stays closed to every role (no policies, no grants).
-- public.register_interest is untouched.

-- ---------------------------------------------------------------- the table
alter table public.interest_signups drop constraint interest_signups_kind_check;
alter table public.interest_signups
  add constraint interest_signups_kind_check check (kind in ('customer', 'cleaner'));

alter table public.interest_signups drop constraint interest_signups_source_check;
alter table public.interest_signups
  add constraint interest_signups_source_check check (source in ('instant_price', 'holding_page', 'launch_page'));

-- The answers: one flat object of fixed keys. A value is one option key ("weekly"), a short
-- list of option keys, or, under "note" only, up to 500 characters of the person's own
-- words. The Server Action checks the keys and options against the real questions
-- (lib/interest/launch.ts); this is the shape check nothing can get past.
create function private.valid_interest_answers(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null
     and jsonb_typeof(p) = 'object'
     and pg_column_size(p) <= 4096
     and (select count(*) from jsonb_object_keys(p)) <= 12
     and not exists (
       select 1 from jsonb_each(p) e
       where e.key !~ '^[a-z_]{1,32}$'
          or case
               when e.key = 'note' then
                 jsonb_typeof(e.value) <> 'string'
                 or length(e.value #>> '{}') not between 1 and 500
                 -- control characters other than tab, new line and carriage return
                 or (e.value #>> '{}') ~ '[\x01-\x08\x0B\x0C\x0E-\x1F]'
                 or position(chr(127) in (e.value #>> '{}')) > 0
               when jsonb_typeof(e.value) = 'string' then (e.value #>> '{}') !~ '^[a-z0-9_]{1,40}$'
               when jsonb_typeof(e.value) = 'array' then
                 jsonb_array_length(e.value) not between 1 and 8
                 or exists (select 1 from jsonb_array_elements(e.value) a
                            where jsonb_typeof(a) <> 'string' or (a #>> '{}') !~ '^[a-z0-9_]{1,40}$')
               else true
             end
     )
$$;

create function private.valid_first_name(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p !~ '[\x01-\x1F]' and position(chr(127) in p) = 0
     and p ~ '^[^0-9<>=@+";/\\ -][^0-9<>=@+";/\\]{0,59}$'
$$;

alter table public.interest_signups
  -- Optional, so the one message can say hello. Up to 60 characters; no digits, control
  -- characters or anything a spreadsheet or a page could act on (the form is stricter:
  -- letters, spaces, hyphens and apostrophes). Written as "not these" so it does not
  -- depend on the database's locale.
  add column first_name text check (first_name is null or private.valid_first_name(first_name)),
  add column answers jsonb not null default '{}'::jsonb check (private.valid_interest_answers(answers));

-- ---------------------------------------------------------------- register_launch_interest
-- The /launch form. Server only, like register_interest, and the same promises: nothing is
-- stored without the tick, an opted-out contact stays out, and the reply is always
-- 'thanks'. The source is fixed here ('launch_page'); the kind is one of the two the page
-- offers. Registering again for the same area renews consent and the retention clock and
-- replaces the answers; it never clears "told".
-- Error codes: PC030 postcode · PC031 email or mobile · PC032 not open · PC033 anything
-- else about the form (kind, name, answers, consent version).
create function public.register_launch_interest(
  p_kind text,
  p_first_name text,
  p_postcode text,
  p_email text,
  p_phone text,
  p_notify boolean,
  p_consent_version text,
  p_answers jsonb
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_postcode text := private.normalise_postcode(p_postcode);
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_name text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_answers jsonb := coalesce(p_answers, '{}'::jsonb);
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
  if p_kind is null or p_kind not in ('customer', 'cleaner')
     or p_consent_version is null or p_consent_version !~ '^[a-z0-9-]{1,40}$'
     or (v_name is not null and not private.valid_first_name(v_name))
     or not private.valid_interest_answers(v_answers) then
    raise exception 'Form details not valid' using errcode = 'PC033';
  end if;

  -- Carl's rule: only store when the box is ticked.
  if p_notify is not true then
    return 'thanks';
  end if;
  -- Someone who opted out stays out, as a customer or as a cleaner, in any district.
  if private.interest_opted_out(v_email, v_phone) then
    return 'thanks';
  end if;

  if v_email is not null then
    insert into public.interest_signups as i
      (kind, first_name, postcode, email, consent_text_version, source, answers, delete_after)
    values (p_kind, v_name, v_postcode, v_email, p_consent_version, 'launch_page', v_answers,
            now() + make_interval(months => v_months))
    on conflict (kind, email, postcode_district) where email is not null do update
      set postcode = excluded.postcode, first_name = excluded.first_name, answers = excluded.answers,
          consent_text_version = excluded.consent_text_version, source = excluded.source,
          registered_at = now(), delete_after = excluded.delete_after
      where i.unsubscribed_at is null;
  else
    insert into public.interest_signups as i
      (kind, first_name, postcode, phone, consent_text_version, source, answers, delete_after)
    values (p_kind, v_name, v_postcode, v_phone, p_consent_version, 'launch_page', v_answers,
            now() + make_interval(months => v_months))
    on conflict (kind, phone, postcode_district) where phone is not null do update
      set postcode = excluded.postcode, first_name = excluded.first_name, answers = excluded.answers,
          consent_text_version = excluded.consent_text_version, source = excluded.source,
          registered_at = now(), delete_after = excluded.delete_after
      where i.unsubscribed_at is null;
  end if;
  return 'thanks';
end $$;

-- ---------------------------------------------------------------- admin
-- The return types change, so these two are dropped and made again (same rules, same audit).

-- The list for the console, contacts masked. Now says who is a customer and who wants to
-- clean, and carries the tap answers. Never the first name or the free-text note: those
-- only leave in the export.
drop function public.admin_list_interest(text);
create function public.admin_list_interest(p_district text default null)
returns table (id uuid, kind text, postcode_district text, contact_type text, contact_masked text, source text,
               answers jsonb, registered_at timestamptz, notified_at timestamptz, unsubscribed_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  perform private.require_admin();
  return query
    select i.id, i.kind, i.postcode_district, case when i.email is not null then 'email' else 'phone' end,
           private.mask_contact(i.email, i.phone), i.source, i.answers - 'note',
           i.registered_at, i.notified_at, i.unsubscribed_at
    from public.interest_signups i
    where p_district is null or i.postcode_district = upper(btrim(p_district))
    order by i.registered_at desc;
  get diagnostics v_rows = row_count;
  perform private.audit_interest('view_list',
    jsonb_build_object('district', coalesce(upper(btrim(p_district)), 'all'), 'rows', v_rows));
end $$;

-- The contact list for one district (or all). Never includes anyone who unsubscribed.
drop function public.admin_export_interest(text);
create function public.admin_export_interest(p_district text default null)
returns table (id uuid, kind text, first_name text, postcode text, postcode_district text, email text, phone text,
               answers jsonb, registered_at timestamptz, notified_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  perform private.require_admin();
  return query
    select i.id, i.kind, i.first_name, i.postcode, i.postcode_district, i.email, i.phone, i.answers,
           i.registered_at, i.notified_at
    from public.interest_signups i
    where i.unsubscribed_at is null
      and (p_district is null or i.postcode_district = upper(btrim(p_district)))
    order by i.postcode_district, i.registered_at;
  get diagnostics v_rows = row_count;
  perform private.audit_interest('export',
    jsonb_build_object('district', coalesce(upper(btrim(p_district)), 'all'), 'rows', v_rows));
end $$;

-- What people told us: how many chose each answer, customers and cleaners apart. Counts
-- only (the free-text note is left out), excluding anyone who unsubscribed.
create function public.admin_interest_answer_counts()
returns table (kind text, question text, answer text, people bigint)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  perform private.require_admin();
  return query
    select i.kind, e.key, v.answer, count(*)
    from public.interest_signups i
    cross join lateral jsonb_each(i.answers - 'note') e
    cross join lateral (
      select a #>> '{}' as answer
      from jsonb_array_elements(case when jsonb_typeof(e.value) = 'array' then e.value
                                     else jsonb_build_array(e.value) end) a
    ) v
    where i.unsubscribed_at is null
    group by i.kind, e.key, v.answer
    order by i.kind, e.key, count(*) desc, v.answer;
  get diagnostics v_rows = row_count;
  perform private.audit_interest('view_answers', jsonb_build_object('rows', v_rows));
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function private.valid_interest_answers(jsonb), private.valid_first_name(text) from public, anon, authenticated;
revoke all on function public.register_launch_interest(text, text, text, text, text, boolean, text, jsonb),
  public.admin_list_interest(text), public.admin_export_interest(text), public.admin_interest_answer_counts()
  from public, anon, authenticated;
-- The server only (lib/db/admin.ts, from the Server Action). Not anon, not authenticated.
grant execute on function public.register_launch_interest(text, text, text, text, text, boolean, text, jsonb) to service_role;
grant execute on function public.admin_list_interest(text), public.admin_export_interest(text),
  public.admin_interest_answer_counts() to authenticated;
