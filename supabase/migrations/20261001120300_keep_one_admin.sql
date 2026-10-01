-- The update policy stops an admin from demoting themselves, but two admins
-- can demote each other at the same time. Then no admin is left, and only the
-- service role can fix it. This trigger refuses a demotion that leaves no admin.
-- The lock makes demotions run one at a time, so each count sees the last one.

create function private.keep_one_admin()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('keep_one_admin', 0));
  if not exists (select 1 from public.profiles p where p.role = 'admin' and p.id <> old.id) then
    raise exception 'at least one admin must remain' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function private.keep_one_admin() from public;

create trigger profiles_before_admin_demotion
  before update of role on public.profiles
  for each row
  when (old.role = 'admin' and new.role is distinct from 'admin')
  execute function private.keep_one_admin();
