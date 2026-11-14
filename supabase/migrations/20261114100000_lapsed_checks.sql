-- Lapsed checks: tell the office when a WORKING cleaner's documents stop being in order.
--
-- Approval checks the four documents at the moment of the decision and never again. A
-- cleaner whose insurance runs out next month, or whose DBS is later sent back, kept
-- working with nobody told. Now the office gets an alert, and a warning two weeks ahead.
-- Nobody is suspended automatically: that strands booked cleans, so it stays a person's call.
--
--   cleaner_check_lapsed    a working cleaner has no verified, in-date document for one or
--                           more of the four checks (urgent)
--   cleaner_check_expiring  a check's last valid document runs out within 14 days
--
-- A check is in order while ANY verified, in-date document of that kind exists, so a
-- renewal uploaded early (still waiting for review) doesn't raise a false alarm. (Approving
-- and reactivating stay stricter: they go by the newest document.)
--
-- Checked every night, and at once whenever a document or the cleaner's status changes.
-- Alerts close by themselves when the documents are back in order or the cleaner stops
-- working. One open alert per cleaner and kind; if a person resolves one by hand while the
-- problem remains, it comes back after 7 days, not the next night.

-- ---------------------------------------------------------------- alerts can point at a cleaner
alter table public.engine_alerts add column cleaner_id uuid references public.cleaners (id) on delete cascade;

alter table public.engine_alerts drop constraint engine_alerts_kind_check;
alter table public.engine_alerts add constraint engine_alerts_kind_check
  check (kind in ('release_failed', 'generate_failed', 'visit_needs_cover', 'visit_no_show', 'visit_unfinished',
                  'block_overlap', 'block_stalled', 'block_closed',
                  'charge_held', 'charge_blocked', 'payment_needs_customer', 'payment_failed',
                  'payout_failed', 'payout_stuck',
                  'refund_failed', 'refund_after_payout', 'payment_disputed',
                  'visit_cancelled_late',
                  'cleaner_check_lapsed', 'cleaner_check_expiring'));

create unique index engine_alerts_one_open_cleaner_check on public.engine_alerts (cleaner_id, kind)
  where kind in ('cleaner_check_lapsed', 'cleaner_check_expiring') and resolved_at is null;

-- ---------------------------------------------------------------- the words
create function private.document_kind_words(p_kinds public.document_kind[]) returns text
language sql immutable set search_path = '' as $$
  select coalesce(string_agg(case k
           when 'insurance' then 'public liability insurance'
           when 'dbs' then 'DBS check'
           when 'photo_id' then 'photo ID'
           when 'right_to_work' then 'right to work' end, ', ' order by k), '')
    from unnest(p_kinds) as k
$$;

