-- Calendar colors by tutor. Every lesson on the calendar, Today, the drawers and
-- the family pages is drawn in the color of the tutor who teaches it, so a glance
-- tells whose lesson it is. The admin picks each tutor's color (or leaves it
-- automatic), from a fixed set of names that the portal turns into matching
-- light and dark shades.
--
-- profiles.calendar_color   one of the names below, or null (the portal picks a
--                           color from the tutor's id). Only tutors and admins
--                           carry one. Only the admin (or the service role and
--                           the Supabase dashboard) changes it.
-- calendar_colors()         { profile_id, color } of every tutor and admin who has
--                           a color, for everyone signed in except people still
--                           waiting for approval. Families need it to draw their
--                           own lessons in the right color; it holds no names,
--                           emails or anything else (names come from
--                           staff_names()).

alter table public.profiles
  add column calendar_color text
  constraint profiles_calendar_color_check check (calendar_color in (
    'red', 'orange', 'amber', 'lime', 'green', 'teal', 'cyan',
    'blue', 'indigo', 'violet', 'purple', 'pink', 'rose', 'slate'));

-- The update policy on profiles already lets only an admin change a row, so a
-- column grant is all the client needs. This trigger is the second lock, in
-- case a policy is ever loosened: a change to the color from anyone but the
-- admin is refused, a color only fits a tutor or an admin, and a person who
-- stops being staff loses theirs. The service role and the dashboard (no
-- auth.uid()) are not guarded.
create function private.profiles_color_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.calendar_color is distinct from old.calendar_color then
    if not (auth.uid() is null or private.is_service_request() or private.is_admin()) then
      raise exception 'only an admin changes a calendar color' using errcode = '42501';
    end if;
    if new.calendar_color is not null and new.role not in ('tutor', 'admin') then
      raise exception 'only a tutor or an admin has a calendar color' using errcode = '23514';
    end if;
  end if;
  if new.role not in ('tutor', 'admin') then
    new.calendar_color := null;
  end if;
  return new;
end;
$$;
revoke execute on function private.profiles_color_guard() from public;

create trigger profiles_before_color_change
  before update of calendar_color, role on public.profiles
  for each row
  when (new.calendar_color is distinct from old.calendar_color or new.role is distinct from old.role)
  execute function private.profiles_color_guard();

grant update (calendar_color) on public.profiles to authenticated;

-- Colors only, by id. Like staff_names(), it answers nobody who is still pending.
create function public.calendar_colors()
returns table (profile_id uuid, color text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.calendar_color
    from public.profiles p
   where p.role in ('tutor', 'admin')
     and p.calendar_color is not null
     and private.my_role() <> 'pending'
$$;
revoke execute on function public.calendar_colors() from public, anon;
grant execute on function public.calendar_colors() to authenticated;
