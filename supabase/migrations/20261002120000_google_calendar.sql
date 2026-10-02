-- Google Calendar sync (docs/superpowers/specs/2026-10-02-google-calendar-sync-design.md).
-- Tutors connect a Google account and may switch on two-way sync with a
-- "VP Education sessions" calendar; students connect an address for invites.
-- Tokens and sync bookkeeping are service-role only.

create table public.google_connections (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  purpose             text not null check (purpose in ('tutor', 'student')),
  google_email        text not null check (char_length(google_email) <= 320),
  refresh_token_enc   text,
  scopes              text not null default '',
  sync_enabled        boolean not null default false,
  calendar_id         text,
  sync_token          text,
  channel_id          text unique,
  channel_resource_id text,
  channel_token       text,
  channel_expires_at  timestamptz,
  pull_started_at     timestamptz,
  last_synced_at      timestamptz,
  last_error          text check (last_error in ('reconnect', 'google_error')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint tutor_has_token check (purpose <> 'tutor' or refresh_token_enc is not null)
);

create table public.google_oauth_states (
  nonce      text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  purpose    text not null check (purpose in ('tutor', 'student')),
  verifier   text not null,
  return_to  text not null check (return_to like '/portal/%' and return_to not like '%//%'),
  expires_at timestamptz not null
);

create table public.google_deletions (
  id          bigint generated always as identity primary key,
  tutor_id    uuid not null references public.profiles (id) on delete cascade,
  calendar_id text not null,
  event_id    text not null,
  created_at  timestamptz not null default now()
);

alter table public.sessions
  add column google_event_id     text,
  add column google_calendar_id  text,
  add column google_recurring_id text,
  add column google_link         text check (google_link is null or google_link ~ '^https://'),
  add column sync_state          text check (sync_state in ('synced', 'pending', 'error')),
  add column google_synced_at    timestamptz;
create unique index sessions_google_event_idx on public.sessions (google_calendar_id, google_event_id)
  where google_event_id is not null;
create index sessions_sync_pending_idx on public.sessions (tutor_id) where sync_state in ('pending', 'error');

-- Service role only: no grants to anon or authenticated, RLS on with no policies
revoke all on public.google_connections, public.google_oauth_states, public.google_deletions from anon, authenticated;
grant all on public.google_connections, public.google_oauth_states, public.google_deletions to service_role;
alter table public.google_connections  enable row level security;
alter table public.google_oauth_states enable row level security;
alter table public.google_deletions    enable row level security;

-- The Google columns on sessions are written by the server only. Users keep
-- their existing column grants, which do not include these.

-- True when this statement comes from the service role (the sync itself). The
-- role PostgREST switched to is checked as well as the token's role claim, since
-- a secret API key's token may not carry one.
create function private.is_service_request()
returns boolean
language sql stable set search_path = ''
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      or coalesce(current_setting('role', true), '') = 'service_role'
$$;
revoke execute on function private.is_service_request() from public;
grant execute on function private.is_service_request() to authenticated, service_role;

-- A user's change to what Google shows marks the session for the next push
create function private.session_mark_pending()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if private.is_service_request() then
    return new;
  end if;
  if not exists (select 1 from public.google_connections c
                  where c.user_id = new.tutor_id and c.purpose = 'tutor' and c.sync_enabled) then
    return new;
  end if;
  if tg_op = 'INSERT'
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.subject is distinct from old.subject
     or new.location is distinct from old.location
     or new.meeting_url is distinct from old.meeting_url
     or new.notes is distinct from old.notes
     or new.status is distinct from old.status then
    new.sync_state := 'pending';
  end if;
  return new;
end
$$;
revoke execute on function private.session_mark_pending() from public;

create trigger sessions_mark_pending
  before insert or update on public.sessions
  for each row execute function private.session_mark_pending();

-- A user's delete of a synced session leaves a tombstone, so the event goes too
create function private.session_tombstone()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- A cascade from a deleted account leaves no tombstone (its connection is gone too)
  if old.google_event_id is not null and old.google_calendar_id is not null
     and not private.is_service_request()
     and exists (select 1 from public.profiles p where p.id = old.tutor_id) then
    insert into public.google_deletions (tutor_id, calendar_id, event_id)
    values (old.tutor_id, old.google_calendar_id, old.google_event_id);
  end if;
  return old;
end
$$;
revoke execute on function private.session_tombstone() from public;

create trigger sessions_tombstone
  after delete on public.sessions
  for each row execute function private.session_tombstone();

-- The caller's own connection, without tokens
create function public.my_google_connection()
returns table (connected boolean, purpose text, google_email text, sync_enabled boolean,
               last_synced_at timestamptz, last_error text)
language sql stable security definer set search_path = ''
as $$
  select true, c.purpose, c.google_email, c.sync_enabled, c.last_synced_at, c.last_error
    from public.google_connections c
   where c.user_id = auth.uid()
$$;
revoke execute on function public.my_google_connection() from public, anon;
grant execute on function public.my_google_connection() to authenticated;
