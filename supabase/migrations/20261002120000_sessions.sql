-- Tutoring sessions on the calendar. A student may have several tutors, one
-- subject each. A tutor schedules, moves, cancels and deletes their own
-- sessions and writes the recap afterwards (an admin may do it for any tutor);
-- students and parents only see them. Other tutors of the same student see
-- them too, so nobody double-books.

-- What a tutor teaches a student ("Algebra", "SAT Reading")
alter table public.tutor_students
  add column subject text check (char_length(subject) <= 60);

grant update (subject) on public.tutor_students to authenticated;
create policy "admin edits tutor links" on public.tutor_students
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create type public.session_status as enum ('scheduled', 'cancelled');

create table public.sessions (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references public.profiles (id) on delete cascade,
  tutor_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  series_id   uuid,                         -- weekly repeats share one series
  subject     text check (char_length(subject) <= 60),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  location    text check (char_length(location) <= 200),
  meeting_url text check (char_length(meeting_url) <= 500 and meeting_url ~ '^https://'),
  notes       text check (char_length(notes) <= 2000),     -- the plan, before the session
  status      public.session_status not null default 'scheduled',
  attendance  text check (attendance in ('present', 'late', 'absent')),
  recap       text check (char_length(recap) <= 4000),     -- after: what was covered, next steps
  moved_from  timestamptz,                  -- the start before the latest move, set by trigger
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint session_length check (ends_at > starts_at and ends_at <= starts_at + interval '8 hours')
);
create index sessions_student_idx on public.sessions (student_id, starts_at);
create index sessions_tutor_idx on public.sessions (tutor_id, starts_at);
create index sessions_series_idx on public.sessions (series_id) where series_id is not null;

-- True when p_tutor is assigned to p_student
create function private.tutors_student(p_tutor uuid, p_student uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.tutor_students ts
                  where ts.tutor_id = p_tutor and ts.student_id = p_student)
$$;
revoke execute on function private.tutors_student(uuid, uuid) from public;
grant execute on function private.tutors_student(uuid, uuid) to authenticated, service_role;

-- A move keeps the previous start, so families can see what changed
create function private.session_touch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.starts_at is distinct from old.starts_at then
    new.moved_from := old.starts_at;
  end if;
  return new;
end
$$;
revoke execute on function private.session_touch() from public;

create trigger sessions_touch
  before update on public.sessions
  for each row execute function private.session_touch();

-- Privileges: tutor_id and student_id are fixed once a session exists
revoke all on public.sessions from anon, authenticated;
grant all on public.sessions to service_role;
grant select, delete on public.sessions to authenticated;
grant insert (student_id, tutor_id, series_id, subject, starts_at, ends_at, location, meeting_url, notes)
  on public.sessions to authenticated;
grant update (subject, starts_at, ends_at, location, meeting_url, notes, status, attendance, recap)
  on public.sessions to authenticated;

alter table public.sessions enable row level security;

-- Everyone who can see the student sees the student's sessions (all of their
-- tutors included); a tutor also keeps seeing their own after an unlink
create policy "read sessions of viewable students" on public.sessions
  for select to authenticated
  using (private.can_view_student(student_id) or tutor_id = (select auth.uid()));

-- A tutor books their own sessions with their own students; an admin books for
-- any tutor assigned to that student
create policy "tutors schedule sessions" on public.sessions
  for insert to authenticated
  with check (private.has_role(student_id, 'student')
              and private.tutors_student(tutor_id, student_id)
              and (tutor_id = (select auth.uid()) or (select private.is_admin())));

create policy "tutor or admin changes sessions" on public.sessions
  for update to authenticated
  using ((select private.is_admin())
         or (tutor_id = (select auth.uid()) and private.tutors_student((select auth.uid()), student_id)))
  with check ((select private.is_admin())
              or (tutor_id = (select auth.uid()) and private.tutors_student((select auth.uid()), student_id)));

create policy "tutor or admin deletes sessions" on public.sessions
  for delete to authenticated
  using ((select private.is_admin())
         or (tutor_id = (select auth.uid()) and private.tutors_student((select auth.uid()), student_id)));

-- A student's tutors and their subjects, for anyone who can see the student
-- ("Your tutors" for students and parents, who cannot read tutor_students)
create function public.student_tutors(p_student uuid)
returns table (tutor_id uuid, full_name text, subject text)
language sql stable security definer set search_path = ''
as $$
  select ts.tutor_id, p.full_name, ts.subject
    from public.tutor_students ts
    join public.profiles p on p.id = ts.tutor_id
   where ts.student_id = p_student
     and private.can_view_student(p_student)
   order by p.full_name
$$;
revoke execute on function public.student_tutors(uuid) from public, anon;
grant execute on function public.student_tutors(uuid) to authenticated;
