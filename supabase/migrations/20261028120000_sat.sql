-- SAT: lessons, online practice, timed tests and the PDF library, for the
-- students the admin turns it on for.
--
-- sat_access
--     One row per student who may use the SAT tab. Only the admin adds or
--     removes rows; the student, their tutors and their parents read it. A
--     row must be for a student (trigger), and it only counts while the
--     person is still a student (private.sat_allowed).
-- Content: sat_sets, sat_skills, sat_guides, sat_items, sat_keys, sat_files
--     Written only by the loader with the service role (no client policies
--     that write). Staff read everything. Students with access read the sets,
--     skills and study guides, the items that are not held back (never
--     hold_reason, review_note or source: those columns are not granted to
--     anyone signed in) and the files that are not staff only. sat_keys is
--     staff only: a student gets an answer from sat_answer (practice, after
--     answering) or sat_submit / sat_review (tests, after submitting).
-- sat_attempts, sat_responses
--     A practice run or one timed module. Read by the student, their tutors,
--     the admin and their parents (progress); written only by the RPCs below.
--     A test response has no correctness until the module is submitted.
-- storage bucket "sat-files"
--     Private PDFs and PNG figures. Staff read every file; a student with
--     access reads a file listed in sat_files that is not staff only, and the
--     figures (figures/<id>.png). Nobody signed in writes to it.
-- RPCs (security definer, the caller is auth.uid())
--     sat_start, sat_answer, sat_submit, sat_review, sat_release_item (admin),
--     sat_held_items (admin).
-- Grid-in answers are scored by private.sat_spr_correct, mirrored in
-- portal/js/sat-model.js (sprCorrect).

-- ---------------------------------------------------------------------------
-- Helpers

create function private.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(private.my_role() in ('tutor', 'admin'), false) $$;
revoke execute on function private.is_staff() from public;
grant execute on function private.is_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- Who may use the SAT tab

create table public.sat_access (
  student_id uuid primary key references public.profiles (id) on delete cascade,
  granted_by uuid default auth.uid() references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now()
);

-- True while the person has a sat_access row and is still a student
create function private.sat_allowed(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.sat_access a
      join public.profiles p on p.id = a.student_id
     where a.student_id = p_user and p.role = 'student')
$$;
revoke execute on function private.sat_allowed(uuid) from public;
grant execute on function private.sat_allowed(uuid) to authenticated;

-- Staff, or a student with access: who may read the SAT content
create function private.sat_reader()
returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_staff() or private.sat_allowed(auth.uid()) $$;
revoke execute on function private.sat_reader() from public;
grant execute on function private.sat_reader() to authenticated;

create function private.sat_access_student_only()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.has_role(new.student_id, 'student') then
    raise exception 'SAT access is for students only' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function private.sat_access_student_only() from public;

create trigger sat_access_student_only before insert or update on public.sat_access
  for each row execute function private.sat_access_student_only();

-- ---------------------------------------------------------------------------
-- Content (the loader writes it with the service role)

create table public.sat_sets (
  id       text primary key,
  kind     text not null check (kind in ('practice', 'skill_test', 'full_test')),
  domain   text,
  skill    text,
  title    text not null,
  position int not null default 0,
  modules  jsonb not null default '[]',
  -- 'vp': our own Skill Builder sets; 'matthew': the practice sets in the guides
  origin   text not null default 'matthew' check (origin in ('matthew', 'vp'))
);

create table public.sat_skills (
  slug     text primary key,
  domain   text not null,
  name     text not null,
  position int not null default 0
);

-- A study guide per official skill (an SAT doc, portal/js/sat-doc.js)
create table public.sat_guides (
  skill    text primary key,
  domain   text not null,
  title    text not null,
  position int not null default 0,
  body     jsonb not null
);

create table public.sat_items (
  id          text primary key,
  set_id      text not null references public.sat_sets (id) on delete cascade,
  module      text,
  position    int not null,
  domain      text not null,
  skill       text,
  difficulty  text check (difficulty in ('easy', 'medium', 'hard')),
  kind        text not null check (kind in ('mc', 'spr')),
  passage     jsonb,
  stem        jsonb not null,
  choices     jsonb,
  held        boolean not null default false,
  hold_reason text,
  review_note text,
  source      jsonb
);
create index sat_items_set_idx on public.sat_items (set_id, module, position);

