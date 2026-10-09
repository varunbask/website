-- Homework drafted from lesson photos, and answer keys that only staff see.
--
-- A tutor (or the admin) uploads photos of what they worked on in a lesson
-- and asks for a homework draft. The server sends the photos to the AI
-- service in the background and keeps the draft here until the tutor opens
-- it. The photos themselves are never stored: they stay in the server's
-- memory for the one request. The tutor reads the draft, edits it, and saves
-- it as an ordinary assignment.
--
-- task_answer_keys   one answer key per assignment, written by the staff who
--                    teach the student (and the admin). Students and parents
--                    can never read it: every policy asks
--                    private.can_teach_task(), which is false for them. The
--                    grader reads it with the service role, to check work
--                    against it, and never shows it to the student. It goes
--                    when its assignment is deleted.
-- homework_drafts    one row per draft request: who asked, for which student,
--                    the options (count, difficulty, hints, notes, subject,
--                    grade; never the photos), and the finished draft or a
--                    short error. Only the server (service role) adds or
--                    changes rows. The person who asked reads their own rows
--                    and may delete them; the admin reads every row. The
--                    server also counts these rows for the daily limit (30
--                    drafts per person in any 24 hours).
-- tasks.details      may now hold 12000 characters (it held 5000): a drafted
--                    assignment is a structured problem set, with a warm-up,
--                    a worked example, practice, application, a challenge
--                    and reflection, its math written in LaTeX.

create table public.task_answer_keys (
  task_id    bigint primary key references public.tasks (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 20000),
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.homework_drafts (
  id          bigint generated always as identity primary key,
  created_by  uuid default auth.uid() references public.profiles (id) on delete cascade,
  student_id  uuid references public.profiles (id) on delete cascade,
  status      text not null default 'drafting' check (status in ('drafting', 'ready', 'failed')),
  options     jsonb not null default '{}'::jsonb,
  result      jsonb,
  error       text check (char_length(error) <= 500),
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index homework_drafts_creator_idx on public.homework_drafts (created_by, created_at desc);
create index homework_drafts_student_idx on public.homework_drafts (student_id);

-- Whether the signed-in person teaches the student an assignment belongs to
-- (the admin always does). False for a missing task, students and parents.
create function private.can_teach_task(p_task bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select private.can_teach(t.student_id) from public.tasks t where t.id = p_task), false)
$$;
revoke execute on function private.can_teach_task(bigint) from public;
grant execute on function private.can_teach_task(bigint) to authenticated, service_role;

-- An edit stamps who made it and when; neither is ever sent by the client.
-- The service role has no uid, so a server write leaves updated_by as it was.
create function private.answer_key_touch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end
$$;
revoke execute on function private.answer_key_touch() from public;
create trigger task_answer_keys_touch before insert or update on public.task_answer_keys
  for each row execute function private.answer_key_touch();

-- Privileges: start from nothing, grant exactly what the policies need
revoke all on public.task_answer_keys, public.homework_drafts from anon, authenticated;
grant all on public.task_answer_keys, public.homework_drafts to service_role;
grant select, delete on public.task_answer_keys to authenticated;
grant insert (task_id, body) on public.task_answer_keys to authenticated;
grant update (body) on public.task_answer_keys to authenticated;
grant select, delete on public.homework_drafts to authenticated;

alter table public.task_answer_keys enable row level security;
alter table public.homework_drafts  enable row level security;

-- task_answer_keys: the staff who teach the student, and the admin
create policy "staff read answer keys" on public.task_answer_keys
  for select to authenticated
  using (private.can_teach_task(task_id));
create policy "staff add answer keys" on public.task_answer_keys
  for insert to authenticated
  with check (private.can_teach_task(task_id));
create policy "staff edit answer keys" on public.task_answer_keys
  for update to authenticated
  using (private.can_teach_task(task_id)) with check (private.can_teach_task(task_id));
create policy "staff remove answer keys" on public.task_answer_keys
  for delete to authenticated
  using (private.can_teach_task(task_id));

-- homework_drafts: the person who asked, and the admin, read; the person who
-- asked deletes. No insert or update policy: only the server writes.
create policy "read own drafts, the admin all" on public.homework_drafts
  for select to authenticated
  using (created_by = (select auth.uid()) or (select private.is_admin()));
create policy "delete own drafts" on public.homework_drafts
  for delete to authenticated
  using (created_by = (select auth.uid()));

-- Room for a structured problem set in an assignment's instructions
alter table public.tasks drop constraint tasks_details_check;
alter table public.tasks add constraint tasks_details_check check (char_length(details) <= 12000);
