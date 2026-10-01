# Tutoring schedules: sessions on the calendar

Status: built on the local branch `schedules`, not deployed. The migration is not applied anywhere.

## Goal

Each student and each tutor has a schedule of tutoring sessions, shown on the portal calendar.

- **Who changes sessions:** the session's own tutor and admins schedule, move, cancel, delete, and write the recap afterwards.
- **Who sees sessions:** students and parents can view but not change. Other tutors of the same student also see the sessions, so nobody double-books.
- **Several tutors per student:** a student may have several tutors, one subject each.

Research notes (other tutoring platforms):
- **TutorBird, Teachworks, TutorCruncher, Wyzant, Varsity Tutors:** weekly series edited as "this session" or "this and following". Cancel rather than delete, with visible change states. Soft clash warnings, especially when the same student has two tutors. Color by subject, a "Next session" card, and an add-to-calendar download.
- **Teachworks, TutorBird, Varsity Tutors:** a post-session recap with attendance.
- **Deferred:** email reminders, subscribable calendar feeds, and parent change requests.

## Data (supabase/migrations/20261002120000_sessions.sql)

- **`tutor_students.subject`:** text, up to 60 characters. Admins can update it.
- **`sessions`:** one row per occurrence. Columns:
  - `id`, `student_id`, `tutor_id`, `series_id` (shared by weekly repeats)
  - `subject`, `starts_at`, `ends_at`
  - `location` (in-person place), `meeting_url` (https only)
  - `notes` (the plan, shown before)
  - `status` (`scheduled` or `cancelled`)
  - `attendance` (`present`, `late`, `absent` or null), `recap` (after the session)
  - `moved_from` (set by a trigger when `starts_at` changes)
  - `created_by`, `created_at`, `updated_at`
  - Length is greater than 0 and at most 8 hours.
- **RLS:**
  - **Read:** anyone who can see the student, plus the session's own tutor.
  - **Insert:** the tutor must be linked to the student, and the tutor is the caller or the caller is an admin.
  - **Update and delete:** an admin, or the session's tutor while still linked.
  - **Column grants:** `tutor_id` and `student_id` cannot be updated.
- **`public.student_tutors(p_student)`:** returns `{ tutor_id, full_name, subject }` for anyone who can see the student. This is "Your tutors" for families, who cannot read `tutor_students`.

## Shared code (already on the branch; use it, do not duplicate)

- **`portal/js/sessions-model.js`** (pure, unit-tested). Use these exports:
  - **Words:** `clockText`, `timeRange`, `durationMinutes`, `durationText`, `sessionTitle`, `shortDayText`, `movedNote`, `sessionAria`.
  - **State:** `sessionState(s, now)`, which returns `{ key, label, tone }` with key `cancelled | now | moved | scheduled | attended | late | missed | finished`; `isCancelled`; `canEditSession(s, me)`.
  - **Subject color:** `toneClass(subject)` returns `subj-0`…`subj-5` or `subj-none`. Put the class on the element and read `var(--subj-bg)`, `var(--subj-text)` and `var(--subj-solid)`, which are defined in app.css for light and dark. `subjectLegend(list)` gives the legend.
  - **Lists:** `sortSessions`, `sessionsByDay` (Map by Pacific day), `upcomingSessions(list, now, { limit, days })`, `recentChanges(list, since, now)`, `followingInSeries(list, s)`.
  - **Week grid:** `weekStartKey`, `weekKeys`, `weekTitle`, `hourRange`, `layoutDay`. `layoutDay` returns `{ session, top, height, col, cols }`, with fractions of the shown hours.
  - **Clashes:** `overlaps`, `findClashes(candidate, list, { ignoreIds })`, which returns `[{ session, who: 'tutor' | 'student' | 'both' }]`.
  - **Form:** `timeInput(iso)` gives 'HH:MM' Pacific; `addMinutesToTime`; `validateSessionForm(raw, { creating })` returns `{ ok, errors, values }`; `weeklyTimes({ date, start, end, weeks })`; `retimeRows(rows, edited, { date, start, end })`; `newSeriesId()`.
  - **Export:** `toIcs(sessions, { names, now })`.
