-- Live updates. The portal listens for changes with Supabase Realtime
-- (postgres_changes) so an open page follows what other people do: a tutor
-- marks attendance, the admin edits a lesson, a student hands in work, a grade
-- is released, a parent is linked. Realtime only streams tables that belong to
-- the `supabase_realtime` publication, so this adds the ones the portal shows.
--
-- Who hears what: Realtime checks the table's row level security for each
-- subscriber, so a message for an INSERT or UPDATE reaches only people whose
-- select policy lets them read that row (a student hears about their own work,
-- a tutor about their own students, the admin about everything). A DELETE is
-- different: the database cannot check who may read a row that is gone, so
-- Realtime sends it to every subscriber of the table and it carries only the
-- primary key. Replica identity stays at its default (the primary key) on
-- purpose; `replica identity full` would put the whole old row, private text
-- included, into those messages.
--
-- Every table added here has row level security on (see the migration that
-- creates it) and a primary key, which a published table needs for UPDATE and
-- DELETE to keep working.
--
--   profiles, tutor_students, parent_students, tasks, submissions, grades,
--   updates                                                    20260930120000
--   sessions                                                   20261001200000
--   materials                                                  20261001200100
--   session_series                                             20261009120000
--   student_profiles, student_notes                            20261017120000
--
-- Left out on purpose:
--   billing_settings, billing_policies, family_rates, tutor_rates,
--   session_billing, payments, payouts, billing_adjustments,
--   billing_contacts, statements: only the admin reads or writes them, and a
--   DELETE would still reach every subscriber with its primary key. The
--   Account page already refreshes after the admin's own writes, and a
--   change to a session or a person drops its billing data too.
--   google_connections, google_oauth_states and google_deletions (tokens and
--   sync internals), portal_invites and review_invites (invite secrets),
--   referrals and site_reviews (contact details of people with no login),
--   submission_drafts (written on every keystroke, so each one would echo back
--   to the typist), session_edits (an audit trail that only changes when a
--   session does, and sessions already reports that).
--
-- Safe to run twice: a table already in the publication is skipped, and a
-- table that does not exist yet is skipped with a notice.

do $$
declare
  wanted text[] := array[
    'profiles', 'tutor_students', 'parent_students', 'tasks', 'submissions', 'grades', 'updates',
    'sessions', 'materials', 'session_series',
    'student_profiles', 'student_notes'
  ];
  t text;
begin
  -- Supabase creates this publication; a plain Postgres has none
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array wanted loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'realtime: public.% does not exist, skipped', t;
    elsif exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      raise notice 'realtime: public.% is already published', t;
    else
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
