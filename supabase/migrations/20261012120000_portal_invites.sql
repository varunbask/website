-- People without a sign-in, and personal links that let them claim their account.
--
-- The admin adds a student or parent who has no login yet (People > Everyone >
-- Add someone without a login). /api/people creates a real auth user with no
-- password and an undeliverable placeholder address, so the person can be
-- linked, scheduled and billed like anyone else; profiles.no_login marks them.
--
-- When the family is ready, the admin makes a personal link (only its SHA-256
-- is kept here) and texts or emails it. The person opens /portal/join.html,
-- chooses their own email and password, and /api/people (service role) moves
-- the account to that email: same account, so every session, homework and bill
-- is already there. A link works once and for 30 days.

alter table public.profiles add column no_login boolean not null default false;

create table public.portal_invites (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  used_at     timestamptz,
  emailed_to  text check (char_length(emailed_to) <= 254),   -- set by /api/people when it emails the link
  emailed_at  timestamptz
);
create index portal_invites_profile_idx on public.portal_invites (profile_id, created_at desc);

revoke all on public.portal_invites from anon, authenticated;
grant all on public.portal_invites to service_role;
grant select, delete on public.portal_invites to authenticated;
grant insert (profile_id, token_hash) on public.portal_invites to authenticated;

alter table public.portal_invites enable row level security;

create policy "admin reads invites" on public.portal_invites
  for select to authenticated using ((select private.is_admin()));
-- Only for someone who has no sign-in yet, and only students and parents
create policy "admin creates invites" on public.portal_invites
  for insert to authenticated
  with check ((select private.is_admin())
              and exists (select 1 from public.profiles p
                           where p.id = profile_id and p.no_login and p.role in ('student', 'parent')));
create policy "admin removes invites" on public.portal_invites
  for delete to authenticated using ((select private.is_admin()));
