-- Grades become a result instead of a score out of 100.
--
-- A tutor now marks each piece of homework Completed, Missing or Extended:
--   completed  the work was done
--   missing    nothing usable was handed in
--   extended   the student gets more time; the assignment goes back to their
--              To do list with a new due date, and they may hand it in again
-- The AI grader suggests Completed or Missing as a draft; the tutor picks the
-- result and releases it, as before.
--
-- grades.result holds the result. Every grade that already has a score is
-- marked completed. The review trigger stamps the reviewer only when a person
-- (auth.uid()) makes the change, so this backfill stamps nobody. The score
-- column stays (nullable and no longer used) so nothing that still reads it
-- breaks.
--
-- A released grade now needs a result instead of a score and feedback:
-- feedback is optional.
--
-- tasks.extended_from keeps the original due date the first time an
-- assignment is extended (a later extension keeps the first date). Only staff
-- can write it: the existing "staff edit tasks" update policy allows a row
-- only when private.can_teach(student_id), which is false for students and
-- parents. Results are written the same way: the "staff review grades" update
-- policy already limits grade changes to staff.

alter table public.grades
  add column result text check (result in ('completed', 'missing', 'extended'));

update public.grades set result = 'completed' where score is not null;

alter table public.grades drop constraint released_grade_is_complete;
alter table public.grades
  add constraint released_grade_has_result check (released_at is null or result is not null);

grant update (result) on public.grades to authenticated;

alter table public.tasks add column extended_from timestamptz;

grant update (extended_from) on public.tasks to authenticated;