create table public.sat_keys (
  item_id     text primary key references public.sat_items (id) on delete cascade,
  answer      text not null,
  accept      jsonb not null default '[]',
  explanation jsonb
);

create table public.sat_files (
  id           text primary key,
  collection   text not null check (collection in ('lesson', 'question_bank', 'official_test', 'test_pdf', 'answer_key')),
  domain       text,
  skill        text,
  difficulty   text,
  title        text not null,
  storage_path text not null unique,
  bytes        bigint,
  pages        int,
  staff_only   boolean not null default false,
  position     int not null default 0
);

-- ---------------------------------------------------------------------------
-- Attempts and responses (written only by the RPCs)

create table public.sat_attempts (
  id           bigint generated always as identity primary key,
  student_id   uuid not null references public.profiles (id) on delete cascade,
  set_id       text not null references public.sat_sets (id) on delete cascade,
  module       text,
  sitting      uuid,
  mode         text not null check (mode in ('practice', 'test')),
  started_at   timestamptz not null default now(),
  deadline_at  timestamptz,
  submitted_at timestamptz,
  correct      int,
  total        int
);
create index sat_attempts_student_idx on public.sat_attempts (student_id, set_id, started_at desc);

create table public.sat_responses (
  attempt_id  bigint references public.sat_attempts (id) on delete cascade,
  item_id     text references public.sat_items (id) on delete cascade,
  response    text check (char_length(response) <= 12),
  correct     boolean,
  flagged     boolean not null default false,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, item_id)
);
create index sat_responses_item_idx on public.sat_responses (item_id);

-- The owner, the admin, their tutors and their parents
create function private.sat_can_see_attempt(p_attempt bigint)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.sat_attempts a
     where a.id = p_attempt
       and (a.student_id = auth.uid() or private.can_view_student(a.student_id)))
