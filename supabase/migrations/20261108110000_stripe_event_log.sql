-- Ping Clean: payments PR 3, the Stripe webhook event log (payments plan, signed off by Carl
-- on 8 Nov 2026). Uses private.stripe_events from PR 2. Service role only: called by the
-- webhook receivers (app/api/stripe/*) after the signature has been checked.
--
--   stripe_begin_event(id, type, account) → 'process' the first time (or again, if an earlier
--                                            attempt failed), 'done' if already handled
--   stripe_finish_event(id, error)         → marks it handled, or records why it failed (so
--                                            Stripe's retry processes it again)

create function public.stripe_begin_event(p_event_id text, p_type text, p_account text)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_done timestamptz;
begin
  insert into private.stripe_events (event_id, type, account)
  values (p_event_id, left(p_type, 100), p_account)
  on conflict (event_id) do nothing;
  select processed_at into v_done from private.stripe_events where event_id = p_event_id for update;
  return case when v_done is null then 'process' else 'done' end;
end $$;

create function public.stripe_finish_event(p_event_id text, p_error text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update private.stripe_events
     set processed_at = case when p_error is null then now() end,
         error = left(p_error, 300)
   where event_id = p_event_id;
end $$;

revoke all on function public.stripe_begin_event(text, text, text), public.stripe_finish_event(text, text)
  from public, anon, authenticated;
grant execute on function public.stripe_begin_event(text, text, text), public.stripe_finish_event(text, text)
  to service_role;
