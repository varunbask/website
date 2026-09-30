-- Client portal schema: four roles, tasks, submissions, grades, updates.
-- Access control lives here: RLS on every table, column grants on every write.

-- Types
create type public.app_role as enum ('pending', 'student', 'parent', 'tutor', 'admin');
create type public.task_kind as enum ('assignment', 'task');
create type public.submission_status as enum ('pending', 'grading', 'ai_graded', 'failed');

-- Helpers live in a schema the Data API does not expose, so they cannot be called as RPCs
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role, supabase_auth_admin;

-- Tables
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text,                                   -- snapshot at sign-up, for the admin
  full_name      text not null default '' check (char_length(full_name) <= 120),
  role           public.app_role not null default 'pending',
  requested_role public.app_role check (requested_role in ('student', 'parent', 'tutor')),
  signup_note    text check (char_length(signup_note) <= 500),
  created_at     timestamptz not null default now()
);

create table public.tutor_students (
  tutor_id   uuid not null references public.profiles (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tutor_id, student_id)
);
create index tutor_students_student_idx on public.tutor_students (student_id);

create table public.parent_students (
  parent_id  uuid not null references public.profiles (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id)
);
create index parent_students_student_idx on public.parent_students (student_id);

create table public.tasks (
  id           bigint generated always as identity primary key,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  kind         public.task_kind not null default 'task',
  title        text not null check (char_length(title) between 1 and 200),
  details      text check (char_length(details) <= 5000),
  due_at       timestamptz,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index tasks_student_due_idx on public.tasks (student_id, due_at);

create table public.submissions (
  id                bigint generated always as identity primary key,  -- integer ids keep RESULTS_FORMAT unchanged
  student_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  task_id           bigint not null references public.tasks (id),     -- no cascade: an assignment with work cannot be deleted
  storage_path      text not null unique check (char_length(storage_path) <= 200),
  file_type         text not null check (file_type in ('application/pdf', 'image/png', 'image/jpeg', 'text/plain')),
  note              text check (char_length(note) <= 1000),
  status            public.submission_status not null default 'pending',
  attempts          smallint not null default 0,
  error             text,                                             -- user-safe text only
  status_changed_at timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create index submissions_student_idx on public.submissions (student_id, created_at desc);
create index submissions_task_idx on public.submissions (task_id);
create index submissions_queue_idx on public.submissions (status_changed_at) where status in ('pending', 'grading');

create table public.grades (
  submission_id bigint primary key references public.submissions (id) on delete cascade,
  student_id    uuid not null references public.profiles (id) on delete cascade,  -- set by trigger, never granted
  score         numeric(5, 2) check (score between 0 and 100),
  feedback      text check (char_length(feedback) <= 10000),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,             -- null while it is an untouched AI draft
  released_at   timestamptz,             -- null = hidden from the student and parents
  constraint released_grade_is_complete check (released_at is null or (score is not null and feedback is not null))
);
create index grades_student_idx on public.grades (student_id);

create table public.updates (
  id                 bigint generated always as identity primary key,
  student_id         uuid not null references public.profiles (id) on delete cascade,
  author_id          uuid default auth.uid() references public.profiles (id) on delete set null,
  body               text not null check (char_length(body) between 1 and 10000),
  visible_to_student boolean not null default false,
  created_at         timestamptz not null default now()
);
create index updates_student_idx on public.updates (student_id, created_at desc);

-- Helper functions (security definer, empty search_path, fully qualified names)
create function private.my_role()
returns public.app_role
language sql stable security definer set search_path = ''
as $$ select p.role from public.profiles p where p.id = auth.uid() $$;

create function private.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role() = 'admin', false) $$;

create function private.has_role(p_user uuid, p_role public.app_role)
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles p where p.id = p_user and p.role = p_role) $$;

