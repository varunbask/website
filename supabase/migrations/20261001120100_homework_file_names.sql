-- Limit student uploads to the one name shape that a submission can use:
-- '<own uuid>/<uuid>.<ext>'. A file with any other name could never be submitted.
alter policy "homework: students upload into their own folder" on storage.objects
  with check (bucket_id = 'homework'
              and name ~ ('^' || (select auth.uid())::text
                          || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|txt)$')
              and (select private.my_role()) = 'student');

-- Homework files that no submission uses, oldest first. The sweep removes them.
-- A file stays until p_before, so an upload has time to get its submission row.
-- A deleted account removes its submissions, so this also finds that account's files.
create function public.orphan_homework_files(p_before timestamptz, p_limit int)
returns setof text
language sql stable security definer set search_path = ''
as $$
  select o.name from storage.objects o
   where o.bucket_id = 'homework'
     and o.created_at < p_before
     and not exists (select 1 from public.submissions s where s.storage_path = o.name)
   order by o.created_at
   limit p_limit
$$;
revoke execute on function public.orphan_homework_files(timestamptz, int) from public, anon, authenticated;
grant execute on function public.orphan_homework_files(timestamptz, int) to service_role;