- **`portal/js/store.js`:**
  - `getSessions(studentId)` and `getTutors(studentId)`, both cached and both cleared by `invalidate(studentId)`.
  - `getWorkspace()` now also returns `sessions` (every session the viewer can read) and `links` (tutor_students rows the viewer can read, with subject).
  - `SESSION_FIELDS`.
- **Names:** `staffNames()` in updates-feed.js returns a Map of tutor and admin ids to names. Use it for tutor names everywhere, families included, because families cannot read tutor profiles. Student names come from the workspace students or the scope.
- **View ctx (app.js):**
  - `ctx.openSession(id)` opens the drawer at `open=s<id>`.
  - `ctx.openNewSession({ due: 'YYYY-MM-DD', at: 'HH:MM' })` opens `open=new-session&due=…&at=…`.
  - `ctx.me` is `{ id, role }`. `ctx.audience` is `'staff'` or `'family'`. `ctx.scope?.student` is the current student, and `ctx.readOnly` is also available.
  - `ctx.route.params.scope === 'all'` marks the staff all-students calendar.
- **Drawer:**
  - `drawer.js` passes `dctx.taskId` through. It is `'s<id>'` for a session and `'new-session'` for the create form.
  - `item-drawer.js` `renderItemDrawer` must dispatch these to the session drawer.
  - The router drawer params are `open, focus, kind, due, at`.
- **"New" marker:** families see "New" on Calendar when a session moved or was cancelled since they last opened the calendar. `app.js` computes `fresh.schedule` from `getSeen('schedule', me.id, studentId)`. The calendar view must call `markSeen('schedule', ctx.me.id, studentId, ctx.now)` for families, then `ctx.refreshNav?.()`.
- **Subject tokens:** `.subj-N` classes in app.css.

## Rules every change follows

- **Building elements:** vanilla ES modules and no build step. Use `h()` from dom.js. Never use innerHTML, inline `style=""` attributes or inline handlers, because the CSP forbids them. Positioning uses `el.style.setProperty('--x', …)` (CSSOM is allowed).
- **Copy:** never use em or en dashes in UI text or comments (tests enforce this). Use plain words: "4:00 to 5:00 pm". Apostrophes in copy use ’ as elsewhere.
- **Times:** always Pacific, through sessions-model and dates.js. Add " PT" only when the viewer's clock differs (timeRange handles it).
- **Accessibility:**
  - Every control is a real button or link with a name.
  - Session blocks and chips have `aria-label` from `sessionAria`.
  - Focus keys use `data-focus-key`. Session rows use `row-s<id>`, so the drawer can return focus.
  - Targets are at least 44px on touch.
- **Read-only:** students and parents never see edit controls, and RLS also enforces this. Staff see edit controls only when `canEditSession` is true. Another tutor's session for the same student is read-only for them.
- **Styling:** reuse the existing CSS tokens and components (`button`, `iconButton`, `segmented`, `select`, `field`, `pill`, `menu`, `emptyState`, `rowList` in ui.js and overlays.js). New CSS goes in `portal/css/sessions.css`, linked from student.html, parent.html and staff.html.
- **Tests:** `npm test` must pass. Add unit tests for any new pure logic.

## Calendar (views/calendar.js, calendar-model.js, calendar.css)

- **Views:** Week, Month and List. Week is the default at 768px and up, and List below it.
  - The stored choice still wins, through `vb-cal-view`.
  - `resolveState` gains `view: 'week'` plus a `w` param, the week's Sunday key.
- **Week view:**
  - **Toolbar:** the toolbar title is `weekTitle`, with previous week, next week and Today.
  - **Day headers:** day headers show weekday and date, with today highlighted.
  - **All-day row:** the due items (assignments and tasks) for each day, as small chips that open their drawer, as Month does.
  - **Time grid:**
    - Rows are hours from `hourRange` across the visible week's sessions.
    - Session blocks are absolutely positioned using `--top`, `--height`, `--col` and `--cols`, set with style.setProperty.
    - Each block shows the time, the subject, and "with <tutor>" for families or the student's name for staff all-scope. A small icon shows online or in person.
    - A tone class gives the subject color. Cancelled sessions are struck through and hatched or faded. Moved sessions get a small "Moved" tag.
    - Clicking a block calls `ctx.openSession(id)`.
  - **Now line:** a "now" line appears on today's column.
  - **Creating:** staff who are not read-only can click or press Enter on an empty hour slot to call `ctx.openNewSession({ due: key, at: 'HH:00' })`.
  - **Phones:** below 768px, the week view shows a day-by-day list of the week's sessions and due items instead of the grid.
