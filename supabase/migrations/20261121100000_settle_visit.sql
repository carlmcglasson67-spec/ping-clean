-- Settling a clean by hand (shared request C-7; plan in intent/settle/plan.md).
--
-- Two alerts tell the Ping team to act and gave it nothing to act with: a clean the day
-- passed on without a Start ('no_show'), and one that was started and never completed
-- (still 'in_progress'). complete_visit only works on the day, so from the next morning
-- nobody could finish it: the customer was never charged and the cleaner never paid.
--
--   PC056 that clean isn't waiting to be settled (not missed or unfinished, still today's,
--         or already settled that way)
--   PC057 that clean had no cleaner, so it can't be marked as done
--   22023 the outcome isn't 'done' or 'not_done', or the reason is missing or too long
--
-- "Done" goes through the same insert_visit_charge as complete_visit: there is still only
-- one way a clean is charged.

-- ---------------------------------------------------------------- the record
create table public.visit_settlements (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits (id) on delete cascade,
  outcome text not null check (outcome in ('done', 'not_done')),
  -- What the clean was when the team stepped in: 'in_progress' or 'no_show'.
  was_status public.visit_status not null check (was_status in ('in_progress', 'no_show')),
  reason text not null check (char_length(reason) between 3 and 300),
  actor_id uuid not null references public.profiles (id),
  -- The clock, not the transaction's start: two calls in one transaction keep their order.
  created_at timestamptz not null default clock_timestamp()
);
alter table public.visit_settlements enable row level security;
create index visit_settlements_visit_idx on public.visit_settlements (visit_id, created_at desc);

-- The Ping team reads it. Nobody writes it directly: rows come only from the function
-- below. The customer and the cleaner never see the reason.
revoke all on public.visit_settlements from anon, authenticated;
grant select on public.visit_settlements to authenticated;
create policy visit_settlements_admin_select on public.visit_settlements
  for select to authenticated
  using ((select private.is_admin()));

-- In the audit log with the admin as the actor. The reason is logged as "changed", never
-- its words: it is free text about people.
create trigger visit_settlements_audit after insert on public.visit_settlements
  for each row execute function private.audit_row('reason');

-- ---------------------------------------------------------------- settle
create function public.admin_settle_visit(p_visit uuid, p_outcome text, p_reason text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  sid uuid;
  cid uuid;
  v public.visits;
  reason_ text := nullif(btrim(coalesce(p_reason, '')), '');
  skipped integer;
begin
  if not private.is_admin() then
    raise exception 'Only the Ping team can settle a clean' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('done', 'not_done') then
    raise exception 'Unknown outcome' using errcode = '22023';
  end if;
  if reason_ is null or reason_ !~ '[[:alnum:]]{3,}' or char_length(reason_) > 300 then
    raise exception 'Say what happened (up to 300 characters)' using errcode = '22023';
  end if;

  select series_id, cleaner_id into sid, cid from public.visits where id = p_visit;
  if not found then
    raise exception 'That clean isn''t waiting to be settled' using errcode = 'PC056';
  end if;
  -- Lock order, as complete_visit: series, cleaner, visit. Two of the team settling the
  -- same clean, or the team and a late tap from the cleaner, wait for each other.
  perform 1 from public.series where id = sid for no key update;
  if cid is not null then
    perform 1 from public.cleaners where id = cid for no key update;
  end if;
  select * into v from public.visits where id = p_visit for update;

  -- Only a clean the engine has handed to the team: started and never finished, or missed,
  -- and booked for a day that has gone. Today's cleans are still the cleaner's.
  if v.status not in ('in_progress', 'no_show')
     or v.scheduled_date >= private.london_today()
     or v.cleaner_id is distinct from cid then
    raise exception 'That clean isn''t waiting to be settled' using errcode = 'PC056';
  end if;

  if p_outcome = 'done' then
    if v.cleaner_id is null then
      raise exception 'That clean had no cleaner, so it can''t be marked as done' using errcode = 'PC057';
    end if;
    -- What complete_visit does, without the checklist and photo checks: the team is
    -- vouching for the clean. "Couldn't do" items the cleaner did record are still counted.
    select count(*) filter (where ci.skipped_reason ~ '[[:alnum:]]{3,}') into skipped
      from public.checklist_items ci where ci.visit_id = v.id;
    update public.visits
       set status = 'completed', started_at = coalesce(started_at, now()), completed_at = now(),
           couldnt_do_count = coalesce(skipped, 0)
     where id = v.id;
    update public.cleaners set completed_visits = completed_visits + 1 where id = v.cleaner_id;
    perform private.end_block_if_done(sid);
    -- The charge, by the one function that makes charges. Not held for "couldn't do" items:
    -- the team has just looked at this clean, which is what the hold is for.
    perform private.insert_visit_charge(v.id);
  else
    if v.status = 'no_show' and exists (select 1 from public.visit_settlements st where st.visit_id = v.id) then
      -- A missed clean already settled as not done (a clean settled as done is 'completed'
      -- and never gets here): nothing to change. It can still be settled as done, above,
      -- if it turns out the clean did happen.
      raise exception 'That clean isn''t waiting to be settled' using errcode = 'PC056';
    end if;
    if v.status = 'in_progress' then
      -- Started and not finished: cancelled by the team. No fee to anyone.
      update public.visits
         set status = 'cancelled', cancelled_at = now(), cancelled_by = me, cancel_reason = 'admin'
       where id = v.id;
      perform private.end_block_if_done(sid);
    end if;
    -- A missed clean stays 'no_show': that already says what happened.
  end if;

  insert into public.visit_settlements (visit_id, outcome, was_status, reason, actor_id)
  values (v.id, p_outcome, v.status, reason_, me);

  update public.engine_alerts set resolved_at = now(), resolved_by = me
   where visit_id = v.id and kind in ('visit_no_show', 'visit_unfinished') and resolved_at is null;
end $$;

revoke all on function public.admin_settle_visit(uuid, text, text) from public, anon;
grant execute on function public.admin_settle_visit(uuid, text, text) to authenticated;
