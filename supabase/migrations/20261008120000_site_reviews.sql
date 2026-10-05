-- Reviews from families, through personal links. An admin creates a link
-- for one parent or student on People > Reviews; the portal makes a random
-- token, keeps only its SHA-256 here, and shows the link once. The family
-- opens /review.html with the token and writes a review; /api/testimonials
-- (service role) checks the token, saves the review as pending and emails
-- the owner. An approved review is translated and shows on the landing
-- page under Parents or Students. Families and visitors never read these
-- tables; the landing page gets approved reviews through the API.

create table public.review_invites (
  id          bigint generated always as identity primary key,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  kind        text not null default 'parent' check (kind in ('parent', 'student')),
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '60 days',
  used_at     timestamptz
);

create table public.site_reviews (
  id           bigint generated always as identity primary key,
  invite_id    bigint unique references public.review_invites (id) on delete set null,  -- one review per link
  kind         text not null check (kind in ('parent', 'student')),
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  quote        text not null check (char_length(btrim(quote)) between 20 and 2000),
  translations jsonb check (translations is null or (jsonb_typeof(translations) = 'object' and octet_length(translations::text) <= 30000)),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);
create index site_reviews_status_idx on public.site_reviews (status, created_at);

-- Every status change stamps reviewed_at (cleared when moved back to pending)
create function private.stamp_site_review()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_at := case when new.status = 'pending' then null else now() end;
  end if;
  return new;
end;
$$;
revoke execute on function private.stamp_site_review() from public;
create trigger site_reviews_stamp_review
  before update of status on public.site_reviews
  for each row execute function private.stamp_site_review();

revoke all on public.review_invites, public.site_reviews from anon, authenticated;
grant all on public.review_invites, public.site_reviews to service_role;
grant select, delete on public.review_invites to authenticated;
grant insert (token_hash, name, kind) on public.review_invites to authenticated;
grant select, delete on public.site_reviews to authenticated;
grant update (status) on public.site_reviews to authenticated;

alter table public.review_invites enable row level security;
alter table public.site_reviews enable row level security;

create policy "admins read review links" on public.review_invites
  for select to authenticated using ((select private.is_admin()));
create policy "admins create review links" on public.review_invites
  for insert to authenticated with check ((select private.is_admin()));
create policy "admins remove review links" on public.review_invites
  for delete to authenticated using ((select private.is_admin()));

create policy "admins read reviews" on public.site_reviews
  for select to authenticated using ((select private.is_admin()));
create policy "admins decide reviews" on public.site_reviews
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "admins remove reviews" on public.site_reviews
  for delete to authenticated using ((select private.is_admin()));
