-- Profiles and photos. Everyone in the portal (students, parents, tutors and the
-- admin) may add a profile photo. A student, or their parent, fills in a short
-- profile: grade, school, pronouns, hobbies and interests, favorite subjects,
-- goals and how they learn best. Tutors and the admin write a few lines about
-- themselves for the families they teach.
--
-- private.can_see_person(person)
--     Who may see a person's photo (and a tutor's profile). True for the person
--     themselves, the admin, staff looking at staff, anyone who may see the
--     student, anyone who may see a student the parent is linked to, and anyone
--     who may see a student the tutor teaches. The last one is how students and
--     parents see their own tutors, and nobody else's.
-- profiles.avatar_path
--     '<person id>/<random name>.webp' (or .jpg, .png) in the private avatars
--     bucket, or null. Only set_avatar() writes it: no client has an update
--     grant on the column.
-- storage bucket "avatars"
--     Private, at most 1 MB a file, WebP, JPEG or PNG, at most 10 files in a
--     person's folder (the portal keeps one and deletes the one it replaced).
--     Whoever may see the person may read the file. The person (once approved),
--     the admin, or a parent of a student adds and removes files in that
--     person's folder. A file is never overwritten (no update policy): a new
--     photo is a new file name.
-- set_avatar(person, path) -> the previous path
--     Points the profile at an uploaded file (or clears it with null) and hands
--     back the old path, so the portal can delete the old file.
-- person_cards(ids)
--     id, name, role and photo path of up to 500 people the caller may see. The
--     profiles table does not let a student read their tutor's row (or a tutor a
--     parent's), so this is how the portal shows those names and photos.
-- student_profiles
--     Gains pronouns, interests, favorite_subjects and learning_style. The table
--     stays staff only to read, because learning_notes is for tutors.
-- save_student_profile(student, ...)
--     The student, a linked parent or a tutor of the student saves the seven
--     fields the family owns. It never reads or changes learning_notes.
-- family_profile(student)
--     Now returns the new fields and when the profile was last saved. Still
--     never learning_notes or who saved it.
-- staff_profiles
--     One row per tutor or admin: about me, subjects they teach, school or
--     university, hobbies and interests. Read by whoever may see that person,
--     written by the person or the admin. Never deleted (it goes with the person).
--
-- Realtime: staff_profiles is not added to the publication. It changes rarely,
-- the photo itself lives on profiles (already published), and the families who
-- read a tutor's profile could not hear about it anyway: Realtime only sends a
-- row to people whose select policy on the table lets them read it, which here
-- would ask can_see_person for every subscriber on every change.

-- ---------------------------------------------------------------------------
-- Who may see a person

create function private.can_see_person(p_person uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_person is not null and coalesce(
    p_person = auth.uid()
    or private.is_admin()
    or (private.my_role() in ('tutor', 'admin')
        and exists (select 1 from public.profiles p
                     where p.id = p_person and p.role in ('tutor', 'admin')))
    or exists (
      select 1 from public.profiles p
       where p.id = p_person
         and (
           (p.role = 'student' and private.can_view_student(p.id))
           or (p.role = 'parent' and exists (
                 select 1 from public.parent_students ps
                  where ps.parent_id = p.id and private.can_view_student(ps.student_id)))
           or (p.role in ('tutor', 'admin') and exists (
                 select 1 from public.tutor_students ts
                  where ts.tutor_id = p.id and private.can_view_student(ts.student_id)))
         )),
    false)
$$;
revoke execute on function private.can_see_person(uuid) from public;
grant execute on function private.can_see_person(uuid) to authenticated;

-- Who may change a person's photo: the person (not while still waiting for
-- approval), the admin, or a parent of that person when the person is a
-- student (parents of young children add it)
create function private.can_set_avatar(p_person uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_person is not null and coalesce(
    (p_person = auth.uid() and private.my_role() in ('student', 'parent', 'tutor', 'admin'))
    or private.is_admin()
    or (private.my_role() = 'parent'
        and private.has_role(p_person, 'student')
        and exists (select 1 from public.parent_students ps
                     where ps.parent_id = auth.uid() and ps.student_id = p_person)),
    false)
$$;
revoke execute on function private.can_set_avatar(uuid) from public;
grant execute on function private.can_set_avatar(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The photo path on the profile

alter table public.profiles
  add column avatar_path text
  constraint profiles_avatar_path_check check (
    avatar_path is null
    or (char_length(avatar_path) <= 200
        and avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(webp|jpg|png)$'
        and split_part(avatar_path, '/', 1) = id::text));

-- ---------------------------------------------------------------------------
-- Storage: a private bucket, one folder per person ('<person id>/<name>')

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The folder must look like a uuid before it is cast, so a malformed name is
-- simply not allowed instead of an error inside the policy. A name with no
-- such folder belongs to nobody: can_see_person(null) and can_set_avatar(null)
-- are false for everyone, the admin included.
create function private.avatar_folder(p_name text)
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

revoke execute on function private.avatar_folder(text) from public;

create function private.can_see_avatar_file(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.can_see_person(private.avatar_folder(p_name)), false)
$$;
revoke execute on function private.can_see_avatar_file(text) from public;
grant execute on function private.can_see_avatar_file(text) to authenticated;

create function private.can_set_avatar_file(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.can_set_avatar(private.avatar_folder(p_name)), false)
$$;
revoke execute on function private.can_set_avatar_file(text) from public;
grant execute on function private.can_set_avatar_file(text) to authenticated;

-- How many photos a person's folder already holds (an upload is refused at 10,
-- so nobody can fill the bucket). Counted as the owner, past the read policy.
create function private.avatar_folder_full(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select count(*) from storage.objects o
           where o.bucket_id = 'avatars'
             and split_part(o.name, '/', 1) = split_part(p_name, '/', 1)) >= 10
$$;
revoke execute on function private.avatar_folder_full(text) from public;
grant execute on function private.avatar_folder_full(text) to authenticated;

create policy "avatars: read photos of people you may see" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and private.can_see_avatar_file(name));

