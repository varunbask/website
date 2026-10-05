-- Referrals: a parent or student recommends another family from the "Refer
-- a family" form on the landing page. The form posts to /api/referral, which
-- checks it, rate-limits it and saves it with the service role. Visitors and
-- signed-in users can never read or write this table directly; admins read
-- the list on the People page, mark a referral contacted, and remove it.

create table public.referrals (
  id             bigint generated always as identity primary key,
  referrer_name  text not null check (char_length(btrim(referrer_name)) between 1 and 120),
  referrer_email text not null check (char_length(referrer_email) <= 254 and referrer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  referrer_role  text not null check (referrer_role in ('parent', 'student')),
  family_name    text not null check (char_length(btrim(family_name)) between 1 and 120),
  family_email   text check (family_email is null or (char_length(family_email) <= 254 and family_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  family_phone   text check (family_phone is null or family_phone ~ '^[0-9+(). -]{7,30}$'),
  grade          text check (grade is null or char_length(grade) <= 40),
  subjects       text check (subjects is null or char_length(subjects) <= 300),
  note           text check (note is null or char_length(note) <= 1000),
  language       text not null default 'en' check (language in ('en', 'zh', 'es', 'fr', 'ko')),
  ip_hash        text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),  -- for rate limiting only
  status         text not null default 'new' check (status in ('new', 'contacted')),
  created_at     timestamptz not null default now(),
  constraint referral_reaches_family check (family_email is not null or family_phone is not null)
);
create index referrals_created_idx on public.referrals (created_at desc);
create index referrals_ip_idx on public.referrals (ip_hash, created_at) where ip_hash is not null;

revoke all on public.referrals from anon, authenticated;
grant all on public.referrals to service_role;
grant select, delete on public.referrals to authenticated;
grant update (status) on public.referrals to authenticated;

alter table public.referrals enable row level security;

create policy "admins read referrals" on public.referrals
  for select to authenticated using ((select private.is_admin()));
create policy "admins mark referrals" on public.referrals
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins remove referrals" on public.referrals
  for delete to authenticated using ((select private.is_admin()));
