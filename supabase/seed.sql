-- Ping Clean — LOCAL TEST DATA ONLY. Loaded by `supabase db reset` and by the DB tests.
-- Never run against production.
--
-- Test logins (password for all: ping-test-2026)
--   admin@ping.test               admin
--   anna.customer@ping.test       customer, Workington, block of 8 weekly cleans held by Tara
--   ben.customer@ping.test        customer, Whitehaven, block of 4 fortnightly cleans still on offer
--   tara.cleaner@ping.test        cleaner, active, Top tier
--   alex.cleaner@ping.test        cleaner, active, Approved tier
--   sam.applicant@ping.test       cleaner applicant, not yet approved
--
-- Dates use London's calendar, as the app does.
--
-- The settings below are PLACEHOLDERS so the tests have numbers to work with. They are
-- not pricing decisions: the real figures are open questions in intent/v1/spec.md.

do $$
declare
  pw text := extensions.crypt('ping-test-2026', extensions.gen_salt('bf'));
  u record;
begin
  for u in
    select * from (values
      ('00000000-0000-4000-a000-000000000001'::uuid, 'admin@ping.test',          'Jo Test'),
      ('00000000-0000-4000-a000-000000000002'::uuid, 'anna.customer@ping.test',  'Anna Test'),
      ('00000000-0000-4000-a000-000000000003'::uuid, 'ben.customer@ping.test',   'Ben Test'),
      ('00000000-0000-4000-a000-000000000004'::uuid, 'tara.cleaner@ping.test',   'Tara Test'),
      ('00000000-0000-4000-a000-000000000005'::uuid, 'alex.cleaner@ping.test',   'Alex Test'),
      ('00000000-0000-4000-a000-000000000006'::uuid, 'sam.applicant@ping.test',  'Sam Test')
    ) as t (id, email, full_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, pw, now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.full_name), now(), now(),
      '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now());
  end loop;
end $$;

update public.profiles set role = 'admin' where id = '00000000-0000-4000-a000-000000000001';
update public.profiles set role = 'cleaner', phone = '07700 900004' where id = '00000000-0000-4000-a000-000000000004';
update public.profiles set role = 'cleaner', phone = '07700 900005' where id = '00000000-0000-4000-a000-000000000005';
update public.profiles set role = 'cleaner' where id = '00000000-0000-4000-a000-000000000006';
update public.profiles set phone = '07700 900002' where id = '00000000-0000-4000-a000-000000000002';

update public.settings set
  price_per_hour_pence = 2000, min_booking_minutes = 120,
  commission_type = 'percent', commission_value = 2500,
  top_window_minutes = 120, approved_window_minutes = 240, unclaimed_alert_minutes = 720,
  cancel_notice_hours = 24, late_cancel_fee_pence = 1500, late_cancel_cleaner_share_bps = 5000,
  dispute_window_hours = 48,
  launch_districts = array['CA14', 'CA15', 'CA28', 'CA22', 'CA25', 'CA26']
where id;

insert into public.cleaners (id, status, tier, areas, availability, approved_at, approved_by, rating_avg, rating_count, completed_visits) values
  ('00000000-0000-4000-a000-000000000004', 'active', 'top', array['CA14', 'CA15', 'CA28'],
     '[{"day":1,"from":"08:30","to":"15:00"},{"day":3,"from":"08:30","to":"15:00"},{"day":5,"from":"08:30","to":"13:00"}]',
     now() - interval '60 days', '00000000-0000-4000-a000-000000000001', 4.90, 31, 64),
  ('00000000-0000-4000-a000-000000000005', 'active', 'approved', array['CA28', 'CA22', 'CA25'],
     '[{"day":2,"from":"09:00","to":"14:30"},{"day":4,"from":"09:00","to":"14:30"}]',
     now() - interval '20 days', '00000000-0000-4000-a000-000000000001', null, 0, 3),
  ('00000000-0000-4000-a000-000000000006', 'applicant', 'new', array['CA26'], '[]', null, null, null, 0, 0);