create policy "avatars: add a photo for yourself or your child" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars'
              and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(webp|jpg|png)$'
              and private.can_set_avatar_file(name)
              and not private.avatar_folder_full(name));

create policy "avatars: remove a photo of yourself or your child" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and private.can_set_avatar_file(name));

-- No update policy: a photo is never overwritten, a new one gets a new name.

-- ---------------------------------------------------------------------------
-- set_avatar: point the profile at an uploaded photo, or clear it

create function public.set_avatar(p_person uuid, p_path text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_old text;
begin
  if p_person is null or not private.can_set_avatar(p_person) then
    raise exception 'you may not change this photo' using errcode = '42501';
  end if;
  select p.avatar_path into v_old from public.profiles p where p.id = p_person for update;
  if not found then
    raise exception 'person not found' using errcode = 'P0002';
  end if;
  if p_path is not null then
    if char_length(p_path) > 200
       or p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(webp|jpg|png)$'
       or split_part(p_path, '/', 1) <> p_person::text then
      raise exception 'not a photo path for this person' using errcode = '22023';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path) then
      raise exception 'upload the photo first' using errcode = 'P0002';
    end if;
  end if;
  update public.profiles set avatar_path = p_path where id = p_person;
  return v_old;
end;
$$;
revoke execute on function public.set_avatar(uuid, text) from public, anon;
grant execute on function public.set_avatar(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- person_cards: names and photos of people the caller may see

create function public.person_cards(p_ids uuid[])
returns table (id uuid, full_name text, role public.app_role, avatar_path text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce(cardinality(p_ids), 0) > 500 then
    raise exception 'ask for at most 500 people at a time' using errcode = '22023';
  end if;
  return query
    select p.id, p.full_name, p.role, p.avatar_path
      from public.profiles p
     where p.id = any (p_ids)
       and private.can_see_person(p.id)
     order by p.id;
end;
$$;
revoke execute on function public.person_cards(uuid[]) from public, anon;
grant execute on function public.person_cards(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Student profiles: the fields the family fills in

alter table public.student_profiles
  add column pronouns          text check (char_length(pronouns) <= 40),
  add column interests         text check (char_length(interests) <= 500),          -- "Hobbies and interests"
  add column favorite_subjects text check (char_length(favorite_subjects) <= 200),
  add column learning_style    text check (char_length(learning_style) <= 500);     -- "How I learn best"

-- Staff still write the table directly (the Profile editor on the Overview)
grant insert (pronouns, interests, favorite_subjects, learning_style) on public.student_profiles to authenticated;
grant update (pronouns, interests, favorite_subjects, learning_style) on public.student_profiles to authenticated;

-- Trimmed text, or null when nothing but blanks is left (save_student_profile)
create function private.clean_text(p_text text)
returns text
language sql immutable set search_path = ''
as $$ select nullif(regexp_replace(coalesce(p_text, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '') $$;
revoke execute on function private.clean_text(text) from public;

-- The student, a linked parent or a tutor of the student (the admin too) saves
-- the seven family fields. learning_notes is never read or written here. The
-- touch trigger stamps an edit; a new row is stamped here.
create function public.save_student_profile(
  p_student uuid,
  p_grade_level text,
  p_school text,
  p_pronouns text,
  p_interests text,
  p_favorite_subjects text,
  p_goals text,
  p_learning_style text)
returns table (
  grade_level text, school text, goals text, pronouns text, interests text,
  favorite_subjects text, learning_style text, updated_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_role public.app_role := private.my_role();
begin
  if p_student is null or not (
       (v_role = 'student' and p_student = auth.uid())
       or (v_role = 'parent' and exists (select 1 from public.parent_students ps
                                          where ps.parent_id = auth.uid() and ps.student_id = p_student))
       or private.can_teach(p_student)) then
    raise exception 'you may not change this profile' using errcode = '42501';
  end if;
  if not private.has_role(p_student, 'student') then
    raise exception 'a profile is for a student' using errcode = '22023';
  end if;

  insert into public.student_profiles as sp
    (student_id, grade_level, school, pronouns, interests, favorite_subjects, goals, learning_style, updated_by, updated_at)
  values
    (p_student, private.clean_text(p_grade_level), private.clean_text(p_school), private.clean_text(p_pronouns),
     private.clean_text(p_interests), private.clean_text(p_favorite_subjects), private.clean_text(p_goals),
     private.clean_text(p_learning_style), auth.uid(), now())
  on conflict (student_id) do update
    set grade_level       = excluded.grade_level,
        school            = excluded.school,
        pronouns          = excluded.pronouns,
        interests         = excluded.interests,
        favorite_subjects = excluded.favorite_subjects,
        goals             = excluded.goals,
        learning_style    = excluded.learning_style;

  return query
    select sp.grade_level, sp.school, sp.goals, sp.pronouns, sp.interests,
           sp.favorite_subjects, sp.learning_style, sp.updated_at
      from public.student_profiles sp
     where sp.student_id = p_student;
end;
$$;
revoke execute on function public.save_student_profile(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.save_student_profile(uuid, text, text, text, text, text, text, text) to authenticated;

-- The family's view of the profile, with the new fields. Same access as before:
-- anyone who may see the student. Never learning_notes or updated_by.
drop function public.family_profile(uuid);
create function public.family_profile(p_student uuid)
returns table (
  grade_level text, school text, goals text, pronouns text, interests text,
  favorite_subjects text, learning_style text, updated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select sp.grade_level, sp.school, sp.goals, sp.pronouns, sp.interests,
         sp.favorite_subjects, sp.learning_style, sp.updated_at
    from public.student_profiles sp
   where sp.student_id = p_student
     and private.can_view_student(p_student)
$$;
revoke execute on function public.family_profile(uuid) from public, anon;
grant execute on function public.family_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff profiles: a few lines a tutor (or the admin) writes for families

create table public.staff_profiles (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  bio        text check (char_length(bio) <= 600),          -- "About me"
  subjects   text check (char_length(subjects) <= 200),     -- "Subjects I teach"
  education  text check (char_length(education) <= 200),   -- "School or university"
  interests  text check (char_length(interests) <= 500),    -- "Hobbies and interests"
  updated_at timestamptz not null default now()
);

create function private.staff_profile_touch()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
revoke execute on function private.staff_profile_touch() from public;
create trigger staff_profiles_touch before insert or update on public.staff_profiles
  for each row execute function private.staff_profile_touch();

-- A staff profile is only for a tutor or an admin, whoever writes it
create function private.staff_profile_staff_only()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p
                  where p.id = new.profile_id and p.role in ('tutor', 'admin')) then
    raise exception 'a staff profile is only for a tutor or an admin' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function private.staff_profile_staff_only() from public;
create trigger staff_profiles_staff_only before insert or update on public.staff_profiles
  for each row execute function private.staff_profile_staff_only();

-- Privileges: start from nothing, grant exactly what the policies need. Nobody
-- deletes a staff profile (it goes with the person). profile_id has no update
-- grant, so the portal saves with an update, or an insert when there is no row
-- yet, never a PostgREST upsert (which would set profile_id too).
revoke all on public.staff_profiles from anon, authenticated;
grant all on public.staff_profiles to service_role;
grant select on public.staff_profiles to authenticated;
grant insert (profile_id, bio, subjects, education, interests) on public.staff_profiles to authenticated;
grant update (bio, subjects, education, interests) on public.staff_profiles to authenticated;

alter table public.staff_profiles enable row level security;

create policy "read staff profiles of people you may see" on public.staff_profiles
  for select to authenticated
  using (private.can_see_person(profile_id));
create policy "staff add their own profile, the admin any" on public.staff_profiles
  for insert to authenticated
  with check ((profile_id = (select auth.uid()) and (select private.my_role()) in ('tutor', 'admin'))
              or (select private.is_admin()));
create policy "staff edit their own profile, the admin any" on public.staff_profiles
  for update to authenticated
  using ((profile_id = (select auth.uid()) and (select private.my_role()) in ('tutor', 'admin'))
         or (select private.is_admin()))
  with check ((profile_id = (select auth.uid()) and (select private.my_role()) in ('tutor', 'admin'))
              or (select private.is_admin()));
-- No delete policy.
