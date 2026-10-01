-- Enforce the 5-submission cap for each student and assignment in a trigger.
-- The policy check in private.can_submit is a stable function. It does not see
-- rows that the same insert adds, so one multi-row insert or two inserts at the
-- same time can go over the cap. This trigger takes a lock for the student and
-- assignment, and then counts. A trigger function is volatile, so the count
-- sees the rows that earlier inserts and the same statement added.

create function private.enforce_submission_cap()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.student_id::text || '/' || new.task_id::text, 0));
  if (select count(*) from public.submissions s
       where s.task_id = new.task_id and s.student_id = new.student_id) >= 5 then
    raise exception 'submission limit reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function private.enforce_submission_cap() from public;

create trigger submissions_before_insert
  before insert on public.submissions
  for each row execute function private.enforce_submission_cap();
