-- A link to a tutor or a parent is only valid for the roles it was made for.
-- The link policies check the roles only when a link is added. When an admin
-- changes a role, remove that person's links, so no old link gives access.

create function private.unlink_on_role_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.tutor_students where tutor_id = new.id or student_id = new.id;
  delete from public.parent_students where parent_id = new.id or student_id = new.id;
  return null;
end;
$$;

revoke execute on function private.unlink_on_role_change() from public;

create trigger profiles_after_role_change
  after update of role on public.profiles
  for each row
  when (old.role is distinct from new.role)
  execute function private.unlink_on_role_change();
