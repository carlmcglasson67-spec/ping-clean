-- No access: the cleaner turned up and couldn't get in (no key, nobody home). Closes the #60
-- item "No access: a way to record it, and whether it carries a fee". Plan: intent/no-access/plan.md.
--
-- Carl's decision (23 Nov 2026): the customer pays the late-cancellation fee, and the cleaner
-- gets their usual share of it for the wasted trip. Which rule applies is
-- settings.no_access_rule, set in the admin console, never here:
--   'late_cancel_fee'  the late-cancellation fee and split, as for a clean a cleaner holds
--   'no_charge'        nothing
--   'admin_decides'    the office chooses, each time: that fee, or nothing
--
-- The office records it as a third answer to a "Clean missed" alert: "Couldn't get in".
-- The clean is cancelled with cancel_reason 'no_access', and a fee is a 'late_cancel'
-- payment exactly as cancel_visit writes one, so the charge job charges it, payout_for_payment
-- pays the cleaner their part after the check period, and refunds and disputes already know it.
-- The customer is emailed either way (the outbox, kind 'no_access_fee').
--
--   PC067 no_access_rule isn't set, or it needs the late-cancellation fee and that isn't set
--   PC068 the cost the office was shown (the fee, or the cleaner's part of it) isn't the
--         cost now (a setting changed): look again
--
-- Schema changes (Carl signs off by merging): visit_settlements.outcome takes 'no_access';
-- private.customer_notices gets a visit_id column and the kind 'no_access_fee'.
-- No new tables. TEST mode only.

-- ---------------------------------------------------------------- the record takes a third answer
alter table public.visit_settlements drop constraint visit_settlements_outcome_check;
alter table public.visit_settlements add constraint visit_settlements_outcome_check
  check (outcome in ('done', 'not_done', 'no_access'));

-- ---------------------------------------------------------------- the customer is told
-- A no-access email is about a clean, and there may be no payment (no fee): the outbox can
-- name the clean itself. Only this kind uses it, and it always does.
alter table private.customer_notices add column visit_id uuid references public.visits (id) on delete restrict;
alter table private.customer_notices drop constraint customer_notices_kind_check;
alter table private.customer_notices add constraint customer_notices_kind_check check (kind in
  ('payment_failed', 'payment_needs_confirming', 'block_on_hold', 'block_ended_unpaid',
   'cleaner_block_on_hold', 'cleaner_block_back_on', 'cleaner_block_ended',
   'no_access_fee'));
alter table private.customer_notices add constraint customer_notices_no_access_names_its_clean
  check ((kind = 'no_access_fee') = (visit_id is not null));

-- ---------------------------------------------------------------- what no access costs
-- From settings.no_access_rule. The fee and its split are late_cancel_terms' for a clean a
-- cleaner holds, with no notice-time condition (the cleaner was at the door): the fee, never
-- more than the clean's price, the cleaner's part rounded down, Ping takes the rest.
-- For 'admin_decides' it gives the fee the office can choose to charge.
-- The cleaner's part goes to the cleaner named on the clean whatever their status now: a
-- cleaner suspended or removed since still made the trip (a choice for Carl to confirm,
-- intent/no-access/plan.md).
create function private.no_access_terms(
  p_visit uuid, out rule text, out fee_pence integer, out cleaner_pence integer, out ping_pence integer
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.visits;
  st public.settings;
begin
  select * into v from public.visits where id = p_visit;
  select * into st from public.settings limit 1;
  rule := st.no_access_rule;
  fee_pence := 0; cleaner_pence := 0; ping_pence := 0;
  if rule is null
     or (rule <> 'no_charge' and (coalesce(st.late_cancel_fee_pence, 0) <= 0 or st.late_cancel_split is null)) then
    raise exception 'Choose what a no-access visit costs in Settings first' using errcode = 'PC067';
  end if;
  if rule = 'no_charge' or v.price_pence <= 0 then
    return;
  end if;
  fee_pence := least(st.late_cancel_fee_pence, v.price_pence);
  cleaner_pence := case st.late_cancel_split
    when 'same_as_clean' then floor(fee_pence::numeric * v.cleaner_earnings_pence / v.price_pence)::integer
    else floor(fee_pence::numeric * st.late_cancel_cleaner_share_bps / 10000)::integer end;
  ping_pence := fee_pence - cleaner_pence;
end $$;
revoke all on function private.no_access_terms(uuid) from public, anon, authenticated;

-- What the settle step shows before the office confirms. The Ping team only.
--   rule       settings.no_access_rule ('admin_decides': the office chooses fee or nothing)
--   fee_pence  what the customer would be charged (0: nothing)
create function public.admin_no_access_quote(p_visit uuid)
returns table (rule text, fee_pence integer, cleaner_pence integer, ping_pence integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  t record;
begin
  if not private.is_admin() then
    raise exception 'Only the Ping team can see that' using errcode = '42501';
  end if;
  if not exists (select 1 from public.visits where id = p_visit) then
    raise exception 'That clean isn''t waiting to be settled' using errcode = 'PC056';
  end if;
  select * into t from private.no_access_terms(p_visit);
  rule := t.rule; fee_pence := t.fee_pence; cleaner_pence := t.cleaner_pence; ping_pence := t.ping_pence;
  return next;
end $$;
revoke all on function public.admin_no_access_quote(uuid) from public, anon;
grant execute on function public.admin_no_access_quote(uuid) to authenticated;

-- ---------------------------------------------------------------- settle, with "couldn't get in"
-- As 20261121100000_settle_visit.sql, plus the outcome 'no_access':
--   * only a missed clean ('no_show') with a cleaner, from a day that has gone; also one
--     already marked as not done (the way back, p_was_not_done = true). Refused for a clean
--     that was started (PC056: they got in) and one waiting for cover (PC058, as for done).
--   * p_fee_pence and p_cleaner_pence are the fee and the cleaner's part of it the office was
--     shown (admin_no_access_quote); if the terms now give another fee or another split,
--     nothing is done (PC068). p_charge is the office's choice
--     under 'admin_decides' and must be left out under any other rule (PC068 either way:
--     the page didn't show the rule that holds now).
create function private.settle_no_access(p_visit uuid, p_actor uuid, p_fee_pence integer, p_cleaner_pence integer, p_charge boolean)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v public.visits;
  t record;
  fee integer;
  pid uuid;
begin
  select * into v from public.visits where id = p_visit;
  select * into t from private.no_access_terms(v.id);
  if t.fee_pence is distinct from p_fee_pence
     or t.cleaner_pence is distinct from p_cleaner_pence
     or (t.rule = 'admin_decides') is distinct from (p_charge is not null) then
    raise exception 'The cost has changed, look again' using errcode = 'PC068';
  end if;
  fee := case when t.rule = 'admin_decides' and not p_charge then 0 else t.fee_pence end;

  update public.visits
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor, cancel_reason = 'no_access',
         late_cancel_fee_pence = fee
   where id = v.id;
  -- The fee, exactly as cancel_visit writes one: the charge job takes it from here.
  if fee > 0 then
    pid := gen_random_uuid();
    insert into public.payments (id, visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, kind, idempotency_key)
    values (pid, v.id, v.customer_id, fee, t.ping_pence, t.cleaner_pence,
            'late_cancel', 'payment:' || pid);
  end if;
  -- The customer is told, fee or not. Once per clean.
  insert into private.customer_notices (customer_id, kind, payment_id, series_id, visit_id, dedupe)
  values (v.customer_id, 'no_access_fee', pid, v.series_id, v.id, 'no_access_fee:' || v.id)
  on conflict (dedupe) do nothing;
end $$;
revoke all on function private.settle_no_access(uuid, uuid, integer, integer, boolean) from public, anon, authenticated;

drop function public.admin_settle_visit(uuid, text, text, boolean);
create function public.admin_settle_visit(
  p_visit uuid, p_outcome text, p_reason text, p_was_not_done boolean default false,
  p_fee_pence integer default null, p_charge boolean default null, p_cleaner_pence integer default null
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  sid uuid;
  cid uuid;
  v public.visits;
  reason_ text := nullif(btrim(coalesce(p_reason, '')), '');
  skipped integer;
  was_settled boolean;
begin
  if not private.is_admin() then
    raise exception 'Only the Ping team can settle a clean' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('done', 'not_done', 'no_access') then
    raise exception 'Unknown outcome' using errcode = '22023';
  end if;
  if reason_ is null or reason_ !~ '[[:alnum:]]{3,}' or char_length(reason_) > 300 then
    raise exception 'Say what happened (up to 300 characters)' using errcode = '22023';
  end if;
  -- The cost of no access is only for no access: done and not done charge what they always did.
  if p_outcome <> 'no_access' and (p_fee_pence is not null or p_charge is not null or p_cleaner_pence is not null) then
    raise exception 'A fee is only for a clean the cleaner couldn''t get in to' using errcode = '22023';
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

  -- Read under the visit's lock, so two of the team can't both pass it. The only settled
  -- clean that gets this far is a missed one marked as not done (settled as done it is
  -- 'completed'; an unfinished one marked as not done, or a missed one marked as no access,
  -- is 'cancelled').
  was_settled := exists (select 1 from public.visit_settlements st where st.visit_id = v.id);
  if was_settled is distinct from coalesce(p_was_not_done, false) then
    raise exception 'That clean isn''t waiting to be settled' using errcode = 'PC056';
  end if;

  if p_outcome = 'done' then
    if v.cleaner_id is null then
      raise exception 'That clean had no cleaner, so it can''t be marked as done' using errcode = 'PC057';
    end if;
    -- The block went back on the board that day with this clean still booked ("needs cover"),
    -- and nobody has said cover was found. The cleaner named on the clean is the one who came
    -- off it: marking it done would pay them for a clean they didn't do.
    if exists (select 1 from public.engine_alerts a
                where a.visit_id = v.id and a.kind = 'visit_needs_cover' and a.resolved_at is null) then
      raise exception 'That clean was waiting for cover, so it can''t be marked as done' using errcode = 'PC058';
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
  elsif p_outcome = 'no_access' then
    -- Started means they got in: that is "done" or "wasn't done", never no access.
    if v.status <> 'no_show' then
      raise exception 'That clean isn''t waiting to be settled' using errcode = 'PC056';
    end if;
    if v.cleaner_id is null then
      raise exception 'That clean had no cleaner, so nobody went to the door' using errcode = 'PC057';
    end if;
    -- The cleaner named on it had come off the block that day: they weren't the one at the door.
    if exists (select 1 from public.engine_alerts a
                where a.visit_id = v.id and a.kind = 'visit_needs_cover' and a.resolved_at is null) then
      raise exception 'That clean was waiting for cover, so it can''t be marked as no access' using errcode = 'PC058';
    end if;
    perform private.settle_no_access(v.id, me, p_fee_pence, p_cleaner_pence, p_charge);
    perform private.end_block_if_done(sid);
  else
    if was_settled then
      -- A missed clean already marked as not done: nothing to change. It can still be
      -- settled as done or no access, above, if that turns out to be what happened.
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

revoke all on function public.admin_settle_visit(uuid, text, text, boolean, integer, boolean, integer) from public, anon;
grant execute on function public.admin_settle_visit(uuid, text, text, boolean, integer, boolean, integer) to authenticated;

-- ---------------------------------------------------------------- sending it
-- As 20261122092000_payments_followups.sql, plus: a notice that names its clean (no access)
-- takes the clean's date from the clean, as there may be no payment.
create or replace function public.notices_claim(p_limit integer default 20)
returns table (notice_id uuid, kind text, email text, full_name text, payment_id uuid, amount_pence integer, clean_date date,
               town text, weekday smallint)
language plpgsql volatile security definer set search_path = '' as $$
declare
  n private.customer_notices;
begin
  for n in
    select c.* from private.customer_notices c
    where c.sent_at is null and c.attempts < 5
      and (c.claimed_at is null or c.claimed_at < now() - interval '10 minutes')
    order by c.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
    for update of c skip locked
  loop
    update private.customer_notices set claimed_at = clock_timestamp(), attempts = attempts + 1 where id = n.id;
    notice_id := n.id; kind := n.kind; payment_id := n.payment_id;
    email := null; full_name := null; amount_pence := null; clean_date := null; town := null; weekday := null;
    select pr.email, pr.full_name into email, full_name from public.profiles pr where pr.id = n.customer_id;
    select pay.amount_pence, v.scheduled_date into amount_pence, clean_date
      from public.payments pay join public.visits v on v.id = pay.visit_id where pay.id = n.payment_id;
    if n.visit_id is not null then
      select v.scheduled_date into clean_date from public.visits v where v.id = n.visit_id;
    end if;
    -- The cleaner's emails name the block by its town and day, never the address.
    if n.kind like 'cleaner\_%' then
      select pp.town, s.preferred_day into town, weekday
        from public.series s join public.properties pp on pp.id = s.property_id where s.id = n.series_id;
    end if;
    return next;
  end loop;
end $$;
revoke all on function public.notices_claim(integer) from public, anon, authenticated;
grant execute on function public.notices_claim(integer) to service_role;
