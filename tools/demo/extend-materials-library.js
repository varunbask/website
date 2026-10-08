/* Demo extension: the Files page (#/files). Loaded by the local demo build right
   after demo-supabase.js. No new table: it adds worksheets, images, Word and
   PowerPoint files and links to Maya Lin's assignments and tasks (and one to Leo
   Park's), spread over several months, so the page has something to show.

   Try it
     student.html?as=student#/files                 Maya
     parent.html?as=parent#/files                   Grace, Maya's parent
     staff.html?as=tutor&student=u-maya#/files      Daniel, with Maya chosen
     student.html?as=student2#/files                Leo, one file
     staff.html?as=tutor&student=u-ava#/files       Ava has none: the empty state

   What it covers
     - months of the due date, newest first, with a year-old file and an undated assignment
     - PDF, Image, Word, PowerPoint and Link rows, and a very long file name
     - a weekly packet repeated six times (one row, "+5 repeats")
     - a task (not an assignment) with a link
     - Maya also has slides on a lesson (demo-supabase.js): they are not listed

   Where the demo differs from the database: every file opens the same sample
   picture, and the joined task comes back whole rather than only the columns
   asked for. */
(function () {
  'use strict';
  if (!window.portalDemo) return;
  const { db, helpers: h } = window.portalDemo;

  const PDF = 'application/pdf';
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const at = (offset, time = '15:00') => h.pt(offset, time);

  // A submission, graded and released, so past assignments are not left overdue
  function finish(task, daysAgo) {
    const sub = {
      id: h.id(), student_id: task.student_id, task_id: task.id, storage_path: null, file_type: null, note: null,
      status: 'ai_graded', attempts: 1, error: null, status_changed_at: h.ago(daysAgo, '19:30'), created_at: h.ago(daysAgo, '19:00'),
      body: 'Worked through every problem and checked my answers.', body_doc: null,
    };
    db.submissions.push(sub);
    db.grades.push({
      submission_id: sub.id, student_id: task.student_id, result: 'completed', score: null, feedback: 'Clear work.', reviewed_by: 'u-daniel',
      reviewed_at: h.ago(daysAgo - 0.5), released_at: h.ago(Math.max(0, daysAgo - 1)),
    });
  }

  function makeTask(student, kind, title, offset, { made, series = null, done = false } = {}) {
    const task = {
      id: h.id(), student_id: student, created_by: 'u-daniel', kind, title, details: null,
      due_at: offset === null ? null : h.dueAt(offset), completed_at: kind === 'task' && done ? h.ago(Math.abs(offset ?? 1) - 1) : null,
      created_at: h.ago(made ?? (offset === null ? 20 : Math.abs(offset) + 7)), session_id: null, series_id: series,
    };
    db.tasks.push(task);
    if (kind === 'assignment' && offset !== null && offset < 0 && done) finish(task, Math.abs(offset) + 1);
    return task;
  }

  const file = (task, title, file_type, size_bytes, added) => ({
    id: h.id(), student_id: task.student_id, session_id: null, task_id: task.id, title,
    storage_path: `${task.student_id}/${h.id()}.${file_type === PDF ? 'pdf' : file_type === PPTX ? 'pptx' : file_type === DOCX ? 'docx' : 'png'}`,
    file_type, size_bytes, url: null, created_by: 'u-daniel', created_at: added ?? task.created_at,
  });
  const link = (task, title, url, added) => ({
    id: h.id(), student_id: task.student_id, session_id: null, task_id: task.id, title,
    storage_path: null, file_type: null, size_bytes: null, url, created_by: 'u-daniel', created_at: added ?? task.created_at,
  });
  const byTitle = (student, title) => db.tasks.find((t) => t.student_id === student && t.title === title);

  window.portalDemo.extend({
    tables: {
      materials: {
        rows: () => {
          const rows = [];

          // Work Maya already has (demo-supabase.js)
          const systems = byTitle('u-maya', 'Systems of equations practice');
          const quadratics = byTitle('u-maya', 'Quadratics: factoring');
          const video = byTitle('u-maya', 'Watch the factoring video');
          const sat = byTitle('u-maya', 'SAT Reading set 4');
          if (systems) {
            rows.push(file(systems, 'Systems practice set', PDF, 245_760));
            rows.push(link(systems, 'Desmos graphing calculator', 'https://www.desmos.com/calculator'));
          }
          if (quadratics) {
            rows.push(file(quadratics, 'Factoring cheat sheet', PDF, 88_400));
            rows.push(file(quadratics, 'Board photo from class', 'image/png', 1_420_000));
          }
          if (video) rows.push(link(video, 'Factoring trinomials, step by step', 'https://www.youtube.com/watch?v=demo'));
          if (sat) rows.push(file(sat, 'SAT Reading passages, set 4', PDF, 512_000));

          // Earlier months
          const linear = makeTask('u-maya', 'assignment', 'Linear functions review', -35, { done: true });
          rows.push(file(linear, 'Linear functions review', PDF, 190_000));
          rows.push(file(linear, 'Graphing lines on the board', 'image/jpeg', 2_900_000));
          const slope = makeTask('u-maya', 'assignment', 'Slope and intercepts', -48, { done: true });
          rows.push(file(slope, 'Slope notes', DOCX, 64_000));
          rows.push(link(slope, 'Khan Academy: slope', 'https://www.khanacademy.org/math/algebra/slope'));
          const lastYear = makeTask('u-maya', 'assignment', 'Number sense warm-up', -300, { done: true });
          rows.push(file(lastYear, 'Warm-up problems', PDF, 40_000));

          // No due date, and a name that needs two lines
          const proofs = makeTask('u-maya', 'assignment', 'Geometry proofs', null, { made: 12 });
          rows.push(file(proofs, 'Proof strategies and common mistakes in two-column geometry proofs, worked examples 1 through 14 (second edition)', PDF, 1_050_000));
          rows.push(file(proofs, 'Proofs lesson slides', PPTX, 3_400_000));

          // One weekly packet, six copies: the page shows it once
          for (const offset of [-14, -7, 0, 7, 14, 21]) {
            const copy = makeTask('u-maya', 'assignment', 'Weekly SAT vocabulary packet', offset, { series: 'demo-weekly-vocab', made: 22, done: offset < 0 });
            rows.push(file(copy, 'SAT vocabulary packet', PDF, 120_000));
          }

          // Leo (one file already exists in demo-supabase.js)
          const percent = byTitle('u-leo', 'Percent change quiz review');
          if (percent) rows.push(file(percent, 'Percent change examples', PDF, 76_000));

          return rows;
        },
      },
    },
  });
}());