-- ---------------------------------------------------------------- one cleaner
-- Raises, updates or closes the two alerts for one cleaner. Safe to call any time.
create function private.check_cleaner(p_cleaner uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Europe/London')::date;
  working boolean;
  lapsed public.document_kind[];
  expiring public.document_kind[];
  soonest date;
  msg text;
begin
  select c.status = 'active' into working from public.cleaners c where c.id = p_cleaner;
  if working is not true then
    -- Not working (applicant, suspended, left, or gone): nothing to warn about.
    update public.engine_alerts set resolved_at = now()
     where cleaner_id = p_cleaner and kind in ('cleaner_check_lapsed', 'cleaner_check_expiring') and resolved_at is null;
    return;
  end if;

  -- For each of the four: the latest end date among verified, in-date documents
  -- (no end date = doesn't run out). No such document = lapsed.
  with kinds as (
    select k.kind,
           (select max(coalesce(d.expires_on, 'infinity'::date))
              from public.cleaner_documents d
             where d.cleaner_id = p_cleaner and d.kind = k.kind and d.status = 'verified'
               and (d.expires_on is null or d.expires_on > today)) as good_until
      from unnest(enum_range(null::public.document_kind)) as k (kind)
  )
  select coalesce(array_agg(kind order by kind) filter (where good_until is null), '{}'),
         coalesce(array_agg(kind order by kind) filter (where good_until <= today + 14), '{}'),
         min(good_until) filter (where good_until <= today + 14)
    into lapsed, expiring, soonest
    from kinds;

  -- Lapsed
  if cardinality(lapsed) = 0 then
    update public.engine_alerts set resolved_at = now()
     where cleaner_id = p_cleaner and kind = 'cleaner_check_lapsed' and resolved_at is null;
  else
    msg := 'A working cleaner no longer has a verified, in-date document for: ' || private.document_kind_words(lapsed)
           || '. They can still take and do cleans. Ask them for a new document, or suspend them until it''s sorted.';
    update public.engine_alerts set message = msg
     where cleaner_id = p_cleaner and kind = 'cleaner_check_lapsed' and resolved_at is null and message is distinct from msg;
    if not exists (select 1 from public.engine_alerts a
                    where a.cleaner_id = p_cleaner and a.kind = 'cleaner_check_lapsed'
                      and (a.resolved_at is null or (a.resolved_by is not null and a.resolved_at > now() - interval '7 days'))) then
      insert into public.engine_alerts (kind, cleaner_id, message) values ('cleaner_check_lapsed', p_cleaner, msg)
      on conflict do nothing;
    end if;
  end if;

  -- Running out soon
  if cardinality(expiring) = 0 then
    update public.engine_alerts set resolved_at = now()
     where cleaner_id = p_cleaner and kind = 'cleaner_check_expiring' and resolved_at is null;
  else
    msg := 'A working cleaner''s ' || private.document_kind_words(expiring) || ' runs out soon (first on '
           || to_char(soonest, 'FMDD FMMonth YYYY') || '). Ask them to upload the renewal before then.';
    update public.engine_alerts set message = msg
     where cleaner_id = p_cleaner and kind = 'cleaner_check_expiring' and resolved_at is null and message is distinct from msg;
    if not exists (select 1 from public.engine_alerts a
                    where a.cleaner_id = p_cleaner and a.kind = 'cleaner_check_expiring'
                      and (a.resolved_at is null or (a.resolved_by is not null and a.resolved_at > now() - interval '7 days'))) then
      insert into public.engine_alerts (kind, cleaner_id, message) values ('cleaner_check_expiring', p_cleaner, msg)
      on conflict do nothing;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------- every night
-- Dates pass without anything changing in the database, so every working cleaner (and
-- anyone with an alert still open) is looked at once a night. Returns how many were checked.
create function private.run_cleaner_checks() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  id_ uuid;
  n integer := 0;
begin
  perform set_config('app.actor', 'cron:cleaner-checks', true);
  for id_ in
    select c.id from public.cleaners c where c.status = 'active'
    union
    select a.cleaner_id from public.engine_alerts a
     where a.cleaner_id is not null and a.resolved_at is null and a.kind in ('cleaner_check_lapsed', 'cleaner_check_expiring')
  loop
    perform private.check_cleaner(id_);
    n := n + 1;
  end loop;
  return n;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ping-cleaner-checks', '30 2 * * *', 'select private.run_cleaner_checks()');
  end if;
end $$;

-- ---------------------------------------------------------------- at once, when something changes
create function private.cleaner_checks_on_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'cleaner_documents' then
    if tg_op = 'DELETE' then
      perform private.check_cleaner(old.cleaner_id);
    else
      perform private.check_cleaner(new.cleaner_id);
    end if;
  else
    perform private.check_cleaner(new.id);
  end if;
  return null;
end $$;

create trigger cleaner_documents_checks after insert or delete or update of status, expires_on, kind on public.cleaner_documents
  for each row execute function private.cleaner_checks_on_change();
create trigger cleaners_checks after update of status on public.cleaners
  for each row execute function private.cleaner_checks_on_change();

revoke all on function private.document_kind_words(public.document_kind[]), private.check_cleaner(uuid),
  private.run_cleaner_checks(), private.cleaner_checks_on_change() from public, anon, authenticated;

-- Anyone already working when this lands is checked now, not tomorrow night.
select private.run_cleaner_checks();