$$;
revoke execute on function private.sat_can_see_attempt(bigint) from public;
grant execute on function private.sat_can_see_attempt(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing, grant exactly what the policies need

revoke all on public.sat_access, public.sat_sets, public.sat_skills, public.sat_guides, public.sat_items,
  public.sat_keys, public.sat_files, public.sat_attempts, public.sat_responses from anon, authenticated;
grant all on public.sat_access, public.sat_sets, public.sat_skills, public.sat_guides, public.sat_items,
  public.sat_keys, public.sat_files, public.sat_attempts, public.sat_responses to service_role;

grant select on public.sat_access to authenticated;
grant insert (student_id) on public.sat_access to authenticated;
grant delete on public.sat_access to authenticated;
grant select on public.sat_sets, public.sat_skills, public.sat_guides, public.sat_keys, public.sat_files to authenticated;
-- Not hold_reason, review_note or source: staff read those through sat_held_items()
grant select (id, set_id, module, position, domain, skill, difficulty, kind, passage, stem, choices, held)
  on public.sat_items to authenticated;
grant select on public.sat_attempts, public.sat_responses to authenticated;

alter table public.sat_access    enable row level security;
alter table public.sat_sets      enable row level security;
alter table public.sat_skills    enable row level security;
alter table public.sat_guides    enable row level security;
alter table public.sat_items     enable row level security;
alter table public.sat_keys      enable row level security;
alter table public.sat_files     enable row level security;
alter table public.sat_attempts  enable row level security;
alter table public.sat_responses enable row level security;

create policy "sat_access: the admin, the student, their tutors and parents read" on public.sat_access
  for select to authenticated using (private.is_admin() or private.can_view_student(student_id));
create policy "sat_access: the admin turns it on" on public.sat_access
  for insert to authenticated with check (private.is_admin());
create policy "sat_access: the admin turns it off" on public.sat_access
  for delete to authenticated using (private.is_admin());

create policy "sat_sets: staff and students with access read" on public.sat_sets
  for select to authenticated using (private.sat_reader());
create policy "sat_skills: staff and students with access read" on public.sat_skills
  for select to authenticated using (private.sat_reader());
create policy "sat_guides: staff and students with access read" on public.sat_guides
  for select to authenticated using (private.sat_reader());
create policy "sat_items: staff read all, students with access the ones not held" on public.sat_items
  for select to authenticated using (private.is_staff() or (not held and private.sat_allowed(auth.uid())));
create policy "sat_keys: staff only" on public.sat_keys
  for select to authenticated using (private.is_staff());
create policy "sat_files: staff read all, students with access the shared ones" on public.sat_files
  for select to authenticated using (private.is_staff() or (not staff_only and private.sat_allowed(auth.uid())));
create policy "sat_attempts: the student, their tutors, the admin and parents read" on public.sat_attempts
  for select to authenticated using (student_id = auth.uid() or private.can_view_student(student_id));
create policy "sat_responses: whoever may see the attempt reads" on public.sat_responses
  for select to authenticated using (private.sat_can_see_attempt(attempt_id));

-- ---------------------------------------------------------------------------
-- Storage: a private bucket for the PDFs and figures. No file size limit of
-- its own (the project's upload limit applies); the loader uploads with the
-- service role, so no policy lets anyone signed in add, change or remove a file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sat-files', 'sat-files', false, null, array['application/pdf', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create function private.sat_can_read_file(p_name text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_staff()
      or (private.sat_allowed(auth.uid())
          and (p_name ~ '^figures/[a-z0-9-]{1,80}\.png$'
               or exists (select 1 from public.sat_files f where f.storage_path = p_name and not f.staff_only)))
$$;
revoke execute on function private.sat_can_read_file(text) from public;
grant execute on function private.sat_can_read_file(text) to authenticated;

create policy "sat-files: staff and students with access read" on storage.objects
  for select to authenticated
  using (bucket_id = 'sat-files' and private.sat_can_read_file(name));

-- ---------------------------------------------------------------------------
-- Scoring

-- A grid-in entry as typed, cleaned: trimmed, spaces and a leading + dropped
create function private.sat_spr_clean(p_text text)
returns text
language sql immutable set search_path = ''
as $$ select regexp_replace(regexp_replace(coalesce(p_text, ''), '\s', '', 'g'), '^\+', '') $$;
revoke execute on function private.sat_spr_clean(text) from public;

-- A grid-in entry as an exact fraction: { numerator, denominator } (a
-- decimal is itself over 1, as numeric keeps it exact), or null when it is
-- not an integer, a decimal or a fraction a/b with b not 0. No length limit:
-- the answer key and its accepted forms are read with it too.
create function private.sat_spr_parts(p_text text)
returns numeric[]
language plpgsql immutable set search_path = ''
as $$
declare
  s text := private.sat_spr_clean(p_text);
  parts text[];
begin
  if s ~ '^-?([0-9]+\.?[0-9]*|\.[0-9]+)$' then
    return array[s::numeric, 1::numeric];
  end if;
  parts := regexp_match(s, '^(-?[0-9]+)/([0-9]+)$');
  if parts is null or parts[2]::numeric = 0 then
    return null;
  end if;
  return array[parts[1]::numeric, parts[2]::numeric];
end;
$$;
revoke execute on function private.sat_spr_parts(text) from public;

-- A grid-in answer: a valid form of at most 5 characters (6 with a minus
-- sign) that is either
--   exactly an exact answer (compared as fractions, so 6/4 = 3/2 and
--   3.50 = 7/2), or
--   character for character an approximation listed in accept (after
--   trimming and dropping a leading +), so for 8/17 ".4706" counts but ".47"
--   does not, though it is the value of "0.470": a repeating decimal must
--   fill the box.
-- The exact answers are the answer, every fraction or whole number in
-- accept, and every decimal in accept that equals one of them or is not a
-- rounding of one (a second root). A decimal within one unit of its last
-- place of an exact answer, without equalling it, is an approximation.
create function private.sat_spr_correct(response text, answer text, accept jsonb)
returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  s text := private.sat_spr_clean(response);
  r numeric[] := private.sat_spr_parts(response);
  entries text[] := array(select jsonb_array_elements_text(case when jsonb_typeof(accept) = 'array' then accept else '[]'::jsonb end));
  nums numeric[] := '{}';
  dens numeric[] := '{}';
  approx text[] := '{}';
  e text;
  c text;
  a numeric[];
  places int;
  equal boolean;
  near boolean;
  i int;
begin
  if r is null or char_length(s) > (case when left(s, 1) = '-' then 6 else 5 end) then
    return false;
  end if;
  a := private.sat_spr_parts(answer);
  if a is not null then
    nums := nums || a[1];
    dens := dens || a[2];
  end if;
  -- fractions and whole numbers in accept are exact answers
  foreach e in array entries loop
    a := private.sat_spr_parts(e);
    if a is not null and position('.' in private.sat_spr_clean(e)) = 0 then
      nums := nums || a[1];
      dens := dens || a[2];
    end if;
  end loop;
  -- decimals: equal to an exact answer, a rounding of one, or another answer
  foreach e in array entries loop
    c := private.sat_spr_clean(e);
    a := private.sat_spr_parts(e);
    continue when a is null or position('.' in c) = 0;
    places := char_length(split_part(c, '.', 2));
    equal := false;
    near := false;
    for i in 1 .. coalesce(array_length(nums, 1), 0) loop
      if a[1] * dens[i] = nums[i] * a[2] then
        equal := true;
        exit;
      end if;
      if abs(a[1] * dens[i] - nums[i] * a[2]) * power(10::numeric, places) < abs(a[2] * dens[i]) then
        near := true;
      end if;
    end loop;
    if near and not equal then
      approx := approx || c;
    elsif not equal then
      nums := nums || a[1];
      dens := dens || a[2];
    end if;
  end loop;
  for i in 1 .. coalesce(array_length(nums, 1), 0) loop
    if r[1] * dens[i] = nums[i] * r[2] then
      return true;
    end if;
  end loop;
  return s = any(approx);
end;
$$;
revoke execute on function private.sat_spr_correct(text, text, jsonb) from public;

create function private.sat_is_correct(p_kind text, p_response text, p_answer text, p_accept jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when p_response is null or btrim(p_response) = '' or p_answer is null then false
    when p_kind = 'mc' then upper(btrim(p_response)) = upper(btrim(p_answer))
    else private.sat_spr_correct(p_response, p_answer, p_accept)
  end
$$;
revoke execute on function private.sat_is_correct(text, text, text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- RPCs

-- The review of an attempt: every item (p_all) or only the answered ones, with
-- the answer and the explanation
create function private.sat_review_json(p_attempt bigint, p_all boolean)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'attempt', jsonb_build_object(
      'id', a.id, 'student_id', a.student_id, 'set_id', a.set_id, 'module', a.module, 'sitting', a.sitting,
      'mode', a.mode, 'started_at', a.started_at, 'deadline_at', a.deadline_at, 'submitted_at', a.submitted_at),
    'correct', a.correct,
    'total', a.total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'item', i.id,
          'response', r.response,
          'correct', coalesce(r.correct, case when a.submitted_at is not null then false end),
          'flagged', coalesce(r.flagged, false),
          'answer', k.answer,
          'accept', coalesce(k.accept, '[]'::jsonb),
          'explanation', k.explanation)
        order by i.position, i.id)
        from public.sat_items i
        left join public.sat_responses r on r.attempt_id = a.id and r.item_id = i.id
        left join public.sat_keys k on k.item_id = i.id
       where i.set_id = a.set_id
         and (a.module is null or i.module is null or i.module = a.module)
         and not i.held
         and (p_all or r.response is not null)), '[]'::jsonb))
    from public.sat_attempts a
   where a.id = p_attempt
