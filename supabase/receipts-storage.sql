-- Run once in the SQL editor of your NEW Supabase project (receipts only; no tables needed).
-- Public bucket (images load via plain URLs), 5 MB limit, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', true, 5242880, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic'];

-- Upload-only for the anon key. No SELECT/UPDATE/DELETE policy means nobody can list, overwrite or delete files.
-- Files are reachable only through their unguessable URL (random UUID path).
drop policy if exists "receipts_insert_only" on storage.objects;
create policy "receipts_insert_only" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'receipts');
