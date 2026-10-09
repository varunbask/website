-- Lesson files for homework drafts, and the stage a draft is at.
--
-- A tutor (or the admin) drafts homework from a lesson's materials: photos,
-- PDFs, Word, PowerPoint, Excel, OpenDocument and text files. They are too
-- large for a request body, so the browser uploads them to this private
-- bucket first, under the tutor's own folder:
--   draft-sources/<their id>/<draft key>/<n>-<file name>
-- and sends the paths with the draft request. The server (service role)
-- checks every path is in the caller's folder, reads the files for the one
-- draft, and deletes them when the draft is done, ready or failed. Anything
-- left (a draft that never started) is deleted by the daily sweep after a
-- day, through old_draft_sources(). A file the tutor attaches to the
-- assignment is uploaded to the materials bucket separately, as before.
--
-- Who may touch the bucket: tutors and the admin, each in their own folder
-- only (add, read, delete). No update: a file is never overwritten. Students
-- and parents cannot use it at all. A folder holds at most 50 files, so
-- nobody can fill the bucket.
--
-- homework_drafts.stage: 'reading' while the server reads a draft's files,
-- then 'drafting' while the model writes it (null on rows from before). Only
-- the server writes it; the person who asked reads it with the row.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('draft-sources', 'draft-sources', false, 26214400, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/plain', 'text/markdown', 'text/csv', 'text/html',
  'application/rtf', 'text/rtf'
])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The folder must look like a uuid before it is cast, so a malformed name is
-- simply not allowed instead of an error inside the policy. A name with no
-- such folder belongs to nobody.
create function private.draft_source_owner(p_name text)
returns uuid
language plpgsql immutable set search_path = ''
as $$
declare
  folder text := (storage.foldername(p_name))[1];
begin
  if folder is null or folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return folder::uuid;
end;
$$;
revoke execute on function private.draft_source_owner(text) from public;

-- The signed-in tutor or admin, in their own folder
create function private.can_use_draft_source(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    private.draft_source_owner(p_name) = auth.uid()
      and private.my_role() in ('tutor', 'admin'),
    false)
$$;
revoke execute on function private.can_use_draft_source(text) from public;
grant execute on function private.can_use_draft_source(text) to authenticated;

-- Whether the folder already holds 50 files (counted past the read policy)
create function private.draft_sources_full(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select count(*) from storage.objects o
           where o.bucket_id = 'draft-sources'
             and split_part(o.name, '/', 1) = split_part(p_name, '/', 1)) >= 50
$$;
revoke execute on function private.draft_sources_full(text) from public;
grant execute on function private.draft_sources_full(text) to authenticated;

create policy "draft-sources: staff add files to their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'draft-sources'
              and char_length(name) <= 260
              and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}/[0-9]{1,2}-[A-Za-z0-9._-]{1,100}$'
              and private.can_use_draft_source(name)
              and not private.draft_sources_full(name));

create policy "draft-sources: staff read their own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'draft-sources' and private.can_use_draft_source(name));

create policy "draft-sources: staff remove their own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'draft-sources' and private.can_use_draft_source(name));

-- No update policy: a file is never overwritten, a new draft gets a new folder.

-- The sweep: files older than a time, oldest first (the server deletes them)
create function public.old_draft_sources(p_before timestamptz, p_limit int)
returns setof text
language sql stable security definer set search_path = ''
as $$
  select o.name from storage.objects o
   where o.bucket_id = 'draft-sources'
     and o.created_at < p_before
   order by o.created_at
   limit greatest(0, least(p_limit, 1000))
$$;
revoke execute on function public.old_draft_sources(timestamptz, int) from public, anon, authenticated;
grant execute on function public.old_draft_sources(timestamptz, int) to service_role;

-- The stage of a draft that is still running
alter table public.homework_drafts
  add column stage text check (stage in ('reading', 'drafting'));
