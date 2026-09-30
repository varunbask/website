-- Private bucket for homework files. Paths are '<student uuid>/<uuid>.<ext>'.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('homework', 'homework', false, 20971520,
        array['application/pdf', 'image/png', 'image/jpeg', 'text/plain'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "homework: students upload into their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'homework'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select private.my_role()) = 'student');

create policy "homework: read files of viewable students" on storage.objects
  for select to authenticated
  using (bucket_id = 'homework' and private.can_view_student_folder(name));

-- No update policy: an uploaded file can never be overwritten (uploads use upsert: false).
-- No delete policy: only the service role removes files.
