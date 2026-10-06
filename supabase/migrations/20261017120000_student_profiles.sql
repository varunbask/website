-- Who is this student? A small profile per student (grade, school, goals,
-- what works in a lesson), private notes the tutors keep for each other, and a
-- way for tutors to reach a student's parents.
--
-- student_profiles   one row per student, staff only: the staff who teach the
--                    student (and the admin) read and write the table. Families
--                    never read it directly, because learning_notes (what works,
--                    accommodations) is for tutors.
-- family_profile(student)
--                    what the family may see of that row: grade, school and
--                    goals, for the student, their parents and staff. Never
--                    learning_notes, updated_by or updated_at.
-- student_notes      private to staff: tutors who teach the student and the
--                    admin read and add them; families never see them. The
--                    author or the admin deletes one. Notes are not edited.
-- staff_parent_contacts(student)
--                    name, email and phone of the student's parents, for staff
--                    who teach the student. A placeholder address (a person
--                    added without a login) comes back as null, and the phone is
--                    the one the admin keeps in billing_contacts, which tutors
--                    cannot read otherwise.

create table public.student_profiles (
  student_id     uuid primary key references public.profiles (id) on delete cascade,
  grade_level    text check (char_length(grade_level) <= 40),
  school         text check (char_length(school) <= 120),
  goals          text check (char_length(goals) <= 1000),
  learning_notes text check (char_length(learning_notes) <= 1000),   -- accommodations, what works
  updated_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now()
);

create table public.student_notes (
  id         bigint generated always as identity primary key,
  student_id uuid not null references public.profiles (id) on delete cascade,
  author_id  uuid default auth.uid() references public.profiles (id) on delete set null,
  body       text not null check (body ~ '\S' and char_length(body) <= 2000),   -- not empty, not only blanks
  created_at timestamptz not null default now()
);
create index student_notes_student_idx on public.student_notes (student_id, created_at desc);

-- An edit stamps who made it and when; neither is ever sent by the client
create function private.student_profile_touch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end
$$;
revoke execute on function private.student_profile_touch() from public;
create trigger student_profiles_touch before update on public.student_profiles
  for each row execute function private.student_profile_touch();

-- Privileges: start from nothing, grant exactly what the policies need.
-- Nobody deletes a profile (it goes with the student); notes are never edited.
revoke all on public.student_profiles, public.student_notes from anon, authenticated;
grant all on public.student_profiles, public.student_notes to service_role;
grant select on public.student_profiles to authenticated;
grant insert (student_id, grade_level, school, goals, learning_notes) on public.student_profiles to authenticated;
grant update (grade_level, school, goals, learning_notes) on public.student_profiles to authenticated;
grant select, delete on public.student_notes to authenticated;
grant insert (student_id, body) on public.student_notes to authenticated;

alter table public.student_profiles enable row level security;
alter table public.student_notes    enable row level security;

-- student_profiles: staff who teach the student (and the admin) read and write
-- it. Families read grade, school and goals only through family_profile() below.
create policy "staff read a student profile" on public.student_profiles
  for select to authenticated
  using (private.can_teach(student_id));
create policy "staff add a student profile" on public.student_profiles
  for insert to authenticated
  with check (private.can_teach(student_id) and private.has_role(student_id, 'student'));
create policy "staff edit a student profile" on public.student_profiles
  for update to authenticated
  using (private.can_teach(student_id)) with check (private.can_teach(student_id));

-- student_notes: staff only, shared among the student's tutors
create policy "staff read notes" on public.student_notes
  for select to authenticated
  using (private.can_teach(student_id));
create policy "staff add notes" on public.student_notes
  for insert to authenticated
  with check (private.can_teach(student_id) and private.has_role(student_id, 'student')
              and author_id = (select auth.uid()));
create policy "author or admin removes notes" on public.student_notes
  for delete to authenticated
  using ((select private.is_admin())
         or (author_id = (select auth.uid()) and private.can_teach(student_id)));

-- Parents of a student, for the staff who teach them. The profiles policy lets a
-- tutor read only students, so this is how a tutor learns a parent's name and
-- address; billing_contacts is admin only, so this is how they get the phone.
create function public.staff_parent_contacts(p_student uuid)
returns table (parent_id uuid, full_name text, email text, phone text)
language sql stable security definer set search_path = ''
as $$
  select p.id,
         p.full_name,
         case when lower(p.email) like '%@people.varunbaskaran.com' then null else p.email end,
         nullif(btrim(bc.phone), '')
    from public.parent_students ps
    join public.profiles p on p.id = ps.parent_id
    left join public.billing_contacts bc on bc.parent_id = p.id
   where ps.student_id = p_student
     and private.can_teach(p_student)
   order by p.full_name, p.id
$$;
revoke execute on function public.staff_parent_contacts(uuid) from public, anon;
grant execute on function public.staff_parent_contacts(uuid) to authenticated;

-- The family's view of the profile: the student, their parents and staff get
-- grade, school and goals (shared with the family on purpose), and nothing else.
-- No row, or someone who may not see the student, gets no rows.
create function public.family_profile(p_student uuid)
returns table (grade_level text, school text, goals text)
language sql stable security definer set search_path = ''
as $$
  select sp.grade_level, sp.school, sp.goals
    from public.student_profiles sp
   where sp.student_id = p_student
     and private.can_view_student(p_student)
$$;
revoke execute on function public.family_profile(uuid) from public, anon;
grant execute on function public.family_profile(uuid) to authenticated;
