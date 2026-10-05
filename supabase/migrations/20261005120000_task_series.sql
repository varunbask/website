-- Repeating tasks and assignments. Staff create every copy at once (each with
-- its own due date, submissions and grade), and the copies share a series id
-- so the item drawer can edit or delete "this and following" together. The
-- id is set only when the copies are created; it never changes afterwards.
-- The existing task policies already decide who may create, edit and delete.

alter table public.tasks add column series_id uuid;
create index tasks_series_idx on public.tasks (series_id) where series_id is not null;

grant insert (series_id) on public.tasks to authenticated;
