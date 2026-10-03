-- An admin can also teach: a tutor link may name an admin as the tutor, so the
-- owner can tutor some students without a second account. The rest already
-- fits: an admin may read and change every link and session, sessions are
-- booked for a tutor linked to the student (tutors_student), and an admin's
-- own sessions are readable to them (the sessions select policy). A role
-- change still removes the person's links (unlink_on_role_change).

drop policy "admin links tutor to student" on public.tutor_students;
create policy "admin links tutor to student" on public.tutor_students
  for insert to authenticated
  with check ((select private.is_admin())
              and (private.has_role(tutor_id, 'tutor') or private.has_role(tutor_id, 'admin'))
              and private.has_role(student_id, 'student'));
