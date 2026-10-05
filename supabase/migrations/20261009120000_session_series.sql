-- Weekly sessions that repeat until someone ends them, the way Google Calendar
-- does it. A series is a rule (weekday, times, details, an optional last day);
-- its sessions are ordinary rows, made a year ahead and topped up every day by
-- the sweep cron, so attendance, recaps, homework and Google sync work on each
-- one as before. A row changed or deleted on its own stays that way: the rule
-- only makes days after last_date, never one it already made.
--
-- Older series (a fixed number of weeks, made before this) have no rule; their
-- rows still share a series_id and edit "this and following" the same way.

create table public.session_series (
  id          uuid primary key,             -- the series_id its sessions carry
  student_id  uuid not null references public.profiles (id) on delete cascade,
  tutor_id    uuid not null references public.profiles (id) on delete cascade,
  subject     text check (char_length(subject) <= 60),
  location    text check (char_length(location) <= 200),
  meeting_url text check (char_length(meeting_url) <= 500 and meeting_url ~ '^https://' and meeting_url !~ '\s'),
  notes       text check (char_length(notes) <= 2000),
  start_time  time not null,                -- Pacific wall time, so DST never shifts it
  end_time    time not null,
  first_date  date not null,                -- the first session's day
  until       date,                         -- the last day it may repeat on; null repeats until ended
  last_date   date,                         -- the latest day made so far, set by extend
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint series_length check (end_time > start_time and end_time - start_time <= interval '8 hours')
);
create index session_series_student_idx on public.session_series (student_id);
create index session_series_open_idx on public.session_series (tutor_id) where until is null;

