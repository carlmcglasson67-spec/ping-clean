-- Ping Clean V1 — 7/7 Private file buckets.
--   cleaner-documents/<cleaner_id>/<file>  DBS, ID, insurance, right to work
--   visit-photos/<visit_id>/<file>         before and after photos
-- Both private: files are served through short-lived signed URLs only (10 minutes,
-- see ping-data-security rule 4). Access mirrors the table policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('cleaner-documents', 'cleaner-documents', false, 10485760,
     array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp']),
  ('visit-photos', 'visit-photos', false, 8388608,
     array['image/jpeg', 'image/png', 'image/heic', 'image/webp'])
on conflict (id) do nothing;

create policy "documents: owner uploads" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cleaner-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.cleaners c where c.id = (select auth.uid()) and c.status in ('applicant', 'active'))
  );

create policy "documents: owner and admin read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cleaner-documents'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or (select private.is_admin()))
  );

create policy "photos: cleaner uploads during visit" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'visit-photos'
    and exists (
      select 1 from public.visits v
      where v.id::text = (storage.foldername(name))[1]
        and v.cleaner_id = (select auth.uid())
        and v.status = 'in_progress'
    )
  );

create policy "photos: visit participants read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'visit-photos'
    and exists (
      select 1 from public.visits v
      where v.id::text = (storage.foldername(name))[1]
        and (v.customer_id = (select auth.uid()) or v.cleaner_id = (select auth.uid()) or (select private.is_admin()))
    )
  );