$$;
revoke execute on function private.sat_review_json(bigint, boolean) from public;

-- Starts a practice run or a timed module, or picks up the unfinished one:
--   practice     the unfinished run of the set, else a new one (no deadline)
--   skill_test   one module (p_module, else the set's first); deadline now()
--                plus its minutes
--   full_test    p_module is required; modules go in the set's order inside a
--                sitting, each once: the first starts a sitting (or resumes
--                its unfinished module), the next ones need p_sitting and the
--                module before them submitted
-- -> { attempt_id, sitting, deadline_at, mode, module, started_at, server_now,
--      items: [item ids in order, held ones left out] }
create function public.sat_start(p_set text, p_module text default null, p_sitting uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  s public.sat_sets;
  mods jsonb;
  mkey text;
  idx int;
  minutes int;
  a public.sat_attempts;
  sit uuid;
begin
  if me is null or not (private.is_staff() or private.sat_allowed(me)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into s from public.sat_sets where id = p_set;
  if not found then
    raise exception 'no_such_set' using errcode = 'P0002';
  end if;

  if s.kind = 'practice' then
    select * into a from public.sat_attempts
     where student_id = me and set_id = s.id and mode = 'practice' and submitted_at is null
     order by started_at desc, id desc limit 1;
    if not found then
      insert into public.sat_attempts (student_id, set_id, mode) values (me, s.id, 'practice') returning * into a;
    end if;
  else
    mods := case when jsonb_typeof(s.modules) = 'array' then s.modules else '[]'::jsonb end;
    if s.kind = 'full_test' and p_module is null then
      raise exception 'module_required' using errcode = '22023';
    end if;
    mkey := coalesce(p_module, mods -> 0 ->> 'key');
    select (e.ord - 1)::int, (e.value ->> 'minutes')::int into idx, minutes
      from jsonb_array_elements(mods) with ordinality as e(value, ord)
     where e.value ->> 'key' = mkey;
    if idx is null then
      if s.kind = 'skill_test' and jsonb_array_length(mods) = 0 and p_module is null then
        -- a skill test listed without modules: one module, timed by its section
        idx := 0;
        minutes := case when s.domain in ('information-and-ideas', 'craft-and-structure', 'expression-of-ideas',
                                          'standard-english-conventions') then 32 else 35 end;
      else
        raise exception 'no_such_module' using errcode = 'P0002';
      end if;
    end if;
    minutes := coalesce(minutes, 35);

    if s.kind = 'full_test' and idx > 0 then
      if p_sitting is null then
        raise exception 'sitting_required' using errcode = '22023';
      end if;
      if not exists (select 1 from public.sat_attempts
                      where student_id = me and set_id = s.id and sitting = p_sitting
                        and module = mods -> (idx - 1) ->> 'key' and submitted_at is not null) then
        raise exception 'previous_module_open' using errcode = '22023';
      end if;
    end if;

    if p_sitting is not null then
      select * into a from public.sat_attempts
       where student_id = me and set_id = s.id and module is not distinct from mkey and sitting = p_sitting
       order by started_at desc, id desc limit 1;
    else
      select * into a from public.sat_attempts
       where student_id = me and set_id = s.id and module is not distinct from mkey and mode = 'test'
         and submitted_at is null
       order by started_at desc, id desc limit 1;
    end if;
    if found and a.submitted_at is not null then
      raise exception 'already_taken' using errcode = '22023';
    end if;
    if not found then
      sit := case when s.kind = 'full_test' then coalesce(p_sitting, gen_random_uuid()) else p_sitting end;
      insert into public.sat_attempts (student_id, set_id, module, sitting, mode, deadline_at)
      values (me, s.id, mkey, sit, 'test', now() + make_interval(mins => minutes))
      returning * into a;
    end if;
  end if;

  return jsonb_build_object(
    'attempt_id', a.id, 'sitting', a.sitting, 'deadline_at', a.deadline_at, 'mode', a.mode,
    'module', a.module, 'started_at', a.started_at, 'server_now', now(),
    'items', coalesce((
      select jsonb_agg(i.id order by i.position, i.id)
        from public.sat_items i
       where i.set_id = a.set_id
         and (a.module is null or i.module is null or i.module = a.module)
         and not i.held), '[]'::jsonb));
end;
$$;
revoke execute on function public.sat_start(text, text, uuid) from public, anon;
grant execute on function public.sat_start(text, text, uuid) to authenticated;

-- Saves an answer (and the Mark for review flag) on the caller's own attempt.
--   practice  the first answer is final: it is scored and the result comes
--             back { correct, answer, accept, explanation, response }; asking
--             again returns the stored result. A null response with p_flagged
--             only sets the flag ({ saved: true }).
--   test      until 30 seconds past the deadline (then 'time_up'): the
--             response and flag are stored, never scored here ({ saved: true }).
--             A null response keeps the one saved; '' clears it.
create function public.sat_answer(p_attempt bigint, p_item text, p_response text, p_flagged boolean default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a public.sat_attempts;
  i public.sat_items;
  k public.sat_keys;
  r public.sat_responses;
  resp text := nullif(btrim(p_response), '');
  ok boolean;
begin
  select * into a from public.sat_attempts where id = p_attempt and student_id = auth.uid() for update;
  if not found then
    raise exception 'no_such_attempt' using errcode = 'P0002';
  end if;
  if a.submitted_at is not null then
    raise exception 'submitted' using errcode = 'P0001';
  end if;
  select * into i from public.sat_items
   where id = p_item and set_id = a.set_id
     and (a.module is null or module is null or module = a.module)
     and not held;
  if not found then
    raise exception 'no_such_item' using errcode = 'P0002';
  end if;
  if resp is not null then
    if char_length(resp) > 12 then
      raise exception 'bad_response' using errcode = '22023';
    end if;
    if i.kind = 'mc' then
      resp := upper(resp);
      if resp not in ('A', 'B', 'C', 'D') then
        raise exception 'bad_response' using errcode = '22023';
      end if;
    end if;
  end if;

  if a.mode = 'practice' then
    select * into r from public.sat_responses where attempt_id = a.id and item_id = i.id;
    select * into k from public.sat_keys where item_id = i.id;
    if r.response is not null then
      -- already answered: the stored result, unchanged (only the flag may change)
      if p_flagged is not null and p_flagged <> r.flagged then
        update public.sat_responses set flagged = p_flagged where attempt_id = a.id and item_id = i.id;
      end if;
      return jsonb_build_object('correct', r.correct, 'answer', k.answer, 'accept', coalesce(k.accept, '[]'::jsonb),
                                'explanation', k.explanation, 'response', r.response);
    end if;
    if resp is null then
      insert into public.sat_responses (attempt_id, item_id, flagged)
      values (a.id, i.id, coalesce(p_flagged, false))
      on conflict (attempt_id, item_id) do update set flagged = coalesce(p_flagged, public.sat_responses.flagged);
      return jsonb_build_object('saved', true);
    end if;
    ok := private.sat_is_correct(i.kind, resp, k.answer, k.accept);
    insert into public.sat_responses (attempt_id, item_id, response, correct, flagged, answered_at)
    values (a.id, i.id, resp, ok, coalesce(p_flagged, false), now())
    on conflict (attempt_id, item_id) do update
      set response = excluded.response, correct = excluded.correct, answered_at = excluded.answered_at,
          flagged = coalesce(p_flagged, public.sat_responses.flagged);
    return jsonb_build_object('correct', ok, 'answer', k.answer, 'accept', coalesce(k.accept, '[]'::jsonb),
                              'explanation', k.explanation, 'response', resp);
  end if;

  if now() > a.deadline_at + interval '30 seconds' then
    raise exception 'time_up' using errcode = 'P0001';
  end if;
  insert into public.sat_responses (attempt_id, item_id, response, flagged, answered_at)
  values (a.id, i.id, resp, coalesce(p_flagged, false), now())
  on conflict (attempt_id, item_id) do update
    set response = case when p_response is null then public.sat_responses.response else excluded.response end,
        answered_at = case when p_response is null then public.sat_responses.answered_at else excluded.answered_at end,
        flagged = coalesce(p_flagged, public.sat_responses.flagged);
  return jsonb_build_object('saved', true);
end;
$$;
revoke execute on function public.sat_answer(bigint, text, text, boolean) from public, anon;
grant execute on function public.sat_answer(bigint, text, text, boolean) to authenticated;

-- Submits the caller's own attempt (a second call returns the same review):
-- a test module is scored now, an unanswered item counting as wrong; a
-- practice run is finished, its score over every item in the set. Sets
-- correct and total (items not held) and returns the review.
create function public.sat_submit(p_attempt bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a public.sat_attempts;
  n_total int;
  n_correct int;
begin
  select * into a from public.sat_attempts where id = p_attempt and student_id = auth.uid() for update;
  if not found then
    raise exception 'no_such_attempt' using errcode = 'P0002';
  end if;
  if a.submitted_at is null then
    if a.mode = 'test' then
      update public.sat_responses r
         set correct = private.sat_is_correct(i.kind, r.response, k.answer, k.accept)
        from public.sat_items i
        left join public.sat_keys k on k.item_id = i.id
       where r.attempt_id = a.id and i.id = r.item_id;
    end if;
    select count(*), count(*) filter (where r.correct)
      into n_total, n_correct
      from public.sat_items i
      left join public.sat_responses r on r.attempt_id = a.id and r.item_id = i.id
     where i.set_id = a.set_id
       and (a.module is null or i.module is null or i.module = a.module)
       and not i.held;
    update public.sat_attempts
       set submitted_at = now(), correct = n_correct, total = n_total
     where id = a.id;
  end if;
  return private.sat_review_json(a.id, true);
end;
$$;
revoke execute on function public.sat_submit(bigint) from public, anon;
grant execute on function public.sat_submit(bigint) to authenticated;

-- The review of an attempt. The owner: a submitted attempt, or a practice run
-- still going (its answered items only). Staff who teach the student: any
-- attempt, any time, every item.
create function public.sat_review(p_attempt bigint)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  a public.sat_attempts;
begin
  select * into a from public.sat_attempts where id = p_attempt;
  if not found then
    raise exception 'no_such_attempt' using errcode = 'P0002';
  end if;
  if a.student_id = auth.uid() then
    if a.submitted_at is not null then
      return private.sat_review_json(a.id, true);
    end if;
    if a.mode = 'practice' then
      return private.sat_review_json(a.id, false);
    end if;
    raise exception 'not_submitted' using errcode = 'P0001';
  end if;
  if private.can_teach(a.student_id) then
    return private.sat_review_json(a.id, true);
  end if;
  raise exception 'not_allowed' using errcode = '42501';
end;
$$;
revoke execute on function public.sat_review(bigint) from public, anon;
grant execute on function public.sat_review(bigint) to authenticated;

-- The admin releases a held item, optionally with its answer (mc: A to D;
-- spr: a grid-in value a student could enter)
create function public.sat_release_item(p_item text, p_answer text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  i public.sat_items;
  ans text := nullif(btrim(p_answer), '');
begin
  if not private.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  select * into i from public.sat_items where id = p_item for update;
  if not found then
    raise exception 'no_such_item' using errcode = 'P0002';
  end if;
  if ans is not null then
    if i.kind = 'mc' then
      ans := upper(ans);
      if ans not in ('A', 'B', 'C', 'D') then
        raise exception 'bad_answer' using errcode = '22023';
      end if;
    elsif not private.sat_spr_correct(ans, ans, '[]'::jsonb) then
      raise exception 'bad_answer' using errcode = '22023';
    end if;
    insert into public.sat_keys (item_id, answer) values (i.id, ans)
    on conflict (item_id) do update set answer = excluded.answer;
  elsif not exists (select 1 from public.sat_keys where item_id = i.id) then
    raise exception 'no_answer' using errcode = '22023';
  end if;
  update public.sat_items set held = false, hold_reason = null where id = i.id;
end;
$$;
revoke execute on function public.sat_release_item(text, text) from public, anon;
grant execute on function public.sat_release_item(text, text) to authenticated;

-- The questions held back, with why and the answer on file (admin)
create function public.sat_held_items()
returns table (id text, set_id text, set_title text, module text, "position" int, kind text,
               hold_reason text, review_note text, answer text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  return query
    select i.id, i.set_id, s.title, i.module, i.position, i.kind, i.hold_reason, i.review_note, k.answer
      from public.sat_items i
      join public.sat_sets s on s.id = i.set_id
      left join public.sat_keys k on k.item_id = i.id
     where i.held
     order by s.kind, s.position, i.set_id, i.module nulls first, i.position;
end;
$$;
revoke execute on function public.sat_held_items() from public, anon;
grant execute on function public.sat_held_items() to authenticated;