create function private.can_teach(p_student uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case private.my_role()
    when 'admin' then true
    when 'tutor' then exists (select 1 from public.tutor_students ts
                              where ts.tutor_id = auth.uid() and ts.student_id = p_student)
    else false
  end
$$;

create function private.can_view_student(p_student uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case private.my_role()
    when 'admin'   then true
    when 'tutor'   then exists (select 1 from public.tutor_students ts
                                where ts.tutor_id = auth.uid() and ts.student_id = p_student)
    when 'parent'  then exists (select 1 from public.parent_students ps
                                where ps.parent_id = auth.uid() and ps.student_id = p_student)
    when 'student' then coalesce(p_student = auth.uid(), false)
    else false
  end
$$;

-- Storage names are '<uuid>/<uuid>.<ext>'; never cast arbitrary text to uuid inside a policy
create function private.can_view_student_folder(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  folder text := split_part(p_name, '/', 1);
begin
  if folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.can_view_student(folder::uuid);
end;
$$;

-- Everything a student's submission insert must satisfy
create function private.can_submit(p_task_id bigint, p_path text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.my_role() = 'student', false)
     and p_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpg|txt)$'
     and split_part(p_path, '/', 1) = auth.uid()::text
     and exists (select 1 from public.tasks t
                 where t.id = p_task_id and t.student_id = auth.uid() and t.kind = 'assignment')
     and exists (select 1 from storage.objects o
                 where o.bucket_id = 'homework' and o.name = p_path)
     and (select count(*) from public.submissions s
          where s.task_id = p_task_id and s.student_id = auth.uid()) < 5
$$;

-- Triggers
create function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  meta   jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  wanted text  := meta ->> 'requested_role';
begin
  -- role always starts as 'pending'; metadata is user-controlled and only a hint for the admin
  insert into public.profiles (id, email, full_name, requested_role, signup_note)
  values (
    new.id,
    new.email,
    left(coalesce(btrim(meta ->> 'full_name'), ''), 120),
    case when wanted in ('student', 'parent', 'tutor') then wanted::public.app_role end,
    left(nullif(btrim(meta ->> 'signup_note'), ''), 500)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.on_submission_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.grades (submission_id, student_id) values (new.id, new.student_id);
  update public.tasks set completed_at = new.created_at
   where id = new.task_id and completed_at is null;
  return null;
end;
$$;

create trigger submissions_after_insert
  after insert on public.submissions
  for each row execute function private.on_submission_created();

create function private.stamp_grade_review()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null then          -- a person edited it; the grader (service role) has no uid
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

create trigger grades_before_update
  before update on public.grades
  for each row execute function private.stamp_grade_review();

revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;
grant execute on function private.handle_new_user() to supabase_auth_admin;

-- Client-callable RPCs
create function public.set_task_done(p_task_id bigint, p_done boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.tasks t
     set completed_at = case when p_done then coalesce(t.completed_at, now()) end
   where t.id = p_task_id
     and t.kind = 'task'
     and t.student_id = auth.uid()
     and private.my_role() = 'student';
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.set_task_done(bigint, boolean) from public, anon;
grant execute on function public.set_task_done(bigint, boolean) to authenticated;

-- Names only (no emails) of tutors and admins, for "from <tutor>" labels
create function public.staff_names()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.full_name from public.profiles p
   where p.role in ('tutor', 'admin') and private.my_role() <> 'pending'
$$;
revoke execute on function public.staff_names() from public, anon;
grant execute on function public.staff_names() to authenticated;

-- Privileges: start from nothing, grant exactly what the policies need
revoke all on public.profiles, public.tutor_students, public.parent_students,
              public.tasks, public.submissions, public.grades, public.updates
  from anon, authenticated;
grant all on public.profiles, public.tutor_students, public.parent_students,
             public.tasks, public.submissions, public.grades, public.updates
  to service_role;

grant select                                              on public.profiles        to authenticated;
grant update (full_name, role)                            on public.profiles        to authenticated;
grant select, insert, delete                              on public.tutor_students  to authenticated;
grant select, insert, delete                              on public.parent_students to authenticated;
grant select, delete                                      on public.tasks           to authenticated;
grant insert (student_id, kind, title, details, due_at)   on public.tasks           to authenticated;
grant update (kind, title, details, due_at, completed_at) on public.tasks           to authenticated;
grant select                                              on public.submissions     to authenticated;
grant insert (task_id, storage_path, file_type, note)     on public.submissions     to authenticated;
grant select                                              on public.grades          to authenticated;
grant update (score, feedback, released_at)               on public.grades          to authenticated;
grant select, delete                                      on public.updates         to authenticated;
grant insert (student_id, body, visible_to_student)       on public.updates         to authenticated;
grant update (body, visible_to_student)                   on public.updates         to authenticated;

-- RLS on every table
alter table public.profiles        enable row level security;
alter table public.tutor_students  enable row level security;
alter table public.parent_students enable row level security;
alter table public.tasks           enable row level security;
alter table public.submissions     enable row level security;
alter table public.grades          enable row level security;
alter table public.updates         enable row level security;

-- profiles: pending users see only themselves; nobody but an admin changes roles
create policy "read own profile or viewable students" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.can_view_student(id));
create policy "admin edits profiles, cannot demote self" on public.profiles
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()) and (id <> (select auth.uid()) or role = 'admin'));
-- no insert policy (the trigger creates rows) and no delete policy (cascade from auth.users)

-- tutor_students
create policy "admin or own tutor links" on public.tutor_students
  for select to authenticated
  using ((select private.is_admin()) or tutor_id = (select auth.uid()));
create policy "admin links tutor to student" on public.tutor_students
  for insert to authenticated
  with check ((select private.is_admin())
              and private.has_role(tutor_id, 'tutor') and private.has_role(student_id, 'student'));
create policy "admin unlinks tutor" on public.tutor_students
  for delete to authenticated using ((select private.is_admin()));

-- parent_students
create policy "admin or own parent links" on public.parent_students
  for select to authenticated
  using ((select private.is_admin()) or parent_id = (select auth.uid()));
create policy "admin links parent to student" on public.parent_students
  for insert to authenticated
  with check ((select private.is_admin())
              and private.has_role(parent_id, 'parent') and private.has_role(student_id, 'student'));
create policy "admin unlinks parent" on public.parent_students
  for delete to authenticated using ((select private.is_admin()));

-- tasks
create policy "read tasks of viewable students" on public.tasks
  for select to authenticated using (private.can_view_student(student_id));
create policy "staff create tasks" on public.tasks
  for insert to authenticated
  with check (private.can_teach(student_id) and private.has_role(student_id, 'student'));
create policy "staff edit tasks" on public.tasks
  for update to authenticated
  using (private.can_teach(student_id)) with check (private.can_teach(student_id));
create policy "staff delete tasks" on public.tasks
  for delete to authenticated using (private.can_teach(student_id));

-- submissions: students insert their own; only the grader (service role) changes them
create policy "read submissions of viewable students" on public.submissions
  for select to authenticated using (private.can_view_student(student_id));
create policy "students submit their own work" on public.submissions
  for insert to authenticated
  with check (student_id = (select auth.uid())
              and status = 'pending'
              and private.can_submit(task_id, storage_path));

-- grades: staff see drafts; students and parents only released rows
create policy "staff read all, family reads released" on public.grades
  for select to authenticated
  using (private.can_teach(student_id)
         or (released_at is not null and private.can_view_student(student_id)));
create policy "staff review grades" on public.grades
  for update to authenticated
  using (private.can_teach(student_id)) with check (private.can_teach(student_id));

-- updates
create policy "staff and parents read; students read shared" on public.updates
  for select to authenticated
  using (private.can_teach(student_id)
         or ((select private.my_role()) = 'parent' and private.can_view_student(student_id))
         or (visible_to_student and student_id = (select auth.uid())
             and (select private.my_role()) = 'student'));
create policy "staff post updates" on public.updates
  for insert to authenticated
  with check (private.can_teach(student_id) and private.has_role(student_id, 'student'));
create policy "author or admin edits updates" on public.updates
  for update to authenticated
  using ((select private.is_admin()) or (author_id = (select auth.uid()) and private.can_teach(student_id)))
  with check (private.can_teach(student_id));
create policy "author or admin deletes updates" on public.updates
  for delete to authenticated
  using ((select private.is_admin()) or (author_id = (select auth.uid()) and private.can_teach(student_id)));