- **Month view:**
  - Each day cell shows session chips before due chips, using the existing chip capacity.
  - A session chip shows the start time and subject, with a subject tone and a struck-through style when cancelled.
  - Phone dots include sessions.
  - The day panel shows a "Sessions" list, then the existing due rows. Its empty state offers "New session" for staff.
- **List view:** each day group lists that day's sessions, sorted by time, before its due rows.
- **Toolbar:**
  - A subject legend shows the subjects present in the view, as a tone swatch plus name. Hide it when there is only one subject.
  - Staff who are not read-only get a "New session" button that opens `openNewSession` for today, or for the selected day in Month.
  - **Workspace all-students calendar (scope=all):**
    - A tutor gets a segmented "My sessions / All", defaulting to My sessions, where My sessions means `tutor_id === me.id`.
    - An admin gets a select of all tutors (from `ws.links` and `staffNames()`) with "All tutors" first.
    - Due items stay as today.
- **Data:**
  - In a student scope, use `ctx.store.getSessions(student.id)`.
  - In scope=all, use `ws.sessions` with student names from `ws.students`.
  - Use `staffNames()` for tutor names.
- **Families:** on mount, mark 'schedule' as seen (see above). The calendar lede for families can read "Your sessions and due dates."
- **Keyboard:** the month grid's roving focus stays as is. Week grid blocks are buttons in DOM order (day, then time). Empty-slot creation is reachable with Tab only for staff, through one "New session" button per day column header, not 15 hour buttons per day.

## Session drawer (new: session-drawer.js, session-form.js; edits: item-drawer.js dispatch, HTML css links)

- **Details (open=s<id>):**
  - **Header and title:** a state pill (`sessionState`) and the title (`sessionTitle`) with a subject tone dot.
  - **When:** "Tuesday, October 6", the `timeRange`, and the duration.
  - **People:** the tutor (avatar and name). For staff, the student too.
  - **Where:**
    - An in-person location; online shows a "Join online" button that opens `meeting_url` in a new tab with rel noopener.
    - A tutor can still change the place before a session.
  - **Plan:** the notes. A cancelled session shows a callout. A moved session shows `movedNote`.
  - **After it ends:** attendance and recap ("Session notes"), visible to families.
  - **Series:** "Repeats weekly" when `series_id` is set, plus how many sessions are left.
  - **Add to calendar:** downloads an .ics file built with `toIcs` through a Blob and an `a[download]` click (no navigation). For a series, a second option "Add the rest of the series".
- **Loading:**
  - The session comes from `getSessions(studentId)` when the scope has the student. Otherwise it comes from the workspace sessions (staff all-scope or Today), then `getSessions`.
  - A missing or unreadable session shows the same "isn’t available" pattern as tasks.
- **Staff with canEditSession get a menu** (`menu` in overlays.js, in `dctx.headerActions`):
  - "Edit session"
  - "Write session notes" (after start)
  - "Cancel session" or "Restore session"
  - For a series: "Cancel this and following"
  - "Delete session" (confirm), and for a series "Delete this and following" (confirm)
  - Updates use `.select('id')` and treat zero rows as "changed or removed" (the existing GONE wording).
  - After a write: `dctx.store.invalidate(studentId)`, a toast, and the drawer re-renders.