-- Same rule as sessions: who may change a tutor's sessions with a student
create function private.can_change_sessions(p_tutor uuid, p_student uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_admin()
      or (p_tutor = auth.uid() and private.tutors_student(auth.uid(), p_student))
$$;
revoke execute on function private.can_change_sessions(uuid, uuid) from public;
grant execute on function private.can_change_sessions(uuid, uuid) to authenticated, service_role;

revoke all on public.session_series from anon, authenticated;
grant all on public.session_series to service_role;
grant select on public.session_series to authenticated;
grant insert (id, student_id, tutor_id, subject, location, meeting_url, notes, start_time, end_time, first_date, until)
  on public.session_series to authenticated;

alter table public.session_series enable row level security;

create policy "read series of viewable students" on public.session_series
  for select to authenticated
  using (private.can_view_student(student_id)
         or (tutor_id = (select auth.uid()) and (select private.my_role()) in ('tutor', 'admin')));

create policy "tutors start series" on public.session_series
  for insert to authenticated
  with check (private.has_role(student_id, 'student')
              and private.tutors_student(tutor_id, student_id)
              and (tutor_id = (select auth.uid()) or (select private.is_admin())));

-- Changes go through the functions below, which check the caller themselves

-- Makes a series' sessions from the day after last_date (or first_date) up to
-- p_through, or its until if earlier. Days before today are skipped once the
-- series has begun, so a series that paused (an unlinked tutor) never fills
-- the past. A tutor no longer assigned to the student gets nothing new.
-- Returns the number of sessions made.
create function private.extend_series(p_series uuid, p_through date)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  s     public.session_series%rowtype;
  tz    constant text := 'America/Los_Angeles';
  today date := (now() at time zone 'America/Los_Angeles')::date;
  d     date;
  stop  date;
  made  integer := 0;
  sync  text;
begin
  select * into s from public.session_series where id = p_series for update;
  if not found or not private.tutors_student(s.tutor_id, s.student_id) then
    return 0;
  end if;
  stop := least(p_through, coalesce(s.until, p_through));
  d := coalesce(s.last_date + 7, s.first_date);
  if s.last_date is not null and d < today then
    d := d + (((today - d) + 6) / 7) * 7;
  end if;
  -- The sync's own writes do not mark rows, so a top-up by the cron marks them here
  select case when exists (select 1 from public.google_connections c
                            where c.user_id = s.tutor_id and c.purpose = 'tutor' and c.sync_enabled)
              then 'pending' end
    into sync;
  while d <= stop loop
    insert into public.sessions
      (student_id, tutor_id, series_id, subject, starts_at, ends_at, location, meeting_url, notes, created_by, sync_state)
    values
      (s.student_id, s.tutor_id, s.id, s.subject,
       (d + s.start_time) at time zone tz, (d + s.end_time) at time zone tz,
       s.location, s.meeting_url, s.notes, s.created_by, sync);
    made := made + 1;
    update public.session_series set last_date = d where id = s.id;
    d := d + 7;
  end loop;
  return made;
end
$$;
revoke execute on function private.extend_series(uuid, date) from public;

-- How far ahead series are kept filled
create function private.series_horizon()
returns date
language sql stable set search_path = ''
as $$
  select (now() at time zone 'America/Los_Angeles')::date + 364
$$;
revoke execute on function private.series_horizon() from public;

-- A new series gets its first year at once
create function private.series_fill()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.extend_series(new.id, private.series_horizon());
  return new;
end
$$;
revoke execute on function private.series_fill() from public;

create trigger session_series_fill
  after insert on public.session_series
  for each row execute function private.series_fill();

-- The daily top-up (the sweep cron, as the service role)
create function public.extend_session_series()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r     record;
  total integer := 0;
begin
  for r in select id from public.session_series
            where until is null or last_date is null or last_date < until
  loop
    total := total + private.extend_series(r.id, private.series_horizon());
  end loop;
  return total;
end
$$;
revoke execute on function public.extend_session_series() from public, anon, authenticated;
grant execute on function public.extend_session_series() to service_role;

-- 'HH:MM' minutes moved by p_delta, held inside the day (as the portal does)
create function private.shift_minutes(p_time time, p_delta integer)
returns time
language sql immutable set search_path = ''
as $$
  select make_interval(mins => least(greatest(
    (extract(hour from p_time) * 60 + extract(minute from p_time))::integer + p_delta, 0), 23 * 60 + 59))::time
$$;
revoke execute on function private.shift_minutes(time, integer) from public;

-- "This and following": every session of the series from p_session on moves by
-- p_shift days and p_start_delta / p_end_delta minutes, and takes the details
-- in p_fields (only the keys given: subject, location, meeting_url, notes).
-- The rule moves with them, so the sessions it makes later match. A session
-- moved on its own keeps its difference, like the portal's retimeRows. Rows
-- that would not change are left alone (and keep their updated_at). Returns the
-- number of sessions changed; all or nothing.
create function public.edit_following_sessions(
  p_session bigint, p_shift integer, p_start_delta integer, p_end_delta integer, p_fields jsonb default '{}'::jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  s       public.sessions%rowtype;
  tz      constant text := 'America/Los_Angeles';
  changed integer;
  f       jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  select * into s from public.sessions where id = p_session;
  if not found or s.series_id is null or not private.can_change_sessions(s.tutor_id, s.student_id) then
    raise exception 'session not found' using errcode = '42501';
  end if;
  if p_shift is null or p_start_delta is null or p_end_delta is null
     or abs(p_shift) > 366 or abs(p_start_delta) > 1440 or abs(p_end_delta) > 1440 then
    raise exception 'bad change' using errcode = '22023';
  end if;

  with target as (
    select x.id,
           ((x.starts_at at time zone tz)::date + p_shift
              + private.shift_minutes((x.starts_at at time zone tz)::time, p_start_delta)) at time zone tz as new_start,
           ((x.ends_at at time zone tz)::date + p_shift
              + private.shift_minutes((x.ends_at at time zone tz)::time, p_end_delta)) at time zone tz as new_end,
           case when f ? 'subject' then nullif(btrim(f ->> 'subject'), '') else x.subject end as new_subject,
           case when f ? 'location' then nullif(btrim(f ->> 'location'), '') else x.location end as new_location,
           case when f ? 'meeting_url' then nullif(btrim(f ->> 'meeting_url'), '') else x.meeting_url end as new_url,
           case when f ? 'notes' then nullif(btrim(f ->> 'notes'), '') else x.notes end as new_notes
      from public.sessions x
     where x.series_id = s.series_id
       and x.tutor_id = s.tutor_id
       and x.student_id = s.student_id
       and x.starts_at >= s.starts_at
  )
  update public.sessions x
     set starts_at = t.new_start, ends_at = t.new_end, subject = t.new_subject,
         location = t.new_location, meeting_url = t.new_url, notes = t.new_notes
    from target t
   where x.id = t.id
     and (x.starts_at, x.ends_at, x.subject, x.location, x.meeting_url, x.notes)
         is distinct from (t.new_start, t.new_end, t.new_subject, t.new_location, t.new_url, t.new_notes);
  get diagnostics changed = row_count;

  update public.session_series r
     set start_time  = private.shift_minutes(r.start_time, p_start_delta),
         end_time    = private.shift_minutes(r.end_time, p_end_delta),
         last_date   = r.last_date + p_shift,
         until       = case when r.until is null then null else r.until + p_shift end,
         subject     = case when f ? 'subject' then nullif(btrim(f ->> 'subject'), '') else r.subject end,
         location    = case when f ? 'location' then nullif(btrim(f ->> 'location'), '') else r.location end,
         meeting_url = case when f ? 'meeting_url' then nullif(btrim(f ->> 'meeting_url'), '') else r.meeting_url end,
         notes       = case when f ? 'notes' then nullif(btrim(f ->> 'notes'), '') else r.notes end,
         updated_at  = now()
   where r.id = s.series_id
     and r.tutor_id = s.tutor_id
     and r.student_id = s.student_id;
  return changed;
end
$$;
revoke execute on function public.edit_following_sessions(bigint, integer, integer, integer, jsonb) from public, anon;
grant execute on function public.edit_following_sessions(bigint, integer, integer, integer, jsonb) to authenticated;

-- Ends a series the day before p_session, so nothing new is made from then on
-- ("cancel" or "delete this and following"; the portal handles the rows that
-- already exist). From its first session, that is the whole series, so the
-- rule goes. A series without a rule (made before this) needs nothing.
create function public.end_session_series(p_session bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s   public.sessions%rowtype;
  day date;
begin
  select * into s from public.sessions where id = p_session;
  if not found or not private.can_change_sessions(s.tutor_id, s.student_id) then
    raise exception 'session not found' using errcode = '42501';
  end if;
  if s.series_id is null then
    return;
  end if;
  day := (s.starts_at at time zone 'America/Los_Angeles')::date;
  delete from public.session_series
   where id = s.series_id and tutor_id = s.tutor_id and student_id = s.student_id and first_date >= day;
  update public.session_series
     set until = day - 1, updated_at = now()
   where id = s.series_id and tutor_id = s.tutor_id and student_id = s.student_id
     and (until is null or until >= day);
end
$$;
revoke execute on function public.end_session_series(bigint) from public, anon;
grant execute on function public.end_session_series(bigint) to authenticated;
