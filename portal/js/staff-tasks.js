import { sb } from './supabase.js';
import { h, clear, showMessage, withBusy } from './dom.js';
import { formatDate, dueDateToIso, isoToDateInput, isOverdue, byDue } from './format.js';

const KIND_LABEL = { assignment: 'Assignment', task: 'Task' };

// The form for adding an item, and for editing one in place
function taskForm({ task = null, onSubmit, onCancel = null }) {
  const form = h('form', { class: task ? 'stack grade-block' : 'stack composer', novalidate: true },
    h('fieldset', { class: 'field' },
      h('legend', {}, 'Type'),
      h('div', { class: 'segmented' },
        ['assignment', 'task'].map((kind) => h('label', {},
          h('input', { type: 'radio', name: 'kind', value: kind, checked: (task?.kind ?? 'assignment') === kind }),
          h('span', {}, KIND_LABEL[kind]))))),
    h('label', { class: 'field' }, h('span', {}, 'Title'),
      h('input', { type: 'text', name: 'title', maxlength: 200, required: true, value: task?.title ?? '' })),
    h('label', { class: 'field' },
      h('span', {}, 'Instructions ', h('em', { class: 'optional' }, 'Optional. The AI grader reads these too.')),
      h('textarea', { name: 'details', rows: 3, maxlength: 5000 }, task?.details ?? '')),
    h('div', { class: 'form-row' },
      h('label', { class: 'field' }, h('span', {}, 'Due date ', h('em', { class: 'optional' }, 'Optional')),
        h('input', { type: 'date', name: 'due', value: isoToDateInput(task?.due_at) }))),
    h('div', { class: 'form-actions' },
      h('button', { type: 'submit', class: 'btn btn-primary btn-small' }, task ? 'Save changes' : 'Add'),
      onCancel ? h('button', { type: 'button', class: 'link-button', onclick: onCancel }, 'Cancel') : null),
    h('p', { class: 'form-message', role: 'alert', hidden: true }));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = form.querySelector('.form-message');
    const data = new FormData(form);
    const values = {
      kind: String(data.get('kind')),
      title: String(data.get('title')).trim(),
      details: String(data.get('details')).trim() || null,
      due_at: dueDateToIso(String(data.get('due'))),
    };
    if (!values.title) return showMessage(message, 'Give it a title.');
    showMessage(message, '');
    await withBusy(form.querySelector('button[type="submit"]'), 'Saving...', async () => {
      const problem = await onSubmit(values);
      if (problem) showMessage(message, problem);
    });
  });
  return form;
}

function taskRow(task, { submitted, editForm, actions }) {
  const overdue = isOverdue(task);
  const meta = [KIND_LABEL[task.kind], task.due_at ? `due ${formatDate(task.due_at)}` : 'no due date'];
  if (task.kind === 'assignment') meta.push(submitted ? `${submitted} submitted` : 'not submitted yet');
  else meta.push(task.completed_at ? `done ${formatDate(task.completed_at)}` : 'not done');
  if (overdue) meta.push('overdue');
  return h('li', {},
    h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('span', { class: 'row-title' }, task.title),
        h('span', { class: overdue ? 'meta overdue' : 'meta' }, meta.join(' · ')),
        task.details ? h('p', { class: 'details' }, task.details) : null),
      h('div', { class: 'row-actions' },
        task.kind === 'task'
          ? h('button', { type: 'button', class: 'link-button', onclick: actions.toggleDone }, task.completed_at ? 'Reopen' : 'Mark done')
          : null,
        h('button', { type: 'button', class: 'link-button', onclick: actions.edit }, 'Edit'),
        h('button', { type: 'button', class: 'link-button', onclick: actions.remove }, 'Delete'))),
    editForm);
}

export async function renderTasks(container, { student, onChange }) {
  const message = h('p', { class: 'form-message', role: 'status', hidden: true });
  let editingId = null;

  async function load() {
    const [tasks, subs] = await Promise.all([
      sb.from('tasks').select('id, kind, title, details, due_at, completed_at, created_at').eq('student_id', student.id),
      sb.from('submissions').select('task_id').eq('student_id', student.id),
    ]);
    if (tasks.error) throw tasks.error;
    const counts = new Map();
    for (const s of subs.data ?? []) counts.set(s.task_id, (counts.get(s.task_id) ?? 0) + 1);
    return { tasks: tasks.data.sort(byDue), counts };
  }

  // Reports a write's result; returns an error string for the form, or null
  async function after({ error }, successText) {
    if (error) {
      const text = error.code === '23503'
        ? 'This assignment has submitted work, so it cannot be deleted.'
        : `That did not save: ${error.message}`;
      showMessage(message, text);
      return text;
    }
    editingId = null;
    await draw();
    showMessage(message, successText, 'success');
    onChange?.();
    return null;
  }

  async function draw() {
    let data;
    try {
      data = await load();
    } catch {
      clear(container).append(h('p', { class: 'form-message error' }, 'Assignments could not be loaded. Refresh to try again.'));
      return;
    }
    const row = (task) => taskRow(task, {
      submitted: data.counts.get(task.id) ?? 0,
      editForm: editingId === task.id
        ? taskForm({
            task,
            onSubmit: async (values) => after(await sb.from('tasks').update(values).eq('id', task.id), 'Saved.'),
            onCancel: () => { editingId = null; draw(); },
          })
        : null,
      actions: {
        edit: () => { editingId = task.id; draw(); },
        remove: async () => {
          if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;
          await after(await sb.from('tasks').delete().eq('id', task.id), 'Deleted.');
        },
        toggleDone: async () => {
          const completed_at = task.completed_at ? null : new Date().toISOString();
          await after(await sb.from('tasks').update({ completed_at }).eq('id', task.id), completed_at ? 'Marked done.' : 'Reopened.');
        },
      },
    });
    const open = data.tasks.filter((t) => !t.completed_at);
    const finished = data.tasks.filter((t) => t.completed_at);
    clear(container).append(
      taskForm({
        onSubmit: async (values) => after(await sb.from('tasks').insert({ ...values, student_id: student.id }), `Added "${values.title}".`),
      }),
      message,
      h('h3', { class: 'list-heading' }, 'Open'),
      open.length ? h('ul', { class: 'ruled-list' }, open.map(row)) : h('p', { class: 'empty' }, 'Nothing open.'),
      h('h3', { class: 'list-heading' }, 'Done'),
      finished.length ? h('ul', { class: 'ruled-list' }, finished.map(row)) : h('p', { class: 'empty' }, 'Nothing done yet.'));
  }

  await draw();
}
