import { sb } from './supabase.js';
import { h, clear, showMessage, withBusy, section } from './dom.js';
import { formatDate, formatDateTime, isOverdue, byDue, one } from './format.js';
import { familyStatus, FILE_LABELS } from './labels.js';
import { validateUpload, prepareUpload, storagePath, ACCEPT } from './upload.js';
import { startGrading } from './grading.js';
import { staffNames, loadUpdates, updateItem } from './updates-feed.js';

const MAX_SUBMISSIONS = 5;   // the database allows five per assignment

// A student's assignments, tasks, and released grades. Parents get the same view, read-only.
export async function renderStudentView(container, { studentId, readOnly = false, showUpdates = true }) {
  const message = h('p', { class: 'form-message', role: 'status', hidden: true });
  const updatesHost = h('div');
  let openFormFor = null;

  async function load() {
    const [tasks, subs] = await Promise.all([
      sb.from('tasks').select('id, kind, title, details, due_at, completed_at, created_at').eq('student_id', studentId),
      sb.from('submissions').select('id, task_id, file_type, status, error, created_at, grade:grades(score, feedback, released_at)')
        .eq('student_id', studentId).order('created_at', { ascending: false }),
    ]);
    if (tasks.error) throw tasks.error;
    if (subs.error) throw subs.error;
    const byTask = new Map();
    for (const s of subs.data) byTask.set(s.task_id, [...(byTask.get(s.task_id) ?? []), s]);
    return { tasks: tasks.data.sort(byDue), byTask };
  }

  function submissionLine(sub) {
    const grade = one(sub.grade);
    const status = familyStatus(sub, grade);
    return h('li', {},
      h('div', { class: 'row' },
        h('span', { class: 'meta' }, `${FILE_LABELS[sub.file_type] ?? 'File'} submitted ${formatDateTime(sub.created_at)}`),
        h('span', { class: `status ${status.tone}` }, status.text)),
      status.tone === 'alert' ? h('p', { class: 'meta' }, sub.error) : null,
      grade?.released_at
        ? h('div', { class: 'grade-block' },
            h('p', { class: 'score-line' }, `Score ${grade.score}`),
            h('p', { class: 'feedback' }, grade.feedback))
        : null);
  }

  function uploadForm(task) {
    const form = h('form', { class: 'stack grade-block', novalidate: true },
      h('label', { class: 'field' }, h('span', {}, 'Your work'),
        h('input', { type: 'file', name: 'file', accept: ACCEPT, required: true }),
        h('small', {}, 'A photo of your work (JPG or PNG), a PDF with typed text, or a text file. Up to 20 MB.')),
      h('label', { class: 'field' }, h('span', {}, 'Note for your tutor ', h('em', { class: 'optional' }, 'Optional')),
        h('textarea', { name: 'note', rows: 2, maxlength: 1000 })),
      h('div', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn btn-primary btn-small' }, 'Submit'),
        h('button', { type: 'button', class: 'link-button', onclick: () => { openFormFor = null; draw(); } }, 'Cancel')),
      h('p', { class: 'form-message', role: 'alert', hidden: true }));

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const local = form.querySelector('.form-message');
      const file = form.elements.file.files[0];
      const problem = validateUpload(file);
      if (problem) return showMessage(local, problem);
      await withBusy(form.querySelector('button[type="submit"]'), 'Uploading...', async () => {
        try {
          const { body, type } = await prepareUpload(file);
          const path = storagePath(studentId, type);
          const uploaded = await sb.storage.from('homework').upload(path, body, { contentType: type, upsert: false });
          if (uploaded.error) throw uploaded.error;
          const inserted = await sb.from('submissions')
            .insert({ task_id: task.id, storage_path: path, file_type: type, note: form.elements.note.value.trim() || null })
            .select('id').single();
          if (inserted.error) throw inserted.error;
          startGrading(inserted.data.id, { keepalive: true });   // not awaited: the daily sweep catches misses
          openFormFor = null;
          await draw();
          showMessage(message, `Submitted "${task.title}". Your tutor will review it soon.`, 'success');
        } catch (err) {
          console.error('Submission failed', err);
          showMessage(local, err?.message?.startsWith('This photo')
            ? err.message
            : 'Your work could not be submitted. Try again, or email it to your tutor.');
        }
      });
    });
    return form;
  }

  function assignmentRow(task, subs) {
    const overdue = isOverdue(task);
    const canSubmit = !readOnly && subs.length < MAX_SUBMISSIONS && openFormFor !== task.id;
    const meta = [task.due_at ? `Due ${formatDate(task.due_at)}` : 'No due date'];
    if (overdue) meta.push('overdue');
    return h('li', {},
      h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('span', { class: 'row-title' }, task.title),
          h('span', { class: overdue ? 'meta overdue' : 'meta' }, meta.join(' · ')),
          task.details ? h('p', { class: 'details' }, task.details) : null),
        canSubmit
          ? h('div', { class: 'row-actions' },
              h('button', { type: 'button', class: 'btn btn-primary btn-small', onclick: () => { openFormFor = task.id; draw(); } },
                subs.length ? 'Submit again' : 'Submit work'))
          : null),
      openFormFor === task.id ? uploadForm(task) : null,
      subs.length ? h('ul', { class: 'submission-list' }, subs.map(submissionLine)) : null);
  }

  function taskRow(task) {
    const overdue = isOverdue(task);
    const box = h('input', { type: 'checkbox', checked: Boolean(task.completed_at), disabled: readOnly });
    box.addEventListener('change', async () => {
      box.disabled = true;
      const { error } = await sb.rpc('set_task_done', { p_task_id: task.id, p_done: box.checked });
      if (error) showMessage(message, 'That did not save. Try again.');
      await draw();
    });
    return h('li', {},
      h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('label', { class: 'check' }, box, h('span', { class: 'row-title' }, task.title)),
          task.details ? h('p', { class: 'details' }, task.details) : null),
        task.due_at
          ? h('span', { class: overdue ? 'meta overdue' : 'meta' }, `Due ${formatDate(task.due_at)}${overdue ? ' · overdue' : ''}`)
          : null));
  }

  async function draw() {
    let data;
    try {
      data = await load();
    } catch {
      clear(container).append(h('p', { class: 'form-message error' }, 'This work could not be loaded. Refresh to try again.'));
      return;
    }
    const assignments = data.tasks.filter((t) => t.kind === 'assignment');
    const due = assignments.filter((t) => !t.completed_at);
    const submitted = assignments.filter((t) => t.completed_at)
      .sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at));
    const tasks = data.tasks.filter((t) => t.kind === 'task')
      .sort((a, b) => (Boolean(a.completed_at) - Boolean(b.completed_at)) || byDue(a, b));
    const row = (task) => assignmentRow(task, data.byTask.get(task.id) ?? []);
    clear(container).append(
      message,
      section('Assignments due', due, row, 'Nothing due right now.'),
      section('Tasks', tasks, taskRow, 'No tasks right now.'),
      section('Submitted', submitted, row, 'Nothing submitted yet.'),
      showUpdates ? updatesHost : null);
  }

  async function drawUpdates() {
    try {
      const [updates, names] = await Promise.all([loadUpdates(studentId), staffNames()]);
      clear(updatesHost).append(section('Notes from your tutor', updates, (u) => updateItem(u, names), 'No notes yet.'));
    } catch {
      clear(updatesHost);
    }
  }

  await draw();
  if (showUpdates) await drawUpdates();
}
