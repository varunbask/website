-- Tutors see only their own sessions.
--
-- Two tutors can teach the same student (Varun and Lauren both teach Andrew
-- and April). Until now each saw every session of a student they teach, the
-- other tutor's included. Now a tutor reads only the sessions and weekly
-- series they teach. The admin still sees everything; a parent or student
-- still sees every session of their own (or their child's) lessons, with every
-- tutor. Writes are unchanged: a tutor already changed only their own sessions.
--
-- So a tutor is still warned before booking a student into a time the
-- student already has a lesson, student_busy() returns only the start and end
-- of that student's other tutors' lessons (no tutor, subject or notes), for
-- anyone who may see the student, over at most 400 days.

drop policy "read sessions of viewable students" on public.sessions;
create policy "read own sessions as a tutor, a viewable student's otherwise" on public.sessions
  for select to authenticated
  using ((tutor_id = (select auth.uid()) and (select private.my_role()) in ('tutor', 'admin'))
         or ((select private.my_role()) in ('admin', 'parent', 'student') and private.can_view_student(student_id)));

drop policy "read series of viewable students" on public.session_series;
create policy "read own series as a tutor, a viewable student's otherwise" on public.session_series
  for select to authenticated
  using ((tutor_id = (select auth.uid()) and (select private.my_role()) in ('tutor', 'admin'))
         or ((select private.my_role()) in ('admin', 'parent', 'student') and private.can_view_student(student_id)));

-- When a student is busy with someone else: times only, nothing about the lesson
create function public.student_busy(p_student uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.starts_at, s.ends_at
    from public.sessions s
   where private.can_view_student(p_student)
     and p_to > p_from
     and p_to - p_from <= interval '400 days'
     and s.student_id = p_student
     and s.tutor_id is distinct from auth.uid()
     and s.status <> 'cancelled'
     and s.starts_at < p_to
     and s.ends_at > p_from
   order by s.starts_at
$$;

revoke execute on function public.student_busy(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.student_busy(uuid, timestamptz, timestamptz) to authenticated;
