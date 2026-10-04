-- Formatted answers. A student writes in the portal's document editor; the
-- answer is stored twice: body (plain text, as before, so grading, the
-- 20,000 character limit and the never-blank check all still apply) and
-- body_doc (the formatting, as a small JSON document the portal validates and
-- draws itself; see portal/js/rich-doc.js). A doc is only kept with a body.
--
-- Drafts: what a student has written but not submitted, one per student and
-- assignment, saved as they type so they can finish on another device. Only
-- the student can see or change their drafts; submitting removes the draft.
-- Drafts live outside submissions, so the 5 attempt cap never counts them.

alter table public.submissions
  add column body_doc jsonb
    check (body_doc is null or (jsonb_typeof(body_doc) = 'object' and octet_length(body_doc::text) <= 300000)),
  add constraint submissions_doc_has_body check (body_doc is null or body is not null);

grant insert (body_doc) on public.submissions to authenticated;

create table public.submission_drafts (
  student_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  task_id    bigint not null references public.tasks (id) on delete cascade,
  body_doc   jsonb not null check (jsonb_typeof(body_doc) = 'object' and octet_length(body_doc::text) <= 300000),
  body       text not null default '' check (char_length(body) <= 40000),
  updated_at timestamptz not null default now(),
  primary key (student_id, task_id)
);
create index submission_drafts_task_idx on public.submission_drafts (task_id);

alter table public.submission_drafts enable row level security;
revoke all on public.submission_drafts from anon, authenticated;
grant select, delete                       on public.submission_drafts to authenticated;
grant insert (task_id, body_doc, body)     on public.submission_drafts to authenticated;
-- task_id too, because an upsert (PostgREST on_conflict) sets every column it sends
grant update (task_id, body_doc, body)     on public.submission_drafts to authenticated;
grant all                                  on public.submission_drafts to service_role;

-- A draft belongs to its student, for one of their own assignments
create policy "students read their own drafts" on public.submission_drafts
  for select to authenticated using (student_id = (select auth.uid()));
create policy "students write drafts for their assignments" on public.submission_drafts
  for insert to authenticated
  with check (student_id = (select auth.uid())
              and exists (select 1 from public.tasks t
                           where t.id = task_id and t.student_id = (select auth.uid()) and t.kind = 'assignment'));
create policy "students change their own drafts" on public.submission_drafts
  for update to authenticated
  using (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid())
              and exists (select 1 from public.tasks t
                           where t.id = task_id and t.student_id = (select auth.uid()) and t.kind = 'assignment'));
create policy "students remove their own drafts" on public.submission_drafts
  for delete to authenticated using (student_id = (select auth.uid()));

-- Every save moves updated_at (the editor shows "Draft saved" from it)
create function private.draft_touch()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.draft_touch() from public;
create trigger submission_drafts_touch
  before update on public.submission_drafts
  for each row execute function private.draft_touch();

-- A submission takes the place of its draft
create function private.clear_draft_on_submit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.submission_drafts where student_id = new.student_id and task_id = new.task_id;
  return null;
end;
$$;
revoke execute on function private.clear_draft_on_submit() from public;
create trigger submissions_clear_draft
  after insert on public.submissions
  for each row execute function private.clear_draft_on_submit();
