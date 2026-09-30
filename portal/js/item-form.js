// Create and edit form for assignments and tasks, shown in the item drawer
// (spec 5.7). Staff only.
//
// itemForm(dctx, { task = null, kind, due, studentOptions, selectedStudent, onCancel, onSaved }) -> HTMLElement
//   task            the task being edited, or null to create one
//   kind            'assignment' | 'task' (create; editing uses task.kind)
//   due             'YYYY-MM-DD' to prefill the due date (create)
//   studentOptions  profiles for the Student select, shown only when no student
//                   is selected, and on the all-students calendar and Today
//                   (where ?student= may linger); null otherwise
//   selectedStudent a student id the select starts on (still changeable)
//   onCancel        Cancel in edit mode (create closes the drawer)
//   onSaved         after a successful edit (create closes the drawer)
//
// The form puts its title in an h2.drawer-title and its buttons in the drawer
// footer (dctx.setFooter). The caller inserts the element into dctx.body and
// then calls dctx.setTitle(el.dataset.title) to name the dialog.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, field, select, setFieldError, busy } from './ui.js';
import { dueDateToIso, isoToDateInput, displayName } from './format.js';
import { sb } from './supabase.js';

const KIND_LABEL = { assignment: 'Assignment', task: 'Task' };
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function titleFor(kind, editing) {
  return `${editing ? 'Edit' : 'New'} ${kind === 'task' ? 'task' : 'assignment'}`;
}

function submitLabel(kind, editing) {
  if (editing) return 'Save changes';
  return kind === 'task' ? 'Create task' : 'Create assignment';
}

function instructionsHint(kind) {
  return kind === 'task'
    ? 'What to do, like pages to read or problems to practice.'
    : 'The student sees these. The AI grader reads them too.';
}

function dangerCallout(title, text) {
  const glyph = icon('warning-circle', { size: 20 });
  glyph.classList.add('callout-icon');
  return h('div', { class: 'callout tone-danger asg-form-error', role: 'alert' },
    glyph,
    h('div', { class: 'callout-body' },
      h('p', { class: 'callout-title' }, title),
      text ? h('p', { class: 'callout-text' }, text) : null));
}

