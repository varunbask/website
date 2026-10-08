/* Demo extension: grading by result (supabase/migrations/20261024120000_grade_results.sql).
   Loaded by the local demo build right after demo-supabase.js. A grade is
   Completed, Missing or Extended instead of a score out of 100.

   Like the migration, any grade that still has a score and no result is
   marked completed (an older demo client seeds scores, and its pretend grader
   writes them for new work), now and after every write.

   Adds, for Maya Lin (?as=student, and her mother ?as=parent):
     Triangle congruence      handed in, released as Extended: back in To do,
                              "Extended to <date>", originally due 2 days ago
     Linear inequalities      due yesterday, nothing handed in: Missing in To do
     Exponent rules check     released as Missing: under Graded
   and for Leo Park (?as=student2), an AI draft that suggests Missing:
     Fractions exit ticket    in the Review queue for Daniel (?as=tutor)

   Try it
     ?as=tutor    #/review: pick each result; Extended asks for a new due date
                  Maya's Linear inequalities: open it, Extend in the drawer
     ?as=student  #/assignments/todo (Extended, Missing), #/assignments/graded
     ?as=parent   the same, and the Overview's Completed count */
(function () {
  'use strict';
  if (!window.portalDemo) return;
  const { db, helpers: h } = window.portalDemo;

  // The migration's backfill, for anything that still carries only a score
  function backfill() {
    let changed = false;
    for (const g of db.grades) {
      if (g.result === undefined || g.result === null) {
        if (g.score !== null && g.score !== undefined) {
          g.result = 'completed';
          changed = true;
        } else if (g.result === undefined) {
          g.result = null;
        }
      }
    }
    for (const t of db.tasks) if (t.extended_from === undefined) t.extended_from = null;
    return changed;
  }
  backfill();
  window.portalDemo.onChange(() => {
    if (backfill()) window.portalDemo.notify();
  });

  const task = (student, title, offset, extra = {}) => {
    const row = {
      id: h.id(), student_id: student, created_by: 'u-daniel', kind: 'assignment', title, details: extra.details ?? null,
      due_at: h.dueAt(offset), completed_at: null, created_at: h.ago(9), session_id: null, series_id: null,
      extended_from: extra.extendedFrom ?? null,
    };
    db.tasks.push(row);
    return row;
  };
  const handIn = (t, { daysAgo, body, result, feedback, released = false }) => {
    const sub = {
      id: h.id(), student_id: t.student_id, task_id: t.id, storage_path: null, file_type: null, note: null,
      status: 'ai_graded', attempts: 1, error: null, status_changed_at: h.ago(daysAgo, '19:30'), created_at: h.ago(daysAgo, '19:00'),
      body, body_doc: null,
    };
    db.submissions.push(sub);
    db.grades.push({
      submission_id: sub.id, student_id: t.student_id, result, score: null, feedback,
      reviewed_by: released ? 'u-daniel' : null, reviewed_at: released ? h.ago(daysAgo - 0.5) : null,
      released_at: released ? h.ago(Math.max(0, daysAgo - 1)) : null,
    });
    return sub;
  };

  // Released as Extended: back in To do with a new due date, three days out
  const proofs = task('u-maya', 'Triangle congruence', 3, {
    details: 'Proofs 1 to 6 from the packet. Write each reason next to its statement.',
    extendedFrom: h.dueAt(-2),
  });
  handIn(proofs, {
    daysAgo: 2.5,
    body: 'Proof 1: AB = CD (given), so AB + BC = CD + BC...\nProofs 2 and 3 started.',
    result: 'extended',
    feedback: 'Good start on proofs 1 to 3. Take until the new due date to finish 4 to 6, then hand it in again.',
    released: true,
  });

  // Past due with nothing handed in: Missing in To do
  task('u-maya', 'Linear inequalities worksheet', -1, { details: 'Problems 1 to 15. Graph each solution on a number line.' });

  // Released as Missing: under Graded
  const exponents = task('u-maya', 'Exponent rules check', -5);
  handIn(exponents, {
    daysAgo: 5.5,
    body: 'idk',
    result: 'missing',
    feedback: 'Nothing here answers the questions yet. Bring it to our next lesson and we will go through it together.',
    released: true,
  });

  // An AI draft that suggests Missing, waiting in the Review queue
  const ticket = task('u-leo', 'Fractions exit ticket', 0, { details: 'Three quick problems on adding fractions.' });
  handIn(ticket, {
    daysAgo: 0.4,
    body: 'I will do this later',
    result: 'missing',
    feedback: 'This does not try any of the three problems. Add fractions by finding a common denominator first.',
  });
})();
