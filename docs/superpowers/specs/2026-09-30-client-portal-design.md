# Client portal: admin, tutor, student, parent

## Context

VP Education Group's site is a static marketing page on Vercel (`main`). A homework grader exists on the `homework-submission` branch (draft PR varunbask/website#1): Express + SQLite + local uploads + an OpenAI-compatible vision grader, with a student upload page, a tutor list, and (commit `7fa498e`, Sep 29) a "Log in" header button plus a Student/Tutor login page. It can't deploy where the site lives, and it only knows two roles.

The goal is a client-facing portal with four account types:
- **Admin** picks a student and sees everything about them. Also approves sign-ups, assigns tutors to students, and links parents to students.
- **Tutor** sees only the students the admin assigned them. Creates tasks and assignments for those students, reviews AI grades, and posts progress updates.
- **Student** sees assignments (with due dates) and tasks. Checks off tasks, submits homework to the AI grader, and sees released grades.
- **Parent** sees the same things as their child, read-only, plus a dashboard with progress and the updates tutors post.

Decisions (from you):
- Supabase for data, files, and auth; the grader moves to Vercel functions.
- Public sign-up, then admin approval.
- A tutor reviews each AI grade before a student or parent can see it.
- The portal is English only for now.

## Architecture

- **Data:** Supabase Postgres in the existing project (`enwrankobjdivyxhmwus`). Row-level security on every table does the access control, so the browser talks to Supabase directly with the public anon key.
- **Files:** a private Supabase Storage bucket `homework`, with paths `{student_id}/{uuid}.{ext}`. The browser uploads straight to Storage, because Vercel functions cap request bodies at 4.5 MB. Photos are shrunk in the browser first (2000 px long edge, JPEG 0.85). That keeps well inside the 1 GB free tier and still reads handwriting.
- **Grading:** `POST /api/grade` (Vercel function) verifies the caller and claims the submission with a compare-and-set, answers 202, and grades in the background with `waitUntil`. It downloads the file with the service role key and extracts PDF text with `unpdf` (small, serverless-safe; replaces `pdf-parse`). It adds the assignment's title and instructions to the prompt and writes a **draft** grade. An hourly Vercel cron (`/api/cron/sweep`, protected by `CRON_SECRET`) retries stuck or transiently failed rows, up to 3 attempts. Permanent failures, such as a scanned PDF with no text, stop at `failed` with a readable message. A tutor can press Retry.
- **Frontend:** vanilla ES modules under `portal/`, no build step, same styles.css tokens and fonts. Ruled lines, not card boxes. No eyebrows, no em dashes. supabase-js is loaded as a pinned UMD build with an SRI hash. User text is rendered with `textContent` only, and there is a CSP header on `/portal/*`.
- **Retired:** Express, knex, SQLite, multer, node-cron, `src/`, `dashboard/`, `submissions/`, `login/`, `app-auth.js`, `app-config.js`.

## Data model (Supabase migrations)

| Table | Purpose / key rules |
|---|---|
| `profiles` | One per auth user, created by a trigger on sign-up. `role` enum: pending/student/parent/tutor/admin, default `pending`. `requested_role` and `signup_note` are hints for the admin only, never copied into `role`. Only an admin can change a role, and an admin can't demote themselves. |
| `tutor_students`, `parent_students` | Many-to-many links, admin-only writes. Inserts check that each side really has the right role. |
| `tasks` | `kind` is `assignment` (submittable, due date) or `task` (checkbox). Staff who teach the student create, edit and delete. Students have no UPDATE; they call the RPC `set_task_done(id, done)`, which only works on their own `task` rows. An assignment is marked complete by a trigger when work is submitted. |
| `submissions` | Students can insert only `(task_id, storage_path, file_type, note)`. `student_id` defaults to `auth.uid()`. The file must exist in their own folder. Maximum 5 per assignment. `status` goes pending → grading → ai_graded / failed, and only the grader (service role) changes it. `attempts` and `status_changed_at` drive retries. |
| `grades` | One row per submission, created by a trigger. The AI writes its draft into `score` and `feedback` with `released_at` null. Students and parents can **select a row only when `released_at` is not null**; staff see drafts. A trigger stamps `reviewed_by`/`reviewed_at` when a person edits. |
| `updates` | A tutor or admin posts to a student. Parents always see them; the student sees them only if `visible_to_student`. |

