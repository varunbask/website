# Google Calendar sync: design

Status: approved by the owner on 2026-10-02. To be built on branch `schedules` (PR varunbask/website#5), which is not merged and whose migrations are not applied. Builds on docs/superpowers/specs/2026-10-02-tutoring-schedules.md.

## Decisions (owner)

- The business has no Google Workspace. Each tutor connects their own Google account.
- Students connect only so the portal knows which Google address to invite. The portal gets no access to their calendar.
- Parents are not invited.
- Each tutor has a switch in the portal, "Sync with Google Calendar".
  - **On:**
    - The tutor's sessions sync both ways with a separate "VP Education sessions" calendar that the portal creates in their Google account.
    - Connected students get Google invites, updates and cancellations from Google.
    - The tutor's own portal calendar also shows their personal Google events next to the sessions: titles and times, read-only, seen only by that tutor and never stored.
  - **Off:** sessions live only in the portal, exactly as PR #5 built them.
- Only tutors (and admins) change sessions. Students and parents only view them, in the portal and in Google (as a guest, a student cannot move the tutor's event).
- The portal stays the main record for every session; Google is a synced copy for tutors with the switch on. This keeps PR #5's scheduling, series, materials, homework, notes and RLS. Alec's PR #5 review suggested deleting the portal series logic; it stays because tutors with sync off need it.

## Google access

- **Tutors:**
  - `openid`
  - `email`
  - `https://www.googleapis.com/auth/calendar.app.created` lets the portal create its calendar and manage events on calendars it created.
  - `https://www.googleapis.com/auth/calendar.events.readonly` lets it read the tutor's events, for the personal overlay and clash warnings.
- **Students:** `openid` and `email` only. These are non-sensitive scopes, so no Google verification is needed for students.
- **Sign-in flow:** the web-server OAuth flow with PKCE (S256), `access_type=offline`, `prompt=consent` and `include_granted_scopes=false`. The redirect URI is `${SITE_URL}/api/google/callback`.
- **Verification:** the calendar scopes are sensitive. While the Google app is in Testing, only listed test users can connect and refresh tokens expire after 7 days. Production needs Google's verification, or running unverified, which shows a warning screen and caps the app at 100 users.

## Data (new migration `supabase/migrations/20261002120000_google_calendar.sql`)

- **`public.google_connections`**, one row per connected person:
  - `user_id` (primary key, references profiles, delete cascade)
  - `purpose` (`'tutor'` or `'student'`)
  - `google_email`
  - `refresh_token_enc` (AES-256-GCM, base64 `iv.tag.ciphertext`, null for students)
  - `scopes`
  - `sync_enabled` (boolean, default false, tutors only)
  - `calendar_id` (the VP calendar)
  - `sync_token`
  - `channel_id`, `channel_resource_id`, `channel_token`, `channel_expires_at`
  - `pull_started_at` (a short lock)
  - `last_synced_at`, `last_error` (user-safe codes: `reconnect`, `google_error`)
  - `created_at`, `updated_at`
  - **Access:** RLS on with no policies, and no grants to `anon` or `authenticated`. Only the service role can read it.
- **`public.google_oauth_states`**:
  - `nonce` (primary key, 43-character base64url)
  - `user_id`
  - `purpose`
  - `verifier` (the PKCE verifier)
  - `return_to`
  - `expires_at` (10 minutes)
  - **Access:** service role only. Each state is single use, deleted on callback.
- **`public.google_deletions`**, tombstones for portal deletes of synced sessions:
  - `id`
  - `tutor_id`
  - `calendar_id`
  - `event_id`
  - `created_at`
  - **Access:** service role only.
- **`public.sessions`** gains:
  - `google_event_id` and `google_calendar_id`, unique together where not null
  - `google_recurring_id`, set for instances of a recurring event created in Google
  - `google_link` (the event's `htmlLink`)
  - `sync_state` (`'synced'`, `'pending'`, `'error'` or null)
  - `google_synced_at`
- **Trigger `sessions_mark_pending`** (before insert or update):
  - **Who it applies to:** writes made by a signed-in user, not by the service role. A request's role comes from `current_setting('request.jwt.claims', true)::jsonb ->> 'role'`.
  - **When it fires:** the session's tutor has `sync_enabled`, and it is an insert or a change to `starts_at`, `ends_at`, `subject`, `location`, `meeting_url`, `notes` or `status`.
  - **What it does:** sets `sync_state = 'pending'`. Changes to attendance and recap do not mark a session pending.
- **Trigger `sessions_tombstone`** (after delete): for a user write whose old row has a `google_event_id`, it inserts a `google_deletions` row.
- **`public.my_google_connection()`** (security definer, for `authenticated`): returns `connected`, `purpose`, `google_email`, `sync_enabled`, `last_synced_at` and `last_error` for `auth.uid()`. It never returns tokens.
- **Student Google addresses:** the server reads them with the service role; nothing new is exposed to the browser for that.

## Server (Vercel functions, Node, Web `Request` handlers; logic in `api/_lib/google/`)

These modules take their dependencies (fetch, repo, clock, env) as parameters, as `api/_lib/http.js` does, so they can be unit-tested.

- **`crypto.js`:** `encrypt(text, keyB64)` and `decrypt(blob, keyB64)` with AES-256-GCM, using the key `GOOGLE_TOKEN_KEY` (32 bytes, base64).
- **`oauth.js`:**
  - `newState()` makes the nonce and the PKCE verifier and challenge.
  - `authUrl({ clientId, redirectUri, scopes, state, challenge })`.
  - `exchangeCode({ code, verifier, ... })` and `refreshAccess({ refreshToken, ... })`, both returning `{ access_token, refresh_token?, expires_in, scope }`.
  - `fetchEmail(accessToken)` calls the OpenID userinfo endpoint.
  - `revoke(token)`.
  - An `invalid_grant` error becomes `GoogleAuthError`.
- **`calendar.js`:** a thin client over Calendar API v3 using a fresh access token.
  - Calendars: `insertCalendar`.
  - Events: `insertEvent`, `patchEvent`, `deleteEvent` (all with `sendUpdates=all`), `listEvents` (sync token or a time range) and `listInstances`.
  - Notifications: `watchEvents` and `stopChannel`.
  - Errors: 404 and 410 come back as typed errors, and 429 or 403 rate limits become `GoogleRateError`.
- **`mapping.js`** (pure):
  - `sessionToEvent(session, { studentName, studentEmail, portalUrl })`:
    - `summary` is `"<subject or Tutoring session> (<student full name>)"`.
    - `description` is the plan notes followed by a blank line and `Open in the portal: <portalUrl>`.
    - `location` is the location, else the meeting URL.
    - `start` and `end` are `{ dateTime, timeZone: 'America/Los_Angeles' }`.
    - `attendees` is `[{ email: studentEmail }]` when the student has connected, else empty.
    - `extendedProperties.private` is `{ vpSessionId, vpStudentId }`.
  - `eventToSessionFields(event)` returns `{ subject, starts_at, ends_at, location, meeting_url, notes, status, google_link }`.
    - The ` (Name)` suffix the portal added is stripped from the subject.
    - The plan notes are the description before the portal-link line.
    - A `meeting_url` comes from `hangoutLink`, or from the location if that is an https URL.
    - A cancelled event becomes status `cancelled`.
    - All-day events return null and are ignored.
  - `matchStudent(event, students)`: the attendee emails, compared case-insensitively against the tutor's linked students' connected Google emails and then their portal emails. Exactly one match returns that student, otherwise null.
  - `resolveConflict(row, event)` returns `'google'` or `'portal'`. Google wins unless the row is pending and its `updated_at` is later than the event's `updated`.
- **`push.js`, `pushPending(conn, { repo, google, now })`:**
  - **Tombstones first:** for each of the tutor's tombstones, delete the event (404 or 410 counts as done) and remove the tombstone.
  - **Then pending and error sessions** (up to 50):
    - A cancelled session with an event: delete the event, then clear `google_event_id` and `google_link`.
    - A cancelled session without an event: just mark it synced.
    - A session with an event: patch it. A 404 means insert it instead.
    - A session without an event: insert it.
    - On success, store the event ID and link, `sync_state = 'synced'` and `google_synced_at`.
  - **Errors:**
    - A rate limit stops the run and leaves the rest pending.
    - Any other error marks that session `error`, which is retried next run.
  - **Who runs it:** writes use the service role, so the trigger does not mark them pending again.
- **`pull.js`, `pullChanges(conn, { repo, google, now })`:**
  - **Lock:** it takes the `pull_started_at` lock, skipping if it was taken less than 60 seconds ago.
  - **Listing:** it lists the VP calendar's events with `singleEvents=false`, using `syncToken` when there is one. A 410 clears the token and does a full list.
  - **Each changed item:**
    - **A recurring master (has `recurrence`):** list its instances from now minus 8 weeks to now plus 26 weeks, then handle each instance.
    - **An item with `extendedProperties.private.vpSessionId`:** update that session, but only if its `tutor_id` matches.
    - **An item for an unknown event:**
      - Match a student. If there is a match and the times exist, insert a session for that tutor and student with the event ID, calendar and recurring ID.
      - Otherwise ignore it.
    - **An event whose session already exists:** update it when `resolveConflict` says Google.
    - **A cancelled event:** set the session to cancelled. A recurring instance cancelled in Google becomes a cancelled session.
  - **At the end:** it stores the new `sync_token` and `last_synced_at`, and clears `last_error`.
- **`maintain.js`:**
  - `ensureCalendar(conn)` creates "VP Education sessions" with the America/Los_Angeles time zone if `calendar_id` is missing.
  - `ensureChannel(conn)` (re)creates the watch when it is missing or expires within 48 hours. It uses a random ID and token, the address `${SITE_URL}/api/google/notify`, and a 7-day TTL, and stops the old channel.
  - `stopSync(conn)` stops the channel and clears the channel fields.
- **`service.js`** wraps these with token refresh and records each outcome:
  - `withGoogle(conn, fn)` refreshes access, runs `fn`, and on `GoogleAuthError` sets `last_error = 'reconnect'` and stops.
- **`repo.js` additions (service role):**
  - connection reads and writes;
  - pending sessions for a tutor;
  - tombstones;
  - session lookup by event;
  - insert and update of synced fields;
  - linked students with emails;
  - marking upcoming sessions pending, used when a student connects or disconnects and when a tutor turns sync on.

## Endpoints (`api/google/*.js`, all `export async function` handlers)

- **`POST /api/google/start`**:
  - **Input:** a bearer token, and a body of `{ purpose: 'tutor' | 'student', return_to }`.
  - **Checks:** the role must match the purpose. Tutors connect as tutors; students connect as students.
  - **Saving the return address:** `return_to` must start with `/portal/` and contain no `//`.
  - **Result:** saves the state row and returns `{ url }`.
- **`GET /api/google/callback?code&state`** (or `?error=`):
  - Loads and deletes the state, checking it has not expired.
  - Exchanges the code and reads the email.
  - Upserts the connection, encrypting the refresh token.
  - **For a tutor:** `sync_enabled = true`, then `ensureCalendar`, `ensureChannel`, marking upcoming sessions pending, `pushPending` and `pullChanges`. The upcoming sessions are the tutor's from now on.
  - **For a student:** marks the student's upcoming sessions with sync-on tutors pending, then pushes for each of those tutors.
  - **Redirect (302):** to `return_to` with `google=connected`, or `google=error` with a reason, in the hash params.
  - Each step after the upsert is best effort: a failure there still connects, and the error is recorded.
- **`POST /api/google/settings` `{ sync_enabled }`** (tutor):
  - **Turning on:** ensure the calendar, ensure the channel, mark upcoming sessions pending, push and pull.
  - **Turning off:** `stopSync`. The pending flags are kept but ignored while off.
  - **Result:** returns the status.
- **`POST /api/google/disconnect`:**
  - **Tutor:** stop the channel, revoke the token, and delete the connection. Sessions keep their Google IDs, which are inert.
  - **Student:** delete the connection, mark their upcoming sessions with sync-on tutors pending (which removes them as an attendee), then push.
- **`POST /api/google/sync`** (tutor): push, then pull, for the caller. It returns the status, and is throttled by the pull lock.
- **`GET /api/google/personal?from&to`** (tutor with sync on; range at most 42 days):
  - Lists `primary` events with `singleEvents=true` and `orderBy=startTime` over the range, skipping cancelled events.
  - **Returns** `[{ id, title, start, end, all_day }]`. The title is `Busy` for private or confidential events, and anything on the VP calendar is left out.
  - **Caching:** `cache-control: private, max-age=60`. Nothing is stored.
- **`POST /api/google/notify`** (Google push):
  - Looks up the connection by `X-Goog-Channel-ID`.
  - Compares `X-Goog-Channel-Token` in constant time.
  - Answers 200 at once, and runs `pullChanges` in `waitUntil` unless the state is `sync`.
- **Daily cron (existing `/api/cron/sweep`):** after grading, for each sync-on tutor (within the remaining time budget), run `withGoogle` with `ensureChannel`, `pushPending` and `pullChanges`.
- **`vercel.json`:** `maxDuration` 60 for `api/google/*.js`. There are no new crons; the Hobby plan allows daily only.
- **Environment:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY` and `SITE_URL` (default `https://www.varunbaskaran.com`). Every endpoint answers 503 `{ error: 'Google Calendar is not set up yet.' }` when the Google variables are missing.

## Portal

- **`portal/js/google.js`:**
  - `getGoogleStatus()` (the `my_google_connection` RPC, cached and cleared by `invalidateGoogle()`).
  - `connectGoogle(purpose)` (POST start, then `location.assign(url)`).
  - `setGoogleSync(on)`, `disconnectGoogle()`, `syncNow()`.
  - `personalEvents(from, to)` (GET personal, cached for 60 seconds).
- **Calendar toolbar, for tutors:** a "Google Calendar" switch with a status line beside it.
  - Not connected: "Off".
  - On: "Synced 2 minutes ago".
  - Needs reconnecting: "Reconnect Google Calendar" (a danger link).
  - Turning it on while not connected starts the connect flow.
  - A "Disconnect" item sits in a small menu next to the switch.
  - Opening the calendar with sync on runs `syncNow()` once, throttled, then refreshes the store when anything changed.
- **Personal events (tutor, sync on, own calendar, Week view):**
  - **Week grid:** grey hatched read-only blocks with title and time, laid out with the sessions using the existing `layoutDay` column logic. Each block opens a small popover with title and time, and "Open Google Calendar" (`https://calendar.google.com/calendar/r/day/YYYY/M/D`).
  - **Day panel:** a "Your Google Calendar" group.
  - **Legend:** a "Personal (Google)" swatch.
  - **Where they don't show:** in Month view, and to anyone else.
- **Session form clash warning** (when the tutor books their own session with sync on): it also lists personal events that overlap ("You have Dentist in your Google Calendar then.").
- **Session drawer (staff):** "Open in Google Calendar" (`google_link`) when there is one. The tutor sees "Not synced to Google yet" when `sync_state` is pending or error and sync is on.
- **Students:**
  - **Overview "Your tutors" card and calendar toolbar:** a "Get Google Calendar invites" button, which connects with purpose student.
  - **When connected:** "Invites go to maya@gmail.com" plus "Stop invites", which disconnects.
- **Returning from Google:** a toast reads "Google Calendar connected" or "Google Calendar could not connect. Try again.", and the `google=` hash param is then removed with `replaceState`.
- **Copy and style:** the existing rules (no em or en dashes, CSP-safe, tokens).

## Errors and security

- **Lost access:** a revoked or expired refresh token pauses that tutor's sync, sets `last_error = 'reconnect'`, and shows "Reconnect Google Calendar". Pending changes wait for a reconnect.
- **Rate limits and Google outages:** changes stay pending and are retried on the next sync, notification or daily run.
- **Secrets:** refresh tokens are encrypted at rest and never leave the server. Logs carry only error names and IDs, never tokens or event text.
- **OAuth states:** single use, 10 minutes, bound to the user. `return_to` is limited to the portal.
- **Notifications:** each notification channel has its own random token, compared in constant time.
- **Personal events:** never stored, and only served to their own tutor.
- **CSP:** the connect flow is a top-level navigation to accounts.google.com, and the API calls are same-origin, so no change is needed.

## Testing

- **Unit tests (`npm test`):**
  - `crypto` round-trip and tamper rejection;
  - OAuth URL and state;
  - every mapping function and `resolveConflict`;
  - `pushPending` and `pullChanges` against an in-memory fake Calendar API and repo: insert, patch, 404 to insert, cancel to delete, tombstones, rate limit, recurring master instances, a Google-created event matched to a student, unmatched ignored, a 410 resync, conflict both ways;
  - every endpoint handler with fake dependencies (auth, role checks, 503 when not configured, notify token);
  - portal pure helpers.
- **PGlite:** the migration applies after the other 8, and the trigger checks pass:
  - a user write sets pending;
  - a service write does not;
  - an attendance edit does not;
  - a delete adds a tombstone;
  - `google_connections` cannot be read by `authenticated`;
  - `my_google_connection` returns only the caller's own row.
- **RLS suite file:** `tests/rls/google.rls.test.js` checks no access to the new tables and that the RPC is scoped. It runs once the migration is applied.
- **Local demo:** the stand-in answers `/api/google/*` and the RPC with fake data (a fake personal event set, toggle on and off, a student connect), so every screen can be seen.

## Owner setup (before it can work live)

1. **Google Cloud project:** create it, and enable the Google Calendar API.
2. **OAuth consent screen:**
   - user type: External;
   - app name: VP Education Group;
   - support email;
   - authorized domain: varunbaskaran.com;
   - a privacy policy URL;
   - the scopes listed above.
3. **OAuth client:** a Web application with the redirect URI `https://www.varunbaskaran.com/api/google/callback`.
4. **Vercel environment variables:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY` (`openssl rand -base64 32`) and `SITE_URL`.
5. **Test users:** add the tutors and students as test users while the app is in Testing. Publish to production, unverified or verified, before relying on it, because Testing tokens expire every 7 days.
6. **Migrations:** apply the three new ones in order before merging:
   1. `20261001200000_sessions.sql`
   2. `20261001200100_lesson_materials.sql`
   3. `20261002120000_google_calendar.sql`

## Not in this change

- Inviting parents.
- Reading a student's calendar.
- Google Meet links created automatically.
- Two-way sync with a tutor's main calendar (the overlay is read-only).
- Other calendar providers (Outlook, Apple).
- Choosing between more than one Google calendar per tutor.
