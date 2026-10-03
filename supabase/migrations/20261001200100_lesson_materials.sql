-- Lesson materials and homework from the tutor. A session's tutor adds slides,
-- handouts and links to the session; staff attach worksheets to an assignment;
-- an assignment can point back to the lesson it was set in. Everyone who can
-- see the student opens them; only staff add or remove them.

-- ---------------------------------------------------------------------------
-- Homework set in a lesson

alter table public.tasks
  add column session_id bigint references public.sessions (id) on delete set null;
create index tasks_session_idx on public.tasks (session_id) where session_id is not null;

grant insert (session_id) on public.tasks to authenticated;
grant update (session_id) on public.tasks to authenticated;

-- True when the caller may change this session: an admin, or its tutor while
-- still assigned to the student (the same rule as the sessions policies)
create function private.can_edit_session(p_session bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.sessions s
     where s.id = p_session
       and (private.is_admin()
            or (s.tutor_id = auth.uid() and private.tutors_student(auth.uid(), s.student_id))))
$$;
revoke execute on function private.can_edit_session(bigint) from public;
grant execute on function private.can_edit_session(bigint) to authenticated, service_role;

-- A task's lesson must be one of the same student's sessions
create function private.task_session_matches()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.session_id is not null and not exists (
    select 1 from public.sessions s where s.id = new.session_id and s.student_id = new.student_id
  ) then
    raise exception 'the lesson belongs to another student' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function private.task_session_matches() from public;

create trigger tasks_session_matches
  before insert or update of session_id, student_id on public.tasks
  for each row execute function private.task_session_matches();

-- ---------------------------------------------------------------------------
-- Materials: a file in the materials bucket or an https link, on one session
-- or one task

create table public.materials (
  id           bigint generated always as identity primary key,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  session_id   bigint references public.sessions (id) on delete cascade,
  task_id      bigint references public.tasks (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  storage_path text unique check (char_length(storage_path) <= 200),
  file_type    text check (file_type in (
                 'application/pdf',
                 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                 'application/vnd.ms-powerpoint',
                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                 'application/msword',
                 'image/png', 'image/jpeg')),
  size_bytes   integer check (size_bytes > 0),
  url          text check (char_length(url) <= 1000 and url ~ '^https://' and url !~ '\s'),
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint material_has_one_parent check (num_nonnulls(session_id, task_id) = 1),
  constraint material_is_file_or_link check ((storage_path is null) <> (url is null)),
  constraint material_file_is_described check (storage_path is null or (file_type is not null and size_bytes is not null))
);
create index materials_student_idx on public.materials (student_id);
create index materials_session_idx on public.materials (session_id) where session_id is not null;
create index materials_task_idx on public.materials (task_id) where task_id is not null;

-- The student is the session's or task's, and a file sits in that student's folder
create function private.material_matches()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.session_id is not null and not exists (
    select 1 from public.sessions s where s.id = new.session_id and s.student_id = new.student_id
  ) then
    raise exception 'the session belongs to another student' using errcode = '23514';
  end if;
  if new.task_id is not null and not exists (
    select 1 from public.tasks t where t.id = new.task_id and t.student_id = new.student_id
  ) then
    raise exception 'the assignment belongs to another student' using errcode = '23514';
  end if;
  if new.storage_path is not null and split_part(new.storage_path, '/', 1) <> new.student_id::text then
    raise exception 'the file is not in the student''s folder' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function private.material_matches() from public;

create trigger materials_match
  before insert on public.materials
  for each row execute function private.material_matches();

revoke all on public.materials from anon, authenticated;
grant all on public.materials to service_role;
grant select, delete on public.materials to authenticated;
grant insert (student_id, session_id, task_id, title, storage_path, file_type, size_bytes, url)
  on public.materials to authenticated;

alter table public.materials enable row level security;

create policy "read materials of viewable students" on public.materials
  for select to authenticated
  using (private.can_view_student(student_id));

-- A session's materials: its tutor or an admin. An assignment's: staff who
-- teach the student (the same people who can edit the assignment).
create policy "staff add materials" on public.materials
  for insert to authenticated
  with check (private.has_role(student_id, 'student')
              and ((session_id is not null and private.can_edit_session(session_id))
                   or (task_id is not null and private.can_teach(student_id))));

create policy "staff remove materials" on public.materials
  for delete to authenticated
  using ((session_id is not null and private.can_edit_session(session_id))
         or (task_id is not null and private.can_teach(student_id)));

-- ---------------------------------------------------------------------------
-- Storage: a private bucket, '<student uuid>/<uuid>.<ext>', 25 MB a file

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materials', 'materials', false, 26214400,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/vnd.ms-powerpoint',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/msword',
              'image/png', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- True when the caller teaches the student whose folder holds the file
create function private.can_teach_student_folder(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  folder text := split_part(p_name, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.can_teach(folder::uuid);
end;
$$;
revoke execute on function private.can_teach_student_folder(text) from public;
grant execute on function private.can_teach_student_folder(text) to authenticated, service_role;

create policy "materials: staff upload into a student's folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'materials'
              and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|pptx|ppt|docx|doc|png|jpg)$'
              and private.can_teach_student_folder(name));

create policy "materials: read files of viewable students" on storage.objects
  for select to authenticated
  using (bucket_id = 'materials' and private.can_view_student_folder(name));

-- Only files no material row uses: a file in use goes when its row does (the
-- row's own rules decide who may remove it), so nobody leaves a dead link
create policy "materials: staff remove unused files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'materials'
         and private.can_teach_student_folder(name)
         and not exists (select 1 from public.materials m where m.storage_path = objects.name));
-- No update policy: a file is never overwritten (uploads use upsert: false).
