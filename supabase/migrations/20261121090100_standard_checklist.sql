-- Ping Clean: the standard regular-clean checklist, in the database itself.
--
-- Until now the checklist only existed in the test seed. On the live database (no seed)
-- there was no default template, so a cleaner tapping "Start" got PC015 "No checklist has
-- been set up yet", and with no checklist no clean could be completed or charged. There is
-- no screen for adding one, so it has to arrive with the schema.
--
-- The eleven items are the ones the site promises customers (app/(site)/_content/checklist.ts,
-- kept in step by app/(site)/_content/checklist.test.ts). Inserted only if no default exists,
-- so a database that already has one keeps its own. One row of reference data: no table,
-- column, policy or grant changes.

insert into public.checklist_templates (name, is_default, items)
select 'Standard regular clean', true, '[
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
  ]'::jsonb
where not exists (select 1 from public.checklist_templates where is_default);