insert into public.cleaner_documents (id, cleaner_id, kind, storage_path, expires_on, status, reviewed_by, reviewed_at) values
  ('00000000-0000-4000-d000-000000000001', '00000000-0000-4000-a000-000000000004', 'dbs',
     '00000000-0000-4000-a000-000000000004/dbs.pdf', null, 'verified', '00000000-0000-4000-a000-000000000001', now() - interval '60 days'),
  ('00000000-0000-4000-d000-000000000002', '00000000-0000-4000-a000-000000000004', 'insurance',
     '00000000-0000-4000-a000-000000000004/insurance.pdf', (now() at time zone 'Europe/London')::date + 200, 'verified', '00000000-0000-4000-a000-000000000001', now() - interval '60 days'),
  ('00000000-0000-4000-d000-000000000003', '00000000-0000-4000-a000-000000000006', 'dbs',
     '00000000-0000-4000-a000-000000000006/dbs.pdf', null, 'pending', null, null);

insert into public.properties (id, customer_id, address_line1, town, postcode, bedrooms, bathrooms, pets, access_notes, key_code) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002',
     '12 Test Street', 'Workington', 'CA14 9ZZ', 3, 1, 'One friendly dog', 'Side gate, key in the safe', '4721'),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000003',
     '8 Sample Road', 'Whitehaven', 'CA28 9ZZ', 2, 1, null, 'Ring the bell', null);

-- Every booking is a block of 1 to 8 cleans; ends_on (the block's last clean) is set by a trigger.
insert into public.series (id, property_id, customer_id, cleaner_id, frequency, preferred_day, window_start, window_end,
                           duration_minutes, price_per_hour_pence, commission_type, commission_value, status, starts_on, claimed_at,
                           block_size, client_request_id) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002',
     '00000000-0000-4000-a000-000000000004', 'weekly', extract(isodow from (now() at time zone 'Europe/London')::date)::smallint, '09:00', '12:00', 150, 2000, 'percent', 2500,
     'claimed', (now() at time zone 'Europe/London')::date - 7, now() - interval '15 days',
     8, '00000000-0000-4000-9000-000000000001'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000003',
     null, 'fortnightly', 3, '10:00', '14:00', 120, 2000, 'percent', 2500,
     'offering', (now() at time zone 'Europe/London')::date + 7, null,
     4, '00000000-0000-4000-9000-000000000002');

insert into public.job_offers (series_id, cleaner_id, tier, opens_at, expires_at, status, responded_at) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000004', 'top',
     now() - interval '16 days', now() - interval '16 days' + interval '2 hours', 'claimed', now() - interval '15 days'),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-a000-000000000004', 'top',
     now() - interval '30 minutes', now() + interval '90 minutes', 'open', null);

-- Visits for Anna's block (her day is always "today's" weekday, so the dates line up):
-- clean 1 done and reviewed, clean 2 today, clean 3 next week; the nightly job books the rest.
insert into public.visits (id, series_id, customer_id, cleaner_id, scheduled_date, window_start, window_end, duration_minutes,
                           status, started_at, completed_at, price_pence, cleaner_earnings_pence, ping_fee_pence)
select v.id, '00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000004',
       v.d, '09:00', '12:00', 150, v.status::public.visit_status, v.started, v.completed,
       p.price_pence, p.cleaner_earnings_pence, p.ping_fee_pence
from (values
  ('00000000-0000-4000-e000-000000000001'::uuid, (now() at time zone 'Europe/London')::date - 7, 'completed', now() - interval '7 days', now() - interval '7 days' + interval '150 minutes'),
  ('00000000-0000-4000-e000-000000000002'::uuid, (now() at time zone 'Europe/London')::date,     'scheduled', null::timestamptz, null::timestamptz),
  ('00000000-0000-4000-e000-000000000003'::uuid, (now() at time zone 'Europe/London')::date + 7, 'scheduled', null, null)
) as v (id, d, status, started, completed)
cross join lateral private.split_visit_price(2000, 150, 'percent', 2500) as p;

