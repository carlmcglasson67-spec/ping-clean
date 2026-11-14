-- Cleaner decisions (shared request C-1): approve, decline, suspend, reactivate, change tier.
--
-- Until now the console could review documents but nothing could move a cleaner from
-- applicant to working: status, tier, approved_at and approved_by have no UPDATE grant
-- (rightly) and there was no admin function. These two functions are the only way in.
--
--   PC052 the four checks aren't all verified and in date (detail = the kinds still
--         waiting, e.g. 'dbs,insurance')
--   PC053 that move isn't allowed from where the cleaner stands (detail = their status)
--   22023 a reason (a real word or more, up to 300 characters) is required, or the
--         decision isn't one of the four
--
-- Every decision writes a cleaner_reviews row (who, what, why), and the cleaners audit
-- trigger logs the status and tier change with the admin as the actor.

-- ---------------------------------------------------------------- the decision log
create table public.cleaner_reviews (
  id uuid primary key default gen_random_uuid(),
  cleaner_id uuid not null references public.cleaners (id) on delete cascade,
  decision text not null check (decision in ('approve', 'decline', 'suspend', 'reactivate', 'tier')),
  tier public.cleaner_tier,
  reason text check (char_length(reason) <= 300),
  actor_id uuid not null references public.profiles (id),
  -- The clock, not the transaction's start: two decisions in one transaction keep their order.
  created_at timestamptz not null default clock_timestamp()
);
alter table public.cleaner_reviews enable row level security;
create index cleaner_reviews_cleaner_idx on public.cleaner_reviews (cleaner_id, created_at desc);

-- The Ping team reads it. Nobody writes it directly: rows come only from the functions
-- below. The cleaner doesn't see the reason (Carl to decide if they should).
revoke all on public.cleaner_reviews from anon, authenticated;
grant select on public.cleaner_reviews to authenticated;
create policy cleaner_reviews_admin_select on public.cleaner_reviews
  for select to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------- the four checks
-- The kinds still waiting: for each of the four, the newest document must be verified
-- and, if it has an end date, that date must be after today (London). Empty = ready.
create function private.cleaner_checks_waiting(p_cleaner uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(k.kind::text order by k.kind), '{}')
    from unnest(enum_range(null::public.document_kind)) as k (kind)
   where not exists (
     select 1
       from (select d.status, d.expires_on
               from public.cleaner_documents d
              where d.cleaner_id = p_cleaner and d.kind = k.kind
              order by d.created_at desc, d.id desc
              limit 1) latest
      where latest.status = 'verified'
        and (latest.expires_on is null or latest.expires_on > (now() at time zone 'Europe/London')::date)
   )
$$;
revoke all on function private.cleaner_checks_waiting(uuid) from public;

