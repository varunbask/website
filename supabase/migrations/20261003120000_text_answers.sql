-- Typed answers. A student's answer to an assignment is text first; a file
-- (PDF, photo or text file) is optional. A submission needs at least one of
-- the two. Staff attach worksheets and screenshots to assignments with the
-- existing materials table, so nothing changes there.

alter table public.submissions
  add column body text check (body is null or (char_length(body) <= 20000 and btrim(body) <> ''));

alter table public.submissions
  alter column storage_path drop not null,
  alter column file_type drop not null,
  add constraint submission_has_work check (body is not null or storage_path is not null),
  add constraint submission_file_is_described check ((storage_path is null) = (file_type is null));

grant insert (body) on public.submissions to authenticated;

-- Everything a student's submission insert must satisfy. The file checks
-- apply only when a file is attached (p_path is not null); the row's own
-- constraints make sure there is an answer or a file.
create or replace function private.can_submit(p_task_id bigint, p_path text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.my_role() = 'student', false)
     and (p_path is null or (
           p_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg|txt)$'
           and split_part(p_path, '/', 1) = auth.uid()::text
           and exists (select 1 from storage.objects o
                       where o.bucket_id = 'homework' and o.name = p_path)))
     and exists (select 1 from public.tasks t
                 where t.id = p_task_id and t.student_id = auth.uid() and t.kind = 'assignment')
     and (select count(*) from public.submissions s
          where s.task_id = p_task_id and s.student_id = auth.uid()) < 5
$$;
revoke execute on function private.can_submit(bigint, text) from public;
grant execute on function private.can_submit(bigint, text) to authenticated, service_role;