- **Create (open=new-session):** a staff-only form (session-form.js) with these fields:
  - **Student:** a select when the route is scope=all, otherwise the scope student.
  - **Tutor:** admin only. A select of the tutors linked to the chosen student, from `ws.links` or `getTutors`, defaulting to the first. A tutor always books as themselves and must be linked.
  - **Subject:** defaults to the link's subject for that tutor and student. Free text with a `<datalist>` of the student's subjects.
  - **Date:** prefilled from `due`, or today.
  - **Start:** prefilled from `at`, or 16:00.
  - **End:** start plus 60 minutes, with quick duration buttons for 30, 45, 60, 90 and 120.
  - **Where:** a segmented "In person / Online". In person shows Location (default empty); Online shows the meeting link.
  - **Plan for the session:** the notes field.
  - **Repeat weekly:** a checkbox, plus "for N weeks" (2 to 26, default 8).
  - **Clash warning:** a live, non-blocking warning callout that lists clashes from `findClashes`. It uses `getSessions(student)` and the workspace sessions for the tutor. It says "Daniel Ortiz already has Leo Park at 4:00 to 5:00 pm" or "Maya Lin has SAT Reading with Priya Shah then". The tutor can still save.
  - **Saving:** insert all rows in one `insert([...]).select('id')`, with `series_id` from `newSeriesId()` when repeating. Errors show in a danger callout. After saving, the drawer opens the new session (`dctx.go` to `open=s<firstId>`, replace) and shows a toast "Session scheduled" or "8 sessions scheduled".
- **Edit:** the same form without Repeat. For a series, a segmented "Apply to: This session / This and following" appears.
  - This and following uses `followingInSeries` and `retimeRows` for the times. Subject, location, link and notes are copied to each row (one update per row, in sequence; stop on the first error).
  - The clash warning ignores the rows being edited.
- **Session notes form:** attendance as a segmented "Present / Late / Absent", plus a recap textarea. Saving updates only `attendance` and `recap`.

## Other surfaces

- **Overview, student and parent (views/overview.js `mountStudent` and `mountParent`):**
  - **"Upcoming sessions" card:** the next 3 sessions from `upcomingSessions`.
    - Each row shows a date block, the time, the subject tone, "with <tutor>", and a "Join" link when online. Clicking opens the session drawer (ctx.openSession).
    - It also shows moved and cancelled changes since the family last looked (`recentChanges` with the 'schedule' seen time) as small notes, for example "Thursday’s Algebra moved to Friday at 4:30 pm".
    - Empty state: "No sessions scheduled."
  - **"Your tutors" card:** `getTutors(studentId)` gives each tutor's avatar, name and subject. For a parent, "Maya’s tutors".
- **Overview, staff student scope (`mountStaff`):** a compact "Next session" line or card for that student.
- **Today (views/today.js, tutor and admin):**
  - A "Today’s sessions" card at the top. It lists the viewer's sessions today from `ws.sessions` (admin: all), with time, student, subject and place.
  - The next upcoming session is highlighted, and a session happening now gets a "Now" pill. Each row opens the session.
  - It also shows a "Needs notes" count of the tutor's past sessions from the last 7 days with no attendance, linking to the calendar list.
- **Students table (views/students.js):**
  - A "Next session" column with the date and time, or "None".
  - A "Tutors" line under each name with the subject chips (from `ws.links` and staffNames).
- **People (views/people.js `linkGroup` for tutors):**
  - Each tutor chip shows the subject ("Daniel Ortiz, Algebra").
  - A small inline subject text input per tutor link saves on change or Enter: `update({ subject }).eq('tutor_id', …).eq('student_id', …).select('tutor_id')`.
  - Adding a tutor also offers an optional subject field.
  - Labels say "Subject Daniel Ortiz teaches Leo Park".

## Demo

A local demo with an in-memory stand-in for Supabase (sample data, the same access rules) is served on port 4178 by the `schedules-demo` launch config. Its seed:
- **Maya:** Algebra with Daniel Ortiz (Tue and Thu, 4:00 to 5:00 pm, in person) and SAT Reading with Priya Shah (Sat, 10:00 to 11:30 am, online). The next Thursday moved to Friday 4:30, and the next Saturday is cancelled. Recent past sessions have attendance and recaps.
- **Leo:** Math with Daniel (Mon and Wed).
- **Ava:** English with Priya (Wed, online).
- **Personas:** `?as=student` is Maya, `?as=parent` is Grace (Maya's mother), `?as=tutor` is Daniel, `?as=tutor2` is Priya, and `?as=admin`.

## Not in this change (recommended next)

- Email or SMS reminders 24 hours ahead, and an email on move or cancel (needs an email provider).
- A per-family subscribable .ics feed with a secret token.
- Parents requesting a change.
- Tutor availability and self-booking.
- A subject on assignments, tasks and updates, with filters.
- Bulk assignment to several students.
- Multi-page homework submissions.
- A tutor contact card for families.
