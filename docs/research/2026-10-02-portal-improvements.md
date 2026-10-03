# Portal improvements: research and audit

October 2026. These findings come from two sources:
- A review of how tutoring and school platforms work: TutorBird, Teachworks, TutorCruncher, Wise, Oases, Wyzant, Varsity Tutors, Outschool, Google Classroom, Canvas Parent, ClassDojo, Remind, My Music Staff, Jackrabbit, Acuity and Calendly.
- An audit of the four portals (admin, tutor, student, parent) as they are on main.

## Built on the `schedules` branch (local, not deployed)

- **Sessions on the calendar.** Tutors and admins schedule, move, cancel and delete them; students and parents view only.
  - Several tutors can teach one student, one subject each.
  - Sessions are colored by subject.
  - There are Week, Month and List views.
  - Moves are shown as "Moved from Thu 4:00 pm".
  - Cancelled sessions stay visible, struck through.
- **Weekly series.** A tutor creates N weeks at once, then edits "this session" or "this and following". This is the TutorBird and Google Calendar pattern.
- **Clash warnings.** Teachworks-style soft warnings when the tutor or the student is already booked, which matters most when a student has two tutors. The tutor can still save.
- **Session notes and attendance.** Present, late or absent, plus a recap that families can read. Teachworks, TutorBird and Varsity Tutors all do this after each lesson.
- **Add to calendar.** An .ics download for one session or the rest of a series.
- **Families:**
  - Overview shows an "Upcoming sessions" card with Join links for online sessions.
  - A "Your tutors" card shows each tutor's subject.
  - A "New" marker on Calendar appears when a session moved or was cancelled.
- **Tutors and admins:**
  - Today shows "Today’s sessions" and counts past sessions that still need notes.
  - The Students table gains a Next session column and tutor subject chips.
  - The People page sets a subject on each tutor link.

## Recommended next, ranked by value for effort

| # | Improvement | Why | Effort |
|---|---|---|---|
| 1 | Email on a new, moved or cancelled session, plus a reminder 24 hours before | Every tutoring platform does this. A calendar alone does not tell a family that Thursday moved. Needs an email provider (Resend or Postmark); the Supabase sign-up emails need one anyway. | Medium |
| 2 | Subject on assignments, tasks and updates | With two tutors, the math tutor currently sees English essays in the review queue, parents see updates from both tutors mixed together, and there is one blended score trend. Add a subject (defaulting from the tutor's link), subject filters, and a trend per subject. | Medium |
| 3 | Multi-page homework (several photos in one submission) | A 3-photo worksheet becomes 3 attempts today, uses up the 5-attempt cap, and only the last photo is reviewed. | Medium |
| 4 | Tutor contact for families | The portal tells students to "message your tutor" but never shows who the tutor is or how to reach them. The new "Your tutors" card shows names and subjects. Adding an email link, or a reply thread on updates, closes the loop. | Small, then large |
| 5 | Admin business overview | Show active students, students with no tutor or parent, drafts waiting over 48 hours, and students with no submission in 14 days. Add a Tutors column and filters on Students. | Medium |
| 6 | Weekly parent digest email | In the style of Google Classroom guardian summaries: this week's sessions, work due, missing work and the tutor's note. | Medium (after 1) |
| 7 | Subscribable calendar feed | A per-family secret .ics link that Google or Apple Calendar keeps in sync. Calendar apps refresh a feed only every 12 to 24 hours, so it supplements email rather than replacing it. | Medium |
| 8 | Bulk assign and templates | A tutor with 15 students retypes the same assignment 15 times, and cannot attach a worksheet file. | Medium |
| 9 | Parent "request a change" for a session | Following Wyzant: the parent asks, the tutor approves or declines. Add a cancellation window later. | Medium |
| 10 | Several children per parent | A "Family" home with one card per child, and "New" badges on the child switcher. Today, a second child's overdue work is invisible until the parent switches to that child. | Medium |

## Smaller fixes worth doing

- **Signup notes:** show `signup_note` after approval. It often names the child, which the admin needs in order to link a parent.
- **Name fixes:** let admins fix a person's name, and archive a leaver.
- **Grades for students:** show the score history to students. Only parents and staff see the trend today.
- **Parent overview on phones:** the tutor's note and overdue work come after three metrics and a chart on a 375 px screen.
- **Workspace size:** `getWorkspace()` loads every task and submission for the business and reloads after every write. It will slow down past roughly 50 students; use a summary query.

## Deferred on purpose

- **Payments and invoices:** table stakes for tutoring software, but outside this portal's job for now.
- **SMS:** costs money per message. Email first.
- **Tutor availability and family self-booking:** large. Revisit once families ask for it.

## Sources

[TutorBird](https://support.tutorbird.com/en/articles/115-how-do-i-edit-the-details-or-attendees-of-an-existing-lesson-or-event), [Teachworks calendar](https://www.teachworks.com/features/calendar), [Teachworks conflict checker](https://blog.teachworks.com/2022/04/avoid-scheduling-clashes-with-the-conflict-checker/), [Teachworks calendar feeds](https://blog.teachworks.com/2017/02/calendar-feeds-in-teachworks/), [TutorCruncher scheduling](https://tutorcruncher.com/features/calendar-and-scheduling), [Wise reminders](https://www.wise.live/automated-session-reminders/), [Wyzant scheduling](https://support.wyzant.com/tutors/lessons/how-do-i-schedule-a-lesson/), [Outschool calendar sync](https://support.outschool.com/en/articles/614870-syncing-your-calendar), [Google Classroom guardian summaries](https://support.google.com/edu/classroom/answer/6386354?hl=en), [My Music Staff attendance and notes](https://www.mymusicstaff.com/calendar-attendance-lesson-notes-oh-my/), [Jackrabbit absences](https://help.jackrabbitclass.com/help/settings-for-absences-makeups-in-parent-portal), [Calendly time zones](https://help.calendly.com/hc/en-us/articles/14078163170071-Time-Zones-overview), [Tutorbase parent portal comparison](https://tutorbase.com/blog/best-tutoring-software-with-parent-portal).