insert into public.checklist_templates (id, name, is_default, items) values
  ('00000000-0000-4000-f000-000000000001', 'Standard regular clean', true, '[
    {"key":"kitchen.surfaces","room":"Kitchen","label":"Worktops, splashbacks and hob wiped and dried"},
    {"key":"kitchen.sink","room":"Kitchen","label":"Sink and taps cleaned and polished"},
    {"key":"kitchen.outside","room":"Kitchen","label":"Outside of appliances and cupboard fronts wiped"},
    {"key":"bathroom.wc","room":"Bathroom","label":"Toilet cleaned inside and out"},
    {"key":"bathroom.bath","room":"Bathroom","label":"Bath, shower and screen cleaned"},
    {"key":"bathroom.basin","room":"Bathroom","label":"Basin, taps and mirror polished"},
    {"key":"rooms.dust","room":"Living areas","label":"Reachable surfaces dusted"},
    {"key":"rooms.beds","room":"Bedrooms","label":"Beds made (linen changed if left out)"},
    {"key":"floors.hoover","room":"Whole home","label":"Carpets and rugs hoovered"},
    {"key":"floors.mop","room":"Whole home","label":"Hard floors mopped"},
    {"key":"bins.empty","room":"Whole home","label":"Bins emptied and bags replaced"}
  ]');

insert into public.checklist_items (visit_id, item_key, room, label, position, done)
select '00000000-0000-4000-e000-000000000001', i ->> 'key', i ->> 'room', i ->> 'label', (n - 1)::smallint, true
from public.checklist_templates t, jsonb_array_elements(t.items) with ordinality as x (i, n)
where t.is_default;

insert into public.visit_photos (visit_id, kind, room, storage_path, uploaded_by) values
  ('00000000-0000-4000-e000-000000000001', 'before', 'Kitchen', '00000000-0000-4000-e000-000000000001/kitchen-before.jpg', '00000000-0000-4000-a000-000000000004'),
  ('00000000-0000-4000-e000-000000000001', 'after',  'Kitchen', '00000000-0000-4000-e000-000000000001/kitchen-after.jpg',  '00000000-0000-4000-a000-000000000004');

insert into public.reviews (visit_id, customer_id, rating, comment) values
  ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-a000-000000000002', 5, 'Spotless. The kitchen hasn''t looked this good in years.');

insert into public.visit_qc (visit_id, score, notes, reviewed_by) values
  ('00000000-0000-4000-e000-000000000001', 9, 'Photos clear, checklist complete. Skirting in hall missed.', '00000000-0000-4000-a000-000000000001');

insert into public.payments (id, visit_id, customer_id, amount_pence, application_fee_pence, cleaner_amount_pence, status,
                             stripe_payment_intent_id, idempotency_key) values
  ('00000000-0000-4000-f000-000000000001', '00000000-0000-4000-e000-000000000001', '00000000-0000-4000-a000-000000000002',
   5000, 1250, 3750, 'succeeded', 'pi_test_seed_0001', 'visit:00000000-0000-4000-e000-000000000001:charge');

insert into public.payout_batches (id, cleaner_id, amount_pence, status, stripe_payout_id, idempotency_key, arrival_date) values
  ('00000000-0000-4000-f100-000000000001', '00000000-0000-4000-a000-000000000004', 3750, 'paid', 'po_test_seed_0001',
   'payout-batch:00000000-0000-4000-f100-000000000001', current_date - 5);

insert into public.payouts (visit_id, cleaner_id, payment_id, batch_id, amount_pence, status, available_after, stripe_payout_id, idempotency_key, paid_at) values
  ('00000000-0000-4000-e000-000000000001', '00000000-0000-4000-a000-000000000004', '00000000-0000-4000-f000-000000000001',
   '00000000-0000-4000-f100-000000000001', 3750, 'paid',
     now() - interval '5 days', 'po_test_seed_0001', 'visit:00000000-0000-4000-e000-000000000001:payout', now() - interval '5 days');

insert into public.messages (series_id, sender_id, body, created_at) values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000002', 'Hi Tara, could you do the oven door this week? Thank you!', now() - interval '2 days'),
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000004', 'No problem at all, see you Monday.', now() - interval '2 days' + interval '20 minutes');
