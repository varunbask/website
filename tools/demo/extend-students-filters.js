/* Demo extension: Students page filters and sorting (portal/js/views/students.js).
   Loaded by the local demo build right after demo-supabase.js. The base demo has
   only five students, too few to see the filters work, so this adds seven more,
   each linked to a tutor, with a mix of waiting reviews, overdue work, lessons
   and results (Completed or Missing; the 30-day completion column counts them,
   and work never handed in that is past due as missing).

   Try it
     ?as=admin    eleven students, the Tutor select, and every chip
     ?as=tutor    Daniel Ortiz's seven students, no Tutor select
     ?as=tutor2   Priya Shah's five students

   What each added student shows
     Noah Kim        Daniel   2 to review, overdue, lesson in 3 days, completed 1 of 2
     Zoe Patel       Daniel   no lesson booked, 1 overdue task, completed 0 of 1
     Ethan Wu        Priya    first lesson in 20 days (still "no lesson booked"), completed 2 of 2
     Sofia Rossi     Priya + Daniel   1 to review, lesson tomorrow, completed 1 of 1
     Liam O'Brien    Daniel   brand new: no work, no results, lesson in 5 days
     Isabella Nguyen Priya + Daniel   2 overdue, lesson in 13 days (last day of the window), completed 0 of 4
     Owen Clark      admin    nothing booked, nothing due */