-- ---------------------------------------------------------------- decide
create function public.admin_review_cleaner(p_cleaner uuid, p_decision text, p_tier public.cleaner_tier, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  c public.cleaners;
  waiting text[];
  reason_ text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not private.is_admin() then
    raise exception 'Only the Ping team can decide on a cleaner' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'decline', 'suspend', 'reactivate') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  if char_length(coalesce(reason_, '')) > 300
     or (p_decision in ('decline', 'suspend') and (reason_ is null or reason_ !~ '[[:alnum:]]{3,}')) then
    raise exception 'Say why (up to 300 characters)' using errcode = '22023';
  end if;
  if p_decision = 'approve' and p_tier is null then
    raise exception 'Choose a tier' using errcode = '22023';
  end if;

  select * into c from public.cleaners where id = p_cleaner for update;
  if not found or p_cleaner = me
     or not exists (select 1 from public.profiles p where p.id = p_cleaner and p.role = 'cleaner') then
    raise exception 'That cleaner was not found' using errcode = 'PC053', detail = 'missing';
  end if;

  if (p_decision in ('approve', 'decline') and c.status <> 'applicant')
     or (p_decision = 'suspend' and c.status <> 'active')
     or (p_decision = 'reactivate' and c.status <> 'suspended') then
    raise exception 'That cleaner can''t go from % to that', c.status using errcode = 'PC053', detail = c.status::text;
  end if;

  if p_decision in ('approve', 'reactivate') then
    -- Lock their documents first: a review of one that's still in flight (another admin
    -- sending a document back) finishes before the checks are read, so nobody is approved
    -- on a document that was being rejected at the same moment.
    perform 1 from public.cleaner_documents where cleaner_id = p_cleaner order by id for update;
    waiting := private.cleaner_checks_waiting(p_cleaner);
    if cardinality(waiting) > 0 then
      raise exception 'The four checks aren''t all verified and in date'
        using errcode = 'PC052', detail = array_to_string(waiting, ',');
    end if;
  end if;

  if p_decision = 'approve' then
    update public.cleaners set status = 'active', tier = p_tier, approved_at = now(), approved_by = me where id = p_cleaner;
  elsif p_decision = 'decline' then
    update public.cleaners set status = 'left' where id = p_cleaner;
  elsif p_decision = 'suspend' then
    update public.cleaners set status = 'suspended' where id = p_cleaner;
    -- They can't start a clean any more, so every block they hold with cleans still to come
    -- needs the office now, not when the first clean is missed.
    insert into public.engine_alerts (kind, series_id, message)
    select 'block_stalled', sr.id,
           'This block''s cleaner has been suspended and can''t do its cleans. Give it to another cleaner or end it, and tell the customer.'
      from public.series sr
     where sr.cleaner_id = p_cleaner and sr.status in ('claimed', 'paused')
       and exists (select 1 from public.visits v where v.series_id = sr.id and v.status in ('scheduled', 'in_progress'))
       and not exists (select 1 from public.engine_alerts a
                        where a.series_id = sr.id and a.kind = 'block_stalled' and a.resolved_at is null);
  else
    update public.cleaners set status = 'active' where id = p_cleaner;
  end if;

  insert into public.cleaner_reviews (cleaner_id, decision, tier, reason, actor_id)
  values (p_cleaner, p_decision, case when p_decision = 'approve' then p_tier end, reason_, me);
end $$;
revoke all on function public.admin_review_cleaner(uuid, text, public.cleaner_tier, text) from public, anon;
grant execute on function public.admin_review_cleaner(uuid, text, public.cleaner_tier, text) to authenticated;

-- ---------------------------------------------------------------- change tier
-- Working cleaners only. A reason is always required: a tier decides which jobs they see first.
create function public.admin_set_cleaner_tier(p_cleaner uuid, p_tier public.cleaner_tier, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  c public.cleaners;
  reason_ text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not private.is_admin() then
    raise exception 'Only the Ping team can change a tier' using errcode = '42501';
  end if;
  if p_tier is null then
    raise exception 'Choose a tier' using errcode = '22023';
  end if;
  if reason_ is null or reason_ !~ '[[:alnum:]]{3,}' or char_length(reason_) > 300 then
    raise exception 'Say why (up to 300 characters)' using errcode = '22023';
  end if;

  select * into c from public.cleaners where id = p_cleaner for update;
  if not found or p_cleaner = me
     or not exists (select 1 from public.profiles p where p.id = p_cleaner and p.role = 'cleaner') then
    raise exception 'That cleaner was not found' using errcode = 'PC053', detail = 'missing';
  end if;
  if c.status <> 'active' then
    raise exception 'Only a working cleaner''s tier can change' using errcode = 'PC053', detail = c.status::text;
  end if;
  if c.tier = p_tier then
    return;
  end if;

  update public.cleaners set tier = p_tier where id = p_cleaner;
  insert into public.cleaner_reviews (cleaner_id, decision, tier, reason, actor_id)
  values (p_cleaner, 'tier', p_tier, reason_, me);
end $$;
revoke all on function public.admin_set_cleaner_tier(uuid, public.cleaner_tier, text) from public, anon;
grant execute on function public.admin_set_cleaner_tier(uuid, public.cleaner_tier, text) to authenticated;

-- ---------------------------------------------------------------- a way back from suspended
-- Reactivating needs all four checks in date, so a suspended cleaner must be able to send a
-- new document (an insurance that ran out while they were suspended). Uploads stay pending
-- and still give them no jobs or addresses.
drop policy documents_insert_own on public.cleaner_documents;
create policy documents_insert_own on public.cleaner_documents
  for insert to authenticated
  with check (
    cleaner_id = (select auth.uid())
    and exists (select 1 from public.cleaners c where c.id = (select auth.uid()) and c.status in ('applicant', 'active', 'suspended'))
  );

drop policy "documents: owner uploads" on storage.objects;
create policy "documents: owner uploads" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cleaner-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.cleaners c where c.id = (select auth.uid()) and c.status in ('applicant', 'active', 'suspended'))
  );
