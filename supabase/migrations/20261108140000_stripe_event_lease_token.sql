-- Ping Clean: the Stripe event lease gets a token (follow-up to the money re-review, 8 Nov 2026).
--
-- 20261108130000 gave each event a 5-minute lease, but stripe_finish_event matched only the
-- event id. So a copy whose lease had run out (copy A) could still report "failed" after a
-- retry (copy B) had taken over, clearing B's lease; a third copy (C) would then be told to
-- 'process' while B was still working.
--
-- Now every lease has its own token. stripe_begin_event hands it to the copy that may
-- process; stripe_finish_event changes the row only when the token is still the current one.
-- A stale copy's finish does nothing and says so (false).
--
--   stripe_begin_event(id, type, account) → (outcome, lease)
--       outcome 'process' with a fresh lease token, 'busy' (another copy holds a live lease),
--       or 'duplicate' (already handled); lease is null unless outcome = 'process'
--   stripe_finish_event(id, lease, error) → true if this copy's lease was still current

alter table private.stripe_events add column lease uuid;

drop function public.stripe_begin_event(text, text, text);
create function public.stripe_begin_event(p_event_id text, p_type text, p_account text,
                                          out outcome text, out lease uuid)
language plpgsql volatile security definer set search_path = '' as $$
declare
  e private.stripe_events;
begin
  insert into private.stripe_events (event_id, type, account)
  values (p_event_id, left(p_type, 100), p_account)
  on conflict (event_id) do nothing;
  select * into e from private.stripe_events where event_id = p_event_id for update;
  if e.processed_at is not null then
    outcome := 'duplicate';
    return;
  end if;
  if e.lease is not null and e.started_at > clock_timestamp() - interval '5 minutes' then
    outcome := 'busy';
    return;
  end if;
  lease := gen_random_uuid();
  update private.stripe_events
     set lease = stripe_begin_event.lease, started_at = clock_timestamp(), error = null
   where event_id = p_event_id;
  outcome := 'process';
end $$;

drop function public.stripe_finish_event(text, text);
create function public.stripe_finish_event(p_event_id text, p_lease uuid, p_error text)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  update private.stripe_events
     set processed_at = case when p_error is null then now() end,
         -- Done: the lease stays as a record. Failed: freed at once, so a retry can take over.
         lease = case when p_error is null then lease end,
         started_at = case when p_error is null then started_at end,
         error = left(p_error, 300)
   where event_id = p_event_id and lease = p_lease and processed_at is null;
  return found;
end $$;

revoke all on function public.stripe_begin_event(text, text, text), public.stripe_finish_event(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.stripe_begin_event(text, text, text), public.stripe_finish_event(text, uuid, text)
  to service_role;
