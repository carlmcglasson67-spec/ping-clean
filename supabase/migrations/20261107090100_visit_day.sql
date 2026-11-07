-- Ping Clean — The visit day: start, checklist (ticked or "couldn't do"), complete.
-- Signed off by Carl, 7 Nov 2026. Shared requests B4 and B5.
--
--   public.start_visit(visit)      cleaner: on the day, lays out the checklist
--   public.complete_visit(visit)   cleaner: only once every item is resolved and photos are in
--
-- The database decides whether a visit is complete, not the phone: Phase 5 charges the
-- card off this state change. No money moves here yet.
--
-- Error codes the cleaner app turns into plain words:
--   PC010 not your visit · PC011 not today · PC012 already finished or not going ahead
--   PC013 checklist not finished (detail: how many left) · PC014 photos missing (detail: which)
--   PC015 no checklist set up

-- ---------------------------------------------------------------- "couldn't do"
-- Every item ends up either ticked, or marked "couldn't do" with a reason the customer and
-- the Ping team can read (for example "No access to the back bedroom"). Never both.
alter table public.checklist_items
  add column skipped_reason text,
  add column skipped_at timestamptz,
  -- A real reason: at least one word of 3+ letters or digits. Spaces, invisible characters
  -- (non-breaking or zero-width spaces) and punctuation alone don't count.
  add constraint checklist_skip_reason check (skipped_reason is null or (skipped_reason ~ '[[:alnum:]]{3,}' and char_length(skipped_reason) <= 300)),
  add constraint checklist_skip_time check ((skipped_reason is null) = (skipped_at is null)),
  add constraint checklist_done_or_skipped check (not (done and skipped_reason is not null));

-- The server stamps both times; the phone's clock is never trusted.
create or replace function private.stamp_checklist_tick() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.done_at := case when new.done then coalesce(old.done_at, now()) end;
  new.skipped_at := case
    when new.skipped_reason is null then null
    when tg_op = 'UPDATE' and old.skipped_reason is not distinct from new.skipped_reason then old.skipped_at
    else now() end;
  return new;
end $$;

-- Cleaners tick or skip (existing policy: their own visit, while it's in progress).
grant update (done, skipped_reason) on public.checklist_items to authenticated;

-- Completed visits with "couldn't do" items: the admin QC queue reads this.
alter table public.visits
  add column couldnt_do_count smallint not null default 0 check (couldnt_do_count >= 0);
create index visits_qc_flag_idx on public.visits (completed_at desc) where couldnt_do_count > 0;

-- ---------------------------------------------------------------- start (B4)
create function public.start_visit(p_visit uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  sid uuid;
  s public.series;
  v public.visits;
  tpl public.checklist_templates;
begin
  if not private.is_active_cleaner() then
    raise exception 'Only active Ping cleaners can start a clean' using errcode = '42501';
  end if;

  select series_id into sid from public.visits where id = p_visit and cleaner_id = me;
  if not found then
    raise exception 'That clean isn''t yours' using errcode = 'PC010';
  end if;
  -- Lock order: series, then visit.
  select * into s from public.series where id = sid for share;
  select * into v from public.visits where id = p_visit for update;

  if s.cleaner_id is distinct from me or v.cleaner_id is distinct from me then
    raise exception 'That clean isn''t yours' using errcode = 'PC010';
  end if;
  if v.status = 'in_progress' then
    return;  -- a retry in bad signal is harmless
  end if;
  if v.status <> 'scheduled' or s.status <> 'claimed' then
    raise exception 'That clean has already finished or isn''t going ahead' using errcode = 'PC012';
  end if;
  if v.scheduled_date <> private.london_today() then
    raise exception 'That clean is booked for another day' using errcode = 'PC011';
  end if;

  select * into tpl from public.checklist_templates where is_default;
  if not found then
    raise exception 'No checklist has been set up yet. Call the Ping office.' using errcode = 'PC015';
  end if;

  update public.visits set status = 'in_progress', started_at = now() where id = v.id;
  insert into public.checklist_items (visit_id, item_key, room, label, position)
  select v.id, i ->> 'key', i ->> 'room', i ->> 'label', (n - 1)::smallint
  from jsonb_array_elements(tpl.items) with ordinality as x (i, n)
  on conflict (visit_id, item_key) do nothing;
end $$;

-- ---------------------------------------------------------------- complete (B5)
create function public.complete_visit(p_visit uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  sid uuid;
  v public.visits;
  left_to_do integer;
  skipped integer;
  missing text;
begin
  if not private.is_active_cleaner() then
    raise exception 'Only active Ping cleaners can complete a clean' using errcode = '42501';
  end if;

  select series_id into sid from public.visits where id = p_visit and cleaner_id = me;
  if not found then
    raise exception 'That clean isn''t yours' using errcode = 'PC010';
  end if;
  -- Lock order: series, cleaner, visit. The series is locked for update because finishing
  -- the last clean of a block ends it; two taps on the same visit wait for each other.
  perform 1 from public.series where id = sid for no key update;
  perform 1 from public.cleaners where id = me for no key update;
  select * into v from public.visits where id = p_visit for update;

  if v.cleaner_id is distinct from me then
    raise exception 'That clean isn''t yours' using errcode = 'PC010';
  end if;
  if v.status = 'completed' then
    return;  -- already done: a retry must never count it twice
  end if;
  if v.status <> 'in_progress' then
    raise exception 'That clean isn''t in progress' using errcode = 'PC012';
  end if;
  if v.scheduled_date <> private.london_today() then
    raise exception 'That clean is booked for another day' using errcode = 'PC011';
  end if;

  select count(*) filter (where not ci.done and (ci.skipped_reason is null or ci.skipped_reason !~ '[[:alnum:]]{3,}')),
         count(*) filter (where ci.skipped_reason ~ '[[:alnum:]]{3,}')
  into left_to_do, skipped
  from public.checklist_items ci where ci.visit_id = v.id;
  if left_to_do > 0 or not exists (select 1 from public.checklist_items where visit_id = v.id) then
    raise exception 'Tick every item, or mark it "couldn''t do" with a reason'
      using errcode = 'PC013', detail = left_to_do::text;
  end if;

  -- A photo counts only if its file really is in the private bucket, uploaded by this
  -- cleaner, and isn't empty: a row on its own (no upload) is not evidence of a clean.
  select string_agg(k::text, ',' order by k) into missing
  from unnest(array['before', 'after']::public.photo_kind[]) as k
  where not exists (
    select 1 from public.visit_photos ph
    join storage.objects o on o.bucket_id = 'visit-photos' and o.name = ph.storage_path
    where ph.visit_id = v.id and ph.kind = k and ph.uploaded_by = me
      and o.owner = me
      and coalesce((o.metadata ->> 'size')::bigint, 0) > 0
  );
  if missing is not null then
    raise exception 'Add at least one before and one after photo' using errcode = 'PC014', detail = missing;
  end if;

  update public.visits
  set status = 'completed', completed_at = now(), couldnt_do_count = skipped
  where id = v.id;
  update public.cleaners set completed_visits = completed_visits + 1 where id = me;
  perform private.end_block_if_done(sid);
end $$;

-- ---------------------------------------------------------------- access
revoke all on function private.stamp_checklist_tick() from public;
revoke all on function public.start_visit(uuid) from public, anon;
revoke all on function public.complete_visit(uuid) from public, anon;
grant execute on function public.start_visit(uuid), public.complete_visit(uuid) to authenticated;