(function () {
  'use strict';
  if (!window.portalDemo) return;
  const { helpers: h } = window.portalDemo;

  const profiles = [];
  const links = [];
  const tasks = [];
  const submissions = [];
  const grades = [];
  const sessions = [];

  const student = (key, name, email, createdDays = 30) => {
    const id = `u-${key}`;
    profiles.push({
      id, full_name: name, email, role: 'student', requested_role: null, signup_note: null, no_login: false, created_at: h.ago(createdDays),
    });
    return id;
  };
  const link = (tutor, studentId, subject) => links.push({ tutor_id: tutor, student_id: studentId, subject, created_at: h.ago(30) });

  const task = (studentId, kind, title, offset, { by = 'u-daniel', done = false } = {}) => {
    const row = {
      id: h.id(), student_id: studentId, created_by: by, kind, title, details: null,
      due_at: offset === null ? null : h.dueAt(offset), completed_at: done ? h.ago(1) : null, created_at: h.ago(14),
      session_id: null, series_id: null,
    };
    tasks.push(row);
    return row;
  };

  // A handed-in assignment. Without released, the grade is an AI draft waiting for review.
  // result: 'completed' or 'missing'
  const handIn = (t, { daysAgo, result, released = false }) => {
    const sub = {
      id: h.id(), student_id: t.student_id, task_id: t.id, storage_path: null, file_type: null, note: null,
      status: 'ai_graded', attempts: 1, error: null, status_changed_at: h.ago(daysAgo, '19:30'), created_at: h.ago(daysAgo, '19:00'),
      body: 'Worked answers typed in the portal.', body_doc: null,
    };
    submissions.push(sub);
    grades.push({
      submission_id: sub.id, student_id: t.student_id, result, score: null,
      feedback: result === 'missing' ? 'Most of this is blank. Try each problem, then hand it in again.' : 'Solid work. Check the units on the last two.',
      reviewed_by: released ? 'u-daniel' : null, reviewed_at: released ? h.ago(daysAgo - 0.5) : null,
      released_at: released ? h.ago(Math.max(0, daysAgo - 1)) : null,
    });
    return sub;
  };

  const session = (studentId, tutor, subject, offset, { start = '16:00', end = '17:00' } = {}) => {
    const past = offset < 0;
    sessions.push({
      id: h.id(), student_id: studentId, tutor_id: tutor, series_id: null, subject,
      starts_at: h.pt(offset, start), ends_at: h.pt(offset, end), location: null, meeting_url: 'https://meet.google.com/demo-students',
      notes: null, status: 'scheduled', attendance: past ? 'present' : null, recap: past ? 'Reviewed homework and new material.' : null,
      moved_from: null, changed_at: null, created_by: tutor, created_at: h.ago(40), updated_at: h.ago(40), cancelled_at: null,
      google_event_id: null, google_link: null, sync_state: 'synced',
    });
  };

  // Noah Kim: two drafts to review, one overdue assignment, a lesson in 3 days
  const noah = student('noah', 'Noah Kim', 'noah.kim@example.com');
  link('u-daniel', noah, 'Geometry');
  handIn(task(noah, 'assignment', 'Triangle proofs', -2), { daysAgo: 1, result: 'missing' });
  handIn(task(noah, 'assignment', 'Area and perimeter set', -4), { daysAgo: 2, result: 'completed' });
  handIn(task(noah, 'assignment', 'Angle relationships', -12), { daysAgo: 9, result: 'completed', released: true });
  task(noah, 'assignment', 'Similar figures worksheet', -3);
  session(noah, 'u-daniel', 'Geometry', 3);
  session(noah, 'u-daniel', 'Geometry', -4);

  // Zoe Patel: no lesson booked, one overdue task, a released Missing
  const zoe = student('zoe', 'Zoe Patel', 'zoe.patel@example.com');
  link('u-daniel', zoe, 'SAT Math');
  handIn(task(zoe, 'assignment', 'SAT Math practice 3', -8), { daysAgo: 7, result: 'missing', released: true });
  task(zoe, 'task', 'Book a practice test date', -5);
  session(zoe, 'u-daniel', 'SAT Math', -16);

  // Ethan Wu: everything completed, nothing due, next lesson is 20 days out
  const ethan = student('ethan', 'Ethan Wu', 'ethan.wu@example.com');
  link('u-priya', ethan, 'Chemistry');
  handIn(task(ethan, 'assignment', 'Stoichiometry set', -10, { by: 'u-priya' }), { daysAgo: 10, result: 'completed', released: true });
  handIn(task(ethan, 'assignment', 'Gas laws quiz', -6, { by: 'u-priya' }), { daysAgo: 5, result: 'completed', released: true });
  task(ethan, 'assignment', 'Equilibrium reading questions', 9, { by: 'u-priya' });
  session(ethan, 'u-priya', 'Chemistry', 20);
  session(ethan, 'u-priya', 'Chemistry', -10);

  // Sofia Rossi: two tutors, one draft to review, a lesson tomorrow
  const sofia = student('sofia', 'Sofia Rossi', 'sofia.rossi@example.com');
  link('u-priya', sofia, 'English');
  link('u-daniel', sofia, 'Spanish');
  handIn(task(sofia, 'assignment', 'Book report outline', -1, { by: 'u-priya' }), { daysAgo: 1, result: 'completed' });
  handIn(task(sofia, 'assignment', 'Subjunctive practice', -9), { daysAgo: 8, result: 'completed', released: true });
  task(sofia, 'assignment', 'Annotated bibliography', 6, { by: 'u-priya' });
  session(sofia, 'u-priya', 'English', 1, { start: '15:00', end: '16:00' });
  session(sofia, 'u-daniel', 'Spanish', 8, { start: '17:00', end: '18:00' });

  // Liam O'Brien: brand new, no work yet, first lesson in 5 days
  const liam = student('liam', 'Liam O’Brien', 'liam.obrien@example.com', 3);
  link('u-daniel', liam, 'Pre-Algebra');
  session(liam, 'u-daniel', 'Pre-Algebra', 5, { start: '17:00', end: '18:00' });

  // Isabella Nguyen: two overdue, struggling, a lesson on the last day of the window
  const isabella = student('isabella', 'Isabella Nguyen', 'isabella.nguyen@example.com');
  link('u-priya', isabella, 'Biology');
  link('u-daniel', isabella, 'Algebra II');
  handIn(task(isabella, 'assignment', 'Cell structure labs', -15, { by: 'u-priya' }), { daysAgo: 14, result: 'missing', released: true });
  handIn(task(isabella, 'assignment', 'Factoring review', -11), { daysAgo: 10, result: 'missing', released: true });
  task(isabella, 'assignment', 'Genetics problem set', -6, { by: 'u-priya' });
  task(isabella, 'assignment', 'Quadratic word problems', -2);
  session(isabella, 'u-priya', 'Biology', 13, { start: '16:30', end: '17:30' });

  // Owen Clark: taught by the admin; nothing booked, nothing due
  const owen = student('owen', 'Owen Clark', 'owen.clark@example.com', 5);
  link('u-admin', owen, 'AP CSP');

  window.portalDemo.extend({
    tables: {
      profiles: { rows: profiles },
      tutor_students: { rows: links },
      tasks: { rows: tasks },
      submissions: { rows: submissions },
      grades: { rows: grades },
      sessions: { rows: sessions },
    },
  });
}());