export function itemForm(dctx, { task = null, kind, due, studentOptions = null, selectedStudent = null, onCancel, onSaved } = {}) {
  const editing = Boolean(task);
  let currentKind = (editing ? task.kind : kind) === 'task' ? 'task' : 'assignment';
  const formId = uid('item-form');

  // Title of the drawer while the form is open
  const heading = h('h2', { class: 'drawer-title', tabindex: '-1' }, titleFor(currentKind, editing));

  // Type: a radio group styled as a segmented control
  const radioName = uid('kind');
  const typeGroup = h('div', { class: 'segmented asg-type', role: 'radiogroup', 'aria-labelledby': `${formId}-type` },
    ['assignment', 'task'].map((value) => h('label', {},
      h('input', {
        type: 'radio',
        class: 'visually-hidden',
        name: radioName,
        value,
        checked: value === currentKind,
        disabled: editing,
        required: true,
      }),
      h('span', {}, KIND_LABEL[value]))));
  const typeField = h('div', { class: 'field' },
    h('span', { class: 'field-label', id: `${formId}-type` }, 'Type'),
    typeGroup,
    editing ? h('p', { class: 'field-hint' }, `The type can’t change after it’s created.`) : null);

  // Student (only when no student is selected)
  let studentField = null;
  let studentSelect = null;
  if (!editing && Array.isArray(studentOptions)) {
    const start = selectedStudent !== null && studentOptions.some((p) => String(p.id) === String(selectedStudent))
      ? String(selectedStudent) : '';
    const wrap = select({
      name: 'student',
      required: true,
      options: [
        { value: '', label: 'Choose a student', disabled: true },
        ...studentOptions.map((p) => ({ value: p.id, label: displayName(p) })),
      ],
      value: start,
    });
    studentSelect = wrap.querySelector('select');
    studentField = field({ label: 'Student', control: wrap });
  }

  const titleInput = h('input', {
    type: 'text',
    class: 'input',
    name: 'title',
    maxlength: '200',
    required: true,
    autocomplete: 'off',
    value: task?.title ?? '',
  });
  const titleField = field({ label: 'Title', control: titleInput });

  const details = h('textarea', { class: 'input textarea', name: 'details', rows: '6', maxlength: '5000' }, task?.details ?? '');
  const detailsField = field({ label: 'Instructions', optional: true, hint: instructionsHint(currentKind), control: details });

  const dueInput = h('input', {
    type: 'date',
    class: 'input asg-date',
    name: 'due',
    value: editing ? isoToDateInput(task.due_at) : (KEY_RE.test(due ?? '') ? due : ''),
  });
  const dueField = field({ label: 'Due date', optional: true, hint: 'Due at 11:59 pm Pacific time on this date.', control: dueInput });

  const errorSlot = h('div', { class: 'asg-form-errors' });

  const form = h('form', { class: 'asg-form', id: formId, novalidate: true },
    typeField, studentField, titleField, detailsField, dueField, errorSlot);

  const root = h('div', { class: 'asg-form-wrap', dataset: { title: heading.textContent } }, heading, form);

  // Footer: Cancel, then the primary action (associated with the form by id)
  const submit = button({
    label: submitLabel(currentKind, editing),
    variant: 'primary',
    type: 'submit',
    focusKey: editing ? `save-${task.id}` : 'create-item',
  });
  submit.setAttribute('form', formId);
  const cancel = button({
    label: 'Cancel',
    variant: 'ghost',
    onClick: () => (editing ? onCancel?.() : dctx.close()),
  });
  dctx.setFooter([cancel, submit]);

  // Switching the type renames the drawer, the button and the hint
  typeGroup.addEventListener('change', (e) => {
    if (e.target?.name !== radioName) return;
    currentKind = e.target.value === 'task' ? 'task' : 'assignment';
    heading.textContent = titleFor(currentKind, editing);
    root.dataset.title = heading.textContent;
    dctx.setTitle(heading.textContent);
    const label = submit.querySelector('.btn-label');
    if (label) label.textContent = submitLabel(currentKind, editing);
    const hint = detailsField.querySelector('.field-hint');
    if (hint) hint.textContent = instructionsHint(currentKind);
  });

  // Enter in a single-line field submits (a textarea keeps its new lines)
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type === 'radio' || t.type === 'checkbox') return;
    e.preventDefault();
    form.requestSubmit(submit);
  });

  titleInput.addEventListener('input', () => {
    if (titleInput.value.trim()) setFieldError(titleField, '');
  });
  studentSelect?.addEventListener('change', () => setFieldError(studentField, ''));

  let saving = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    errorSlot.replaceChildren();

    const title = titleInput.value.trim();
    const studentId = editing ? task.student_id : (studentSelect ? studentSelect.value : dctx.scope?.student?.id);
    let firstInvalid = null;
    if (studentSelect) {
      setFieldError(studentField, studentId ? '' : 'Choose a student.');
      if (!studentId) firstInvalid = studentSelect;
    }
    setFieldError(titleField, title ? '' : 'Add a title.');
    if (!title) firstInvalid ??= titleInput;
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }
    if (!studentId) {
      errorSlot.append(dangerCallout('Choose a student first.', 'Pick a student from the switcher, then try again.'));
      return;
    }

    const values = {
      title,
      details: details.value.trim() || null,
      due_at: dueDateToIso(dueInput.value),
    };

    saving = true;
    try {
      await busy(submit, editing ? 'Saving…' : 'Creating…', async () => {
        const result = editing
          ? await sb.from('tasks').update(values).eq('id', task.id)
          : await sb.from('tasks').insert({ kind: currentKind, ...values, student_id: studentId }).select('id').single();
        if (result.error) {
          console.error(result.error);
          if (dctx.alive?.() === false) return;
          errorSlot.append(dangerCallout(
            editing ? 'We couldn’t save your changes.' : `We couldn’t create this ${currentKind}.`,
            'Check your connection and try again.',
          ));
          errorSlot.scrollIntoView?.({ block: 'nearest' });
          return;
        }
        // Invalidate first, so what renders next reads the saved values
        dctx.store.invalidate(studentId);
        dctx.toast({ text: editing ? 'Changes saved.' : (currentKind === 'task' ? 'Task created.' : 'Assignment created.') });
        if (editing) onSaved?.();
        else {
          // Show the new row (it may sit in a closed "No due date" group)
          if (result.data?.id !== undefined) dctx.reveal?.(result.data.id);
          dctx.close();
        }
      });
    } finally {
      saving = false;
    }
  });

  return root;
}