Helper functions (`my_role`, `is_admin`, `has_role`, `can_teach`, `can_view_student`, `can_view_student_folder`, `can_submit`) are `security definer` with an empty `search_path`, in a `private` schema so they aren't exposed as RPCs. Column-level grants plus RLS on every table. `staff_names()` RPC returns tutor names only (no emails) for "from Ms. X" labels. The full SQL, policies, and API contract are in the implementation plan, `docs/superpowers/plans/2026-09-30-client-portal.md`.

## Pages

| Page | Who | Contents |
|---|---|---|
| `portal/index.html` | everyone | Sign in; sign up (full name, "I am a student / parent / tutor", optional note such as the child's name); forgot password; "waiting for approval" screen for pending users; routes signed-in users by role. |
| `portal/reset.html` | everyone | Set a new password from the email link. |
| `portal/staff.html` | tutor, admin | Student picker (tutors see only their assigned students; each student shows a count of drafts waiting for review). Workspace for the selected student: tasks and assignments (create, edit, delete, due dates); submissions (open the file through a signed URL valid for 10 minutes (staff only; the page signs again when a link gets old), edit the draft score and feedback, release or unrelease, retry); updates (compose, with a "share with student" toggle); progress panel. |
| `portal/people.html` | admin | Waiting list (requested role and note), set role, assign tutors, link parents. |
| `portal/student.html` | student | Tasks with checkboxes; assignments with due dates (overdue in red); submit homework per assignment; released grades and feedback; updates shared with the student. |
| `portal/parent.html` | parent | Child switcher (shown only when there is more than one child). Progress dashboard: completion rate, on-time rate, and score trend as an SVG chart with a fallback table. Updates feed. Below that, the student view read-only (the same module with `readOnly`). |

Shared modules in `portal/js/`: `config.js` (public URL and anon key), `theme-boot.js`, `supabase.js`, `session.js` (session plus role guard and redirect), `dom.js`, `data.js`, `progress.js` (pure metric functions, unit-tested), `upload.js` (validate, shrink, path), `student-view.js`, `staff.js`, `people.js`, `parent.js`. Styles go in `portal/portal.css`.

Marketing site: keep your "Log in" header button and its five translations (from `7fa498e`); only its `href` changes from `login/` to `portal/`. Bump the `?v=` query strings. `theme.js` gets a guard so it works on pages without `VB_I18N`.

## Server files

- `api/grade.js`, `api/cron/sweep.js`: thin wrappers.
- `api/_lib/` (the underscore keeps these from becoming endpoints):
  - `supabase.js`: service client and bearer check
  - `repo.js`: the only Supabase I/O, faked in tests
  - `content.js`: file-type sniffing, unpdf, text/image content
  - `grader.js`: keeps `RESULTS_FORMAT` and `parseResults` from the current grader; adds a `<student_work>` wrapper against prompt injection, per-attempt timeout, and transient vs permanent errors
  - `http.js`: the who-may-grade matrix
- `vercel.json`: function durations, the hourly cron, and CSP/security headers for `/portal/*`.
- `.vercelignore`: keeps tests, migrations, docs and `.env` off the public site. No `build` script.
- `package.json`: ESM, with `@supabase/supabase-js`, `@vercel/functions`, `unpdf`, and vitest as a dev dependency.

## Tasks (in order)

1. **Branch and cleanup.**
   - Create `client-portal` from the current tip of `homework-submission` in a worktree, then merge `main` (combine both `.gitignore` files and add `.env*.local`).
   - Delete the retired Express/SQLite code and the old pages. Add `package.json`, `vercel.json`, `.vercelignore` and the vitest configs.
   - Port `RESULTS_FORMAT`, `parseResults` and their tests into `api/_lib/grader.js`.
2. **Migrations:** `portal_schema.sql` and `homework_storage.sql` under `supabase/migrations/`. *(You run `supabase db push`; it asks for the DB password.)*
3. **RLS integration suite** (`npm run test:rls`). It runs against the linked project using throwaway users made with the service role key, cleans up after itself, and has a leftover-cleanup script. It covers:
   - a pending user sees nothing
   - a student can't see another student
   - no unreleased grade leaks, including through embeds
   - a parent sees only a linked child
   - an unassigned tutor sees nothing
   - nobody escalates their role
   - helper functions aren't callable as RPCs

   This must pass before any UI work. *(You add `SUPABASE_SERVICE_ROLE_KEY` to `.env`.)*
4. **Grader core:** `content.js`, `grader.js`, `repo.js` plus unit tests and PDF fixtures (text PDF, scanned PDF).
5. **API endpoints:** `grade.js`, `sweep.js`, `http.js` plus unit tests for the whole auth matrix. *(You set the Vercel env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LLM_ENDPOINT`, `LLM_KEY`, `LLM_MODEL`, `CRON_SECRET`.)*
6. **Portal foundation:** shared JS modules, `portal.css`, `portal/index.html`, `reset.html`, the `theme.js` guard, and the header `href` change. *(You add the site URL and redirect URLs in Supabase Auth settings.)*
7. **Admin People page.**
8. **Staff workspace A:** picker, tasks and assignments, updates.
9. **Staff workspace B:** submissions, signed URLs, review/edit/release, Retry.
10. **Student view:** tasks, assignments, the submit flow, released grades.
11. **Parent view:** switcher, progress metrics and chart, updates, read-only student view.
12. **Launch prep:** `/security-review` on the branch diff; the launch checklist below; open a PR that supersedes #1 (closing #1 only with your OK).

**How it gets built** (per your preference): after approval I write the detailed implementation plan to `docs/superpowers/plans/2026-09-30-client-portal.md`, with every task fully specified (SQL, code, tests). Then I run subagent-driven development with Sonnet implementers and reviewers, including a final whole-branch review. I do the browser verification myself.

## Things only you can do

- Run `supabase db push`; it needs the database password.
- Put `SUPABASE_SERVICE_ROLE_KEY` in the local `.env` and in Vercel (marked Sensitive). It never goes in `portal/`, and a unit test fails the build if a secret key shows up there.
- **Before launch, set up an email provider** (Resend, Postmark or SES) in Supabase Auth. The built-in sender only reaches your own team's addresses, 2 per hour, so public sign-up won't work without it.
- Make yourself admin once: sign up at `/portal/`, then run `update public.profiles set role = 'admin' where email = '<your email>';` in the Supabase SQL editor.
- When browser checks need a signed-in role, you sign in to the seeded test accounts in the browser pane. I don't type passwords for the remote Supabase auth.

## Operational notes

- **Supabase free tier:** pauses after 7 days idle (the hourly cron should keep it awake), 1 GB storage, no backups. Move to Pro ($25/mo) once real client data is in.
- **Vercel Hobby** is for non-commercial use under Vercel's terms, so a paying-client portal is a reason to move to Pro. Hobby crons run once a day, so the hourly retry cron needs Pro.
- **Minors' homework goes to an AI provider.** Use one that doesn't train on API data, and say so in a short privacy note. Tutor review before release is the main safeguard against bad or injected grades.
- **Parallel work:** `7fa498e` landed on `homework-submission` during this session. If another session is still working on that branch, pause it before task 1 so the branches don't diverge.

## Verification

- `npm test`: unit tests pass (grader, content, API auth matrix, progress metrics, upload validation, no-secrets check).
- `npm run test:rls`: every RLS case passes against the linked project, and test users are cleaned up.
- **Supabase dashboard:** Advisors > Security shows nothing beyond the two intentional public RPCs.
- **Vercel preview deploy** (I'll ask before deploying):
  - curl `/api/grade`: no token gives 401, bad body gives 400
  - curl `/tests/…`, `/supabase/migrations/…`, `/api/_lib/grader.js`: all 404
  - one real PNG, PDF and TXT submission each reaches "AI draft"
- **Browser pass, every role:**
  - A new sign-up shows "waiting for approval". The admin approves it and links a parent and a tutor.
  - The tutor creates an assignment and a task; the student sees both, checks off the task, and submits a photo.
  - The tutor sees the draft, edits it, and releases it. Before release the student and parent see "Submitted"; after it they see the score.
  - The parent's dashboard shows completion, on-time rate, the score trend, and a posted update.
  - Checked at 375, 768 and 1280 px, in light and dark mode.
- **Marketing site:** "Log in" opens `/portal/`, and nothing else on the home page changes (diff against main shows only the `href` and `?v=` changes).
