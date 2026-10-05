// Create and edit form for assignments and tasks, shown in the item drawer
// (spec 5.7). Staff only.
//
// itemForm(dctx, { task = null, kind, due, studentOptions, selectedStudent, series, onCancel, onSaved }) -> HTMLElement
//   task            the task being edited, or null to create one
//   series          editing a copy of a repeating item: it and the copies
//                   after it (task-repeat-model.js followingInTaskSeries); the
//                   form then asks whether the changes apply to the rest too
//   kind            'assignment' | 'task' (create; editing uses task.kind)
//   due             'YYYY-MM-DD' to prefill the due date (create)
//   studentOptions  profiles for the Student select, shown only when no student
//                   is selected, and on the all-students calendar and Today
//                   (where ?student= may linger); null otherwise
//   selectedStudent a student id the select starts on (still changeable)
//   onCancel        Cancel in edit mode (create closes the drawer, or goes
//                   back to the lesson for homework set in one)
//   onSaved         after a successful edit (create closes the drawer)
//
// Creating (outside a lesson) offers Repeat: every day or every week, a
// number of times; every copy is created at once with its own due date, and
// attached files go on each copy.
//
// The form puts its title in an h2.drawer-title and its buttons in the drawer
// footer (dctx.setFooter). The caller inserts the element into dctx.body and
// then calls dctx.setTitle(el.dataset.title) to name the dialog.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, iconButton, field, select, segmented, setFieldError, busy, drawerHref } from './ui.js';
import { dueDateToIso, isoToDateInput, displayName } from './format.js';
import { sb } from './supabase.js';
import { lessonLabel, MATERIAL_ACCEPT, materialType, validateMaterialFile, materialIcon, sizeText } from './materials-model.js';
import { uploadMaterialFiles, copyMaterialFiles, problemsText, namePastedImage } from './materials-ui.js';
import { todayKey } from './dates.js';
import { newSeriesId } from './sessions-model.js';
import {
  REPEATS, MIN_REPEAT_COUNT, checkRepeat, repeatSummary, repeatRows, followingText, seriesUpdates, groupUpdates, itemNoun,
} from './task-repeat-model.js';

const KIND_LABEL = { assignment: 'Assignment', task: 'Task' };
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ATTACHMENTS = 10;

function titleFor(kind, editing) {
  return `${editing ? 'Edit' : 'New'} ${kind === 'task' ? 'task' : 'assignment'}`;
}

function submitLabel(kind, editing, copies = 1) {
  if (editing) return 'Save changes';
  if (copies > 1) return `Create ${copies} ${itemNoun(kind, copies)}`;
  return kind === 'task' ? 'Create task' : 'Create assignment';
}

// "Assignment created with 2 files.", "8 tasks created, each with 1 file."
function createdText(kind, count, files) {
  const what = count > 1 ? `${count} ${itemNoun(kind, count)} created` : (kind === 'task' ? 'Task created' : 'Assignment created');
  if (!files) return `${what}.`;
  const fileText = files === 1 ? '1 file' : `${files} files`;
  return count > 1 ? `${what}, each with ${fileText}.` : `${what} with ${fileText}.`;
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

// lesson: the session homework is set in (create only); it fixes the student
// and is saved as tasks.session_id
export function itemForm(dctx, {
  task = null, kind, due, studentOptions = null, selectedStudent = null, lesson = null, series = null, onCancel, onSaved,
} = {}) {
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

  // Repeat (create, outside a lesson): every copy made at once
  let repeatBox = null;
  let everySelect = null;
  let countInput = null;
  let countField = null;
  let repeatFields = null;
  let repeatHint = null;
  let repeatGroup = null;
  if (!editing && !lesson) {
    repeatBox = h('input', { type: 'checkbox', class: 'checkbox', name: 'repeat' });
    const everyWrap = select({
      name: 'every',
      options: Object.entries(REPEATS).map(([value, p]) => ({ value, label: p.label })),
      value: 'weekly',
    });
    everySelect = everyWrap.querySelector('select');
    countInput = h('input', {
      type: 'number', class: 'input asg-repeat-count', name: 'count', inputmode: 'numeric',
      min: String(MIN_REPEAT_COUNT), max: String(REPEATS.weekly.max), value: String(REPEATS.weekly.start),
    });
    countField = field({ label: 'How many times', control: countInput });
    repeatHint = h('p', { class: 'field-hint asg-repeat-hint' });
    repeatFields = h('div', { class: 'asg-repeat-fields', hidden: true },
      h('div', { class: 'asg-repeat-row' }, field({ label: 'Repeats', control: everyWrap }), countField),
      repeatHint);
    repeatGroup = h('div', { class: 'asg-repeat' },
      h('label', { class: 'check' }, repeatBox, h('span', {}, 'Repeat')),
      repeatFields);
  }
  const readRepeat = () => ({
    repeat: Boolean(repeatBox?.checked), every: everySelect?.value, count: countInput?.value, due: dueInput.value,
  });

  // Apply to (editing a copy of a repeating item)
  const rows = editing && Array.isArray(series) && series.length > 1 ? series : null;
  let apply = 'this';
  let applyField = null;
  if (rows) {
    const one = task.kind === 'task' ? 'This task' : 'This assignment';
    const applyHint = h('p', { class: 'field-hint' }, `Changes only this ${task.kind === 'task' ? 'task' : 'assignment'}.`);
    const group = segmented({
      label: 'Apply to',
      block: true,
      options: [{ value: 'this', label: one }, { value: 'following', label: 'This and following' }],
      value: 'this',
      onChange: (value) => {
        apply = value;
        applyHint.textContent = value === 'following'
          ? `${followingText(rows, task)}. Due dates move by as many days as this one.`
          : `Changes only this ${task.kind === 'task' ? 'task' : 'assignment'}.`;
      },
    });
    applyField = h('div', { class: 'field' },
      h('span', { class: 'field-label', 'aria-hidden': 'true' }, 'Apply to'),
      group,
      applyHint);
  }

  const errorSlot = h('div', { class: 'asg-form-errors' });

  // Attachments (create only): worksheets or screenshots of the questions,
  // uploaded as materials once the item exists. Editing uses the drawer's
  // own attachments section instead.
  const pendingFiles = [];
  let attachField = null;
  let attachList = null;
  let attachProblem = null;
  let renderAttachments = () => {};
  let addAttachments = () => {};
  if (!editing) {
    const attachInput = h('input', {
      type: 'file', multiple: true, accept: MATERIAL_ACCEPT,
      class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true',
    });
    attachList = h('ul', { class: 'asg-attach-list', 'aria-label': 'Files to attach' });
    attachProblem = h('div', { class: 'asg-attach-problem' });
    const attachBtn = button({
      label: 'Add files',
      icon: 'paperclip',
      size: 'sm',
      focusKey: 'create-attach',
      onClick: () => attachInput.click(),
    });
    attachField = h('div', { class: 'field asg-attach-field' },
      h('span', { class: 'field-label', id: `${formId}-attach` }, 'Attachments', h('span', { class: 'field-optional' }, 'Optional')),
      attachList,
      h('div', { class: 'asg-attach-actions' }, attachBtn, attachInput),
      h('p', { class: 'field-hint' }, 'Worksheets or screenshots of the questions. PDF, PowerPoint, Word or images, up to 25 MB each. You can also paste a screenshot here.'),
      attachProblem);

    renderAttachments = () => {
      attachList.replaceChildren(...pendingFiles.map((file, i) => h('li', { class: 'asg-attach-item' },
        h('span', { class: 'mat-icon', 'aria-hidden': 'true' }, icon(materialIcon({ file_type: materialType(file) }), { size: 20 })),
        h('span', { class: 'asg-attach-name' }, file.name),
        h('span', { class: 'asg-attach-size num' }, sizeText(file.size)),
        iconButton({
          icon: 'x',
          label: `Remove ${file.name}`,
          tip: 'left',
          onClick: () => {
            pendingFiles.splice(i, 1);
            renderAttachments();
            attachBtn.focus();
          },
        }))));
      attachList.hidden = pendingFiles.length === 0;
    };

    addAttachments = (files) => {
      const problems = [];
      for (const file of files) {
        if (pendingFiles.length >= MAX_ATTACHMENTS) {
          problems.push(`Attach at most ${MAX_ATTACHMENTS} files here. Add more from the assignment after you create it.`);
          break;
        }
        const message = validateMaterialFile(file);
        if (message) problems.push(`${file.name}: ${message}`);
        else pendingFiles.push(file);
      }
      attachProblem.replaceChildren(problems.length
        ? h('p', { class: 'field-error', role: 'alert' }, icon('warning-circle'), h('span', {}, problems.join(' ')))
        : '');
      renderAttachments();
    };

    attachInput.addEventListener('change', () => {
      const files = [...(attachInput.files ?? [])];
      attachInput.value = '';
      if (files.length) addAttachments(files);
    });
    renderAttachments();
  }

  const lessonNote = lesson && !editing
    ? h('p', { class: 'note asg-lesson-note' }, icon('book-open-text'),
      h('span', {}, `Homework for ${lessonLabel(lesson, todayKey())}. Add a worksheet or slides after you create it.`))
    : null;

  const form = h('form', { class: 'asg-form', id: formId, novalidate: true },
    lessonNote, applyField, typeField, studentField, titleField, detailsField, dueField, repeatGroup, attachField, errorSlot);

  // A screenshot pasted anywhere in the form is attached (pasted text still
  // goes into the field being typed in)
  if (!editing) {
    form.addEventListener('paste', (e) => {
      const images = [...(e.clipboardData?.files ?? [])].filter((f) => f.type === 'image/png' || f.type === 'image/jpeg');
      if (!images.length) return;
      e.preventDefault();
      const shots = pendingFiles.filter((f) => /^Screenshot( \d+)?\.(png|jpg)$/.test(f.name)).length;
      addAttachments(images.map((f, i) => namePastedImage(f, shots + i + 1)));
    });
  }

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
    // Homework from a lesson goes back to that lesson; other creates close
    onClick: () => {
      if (editing) onCancel?.();
      else if (lesson) dctx.go(drawerHref(typeof location === 'undefined' ? '' : location.hash, `s${lesson.id}`), { replace: true });
      else dctx.close();
    },
  });
  dctx.setFooter([cancel, submit]);

  // Switching the type renames the drawer, the button and the hint
  typeGroup.addEventListener('change', (e) => {
    if (e.target?.name !== radioName) return;
    currentKind = e.target.value === 'task' ? 'task' : 'assignment';
    heading.textContent = titleFor(currentKind, editing);
    root.dataset.title = heading.textContent;
    dctx.setTitle(heading.textContent);
    const hint = detailsField.querySelector('.field-hint');
    if (hint) hint.textContent = instructionsHint(currentKind);
    paintRepeat();
  });

  // The repeat summary and the button say how many will be made
  function paintRepeat() {
    const raw = readRepeat();
    const check = checkRepeat(raw);
    const copies = raw.repeat && !check.errors.due && !check.errors.count ? check.values.count : 1;
    const label = submit.querySelector('.btn-label');
    if (label) label.textContent = submitLabel(currentKind, editing, copies);
    if (!repeatHint) return;
    repeatHint.textContent = !raw.repeat ? ''
      : (!check.values.due ? 'Pick the first due date above. Each copy is due on its own day after it.'
        : repeatSummary(raw, currentKind) || ' ');
  }
  if (repeatBox) {
    repeatBox.addEventListener('change', () => {
      repeatFields.hidden = !repeatBox.checked;
      if (!repeatBox.checked) {
        setFieldError(countField, '');
        setFieldError(dueField, '');
      }
      paintRepeat();
    });
    let every = everySelect.value;
    everySelect.addEventListener('change', () => {
      const before = REPEATS[every];
      every = everySelect.value;
      const now = REPEATS[every];
      countInput.max = String(now.max);
      // A count still at the old pattern's start moves to the new one's
      if (countInput.value === String(before.start)) countInput.value = String(now.start);
      setFieldError(countField, '');
      paintRepeat();
    });
    countInput.addEventListener('input', () => {
      setFieldError(countField, '');
      paintRepeat();
    });
    dueInput.addEventListener('input', () => {
      setFieldError(dueField, '');
      paintRepeat();
    });
    dueInput.addEventListener('change', paintRepeat);
  }

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

  // An edit: this item, or (Apply to: This and following) the copies after it
  // too. A copy that fails is reported; this one failing stops the edit.
  async function saveEdit(values) {
    const updates = seriesUpdates({ task, rows, values, apply: rows ? apply : 'this' });
    const groups = groupUpdates(updates);
    const results = await Promise.all(groups.map((g) => sb.from('tasks').update(g.values).in('id', g.ids).select('id')));
    const own = groups.findIndex((g) => g.ids.some((id) => String(id) === String(task.id)));
    const mine = results[own];
    if (dctx.alive?.() === false) return;
    if (mine.error) {
      console.error(mine.error);
      errorSlot.append(dangerCallout('We couldn’t save your changes.', 'Check your connection and try again.'));
      errorSlot.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    // An edit that matched no row: the item was deleted or moved elsewhere
    if (!mine.data?.some((r) => String(r.id) === String(task.id))) {
      errorSlot.append(dangerCallout('We couldn’t save your changes.', 'This item was changed or removed. Refresh the page and try again.'));
      errorSlot.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    const saved = results.reduce((n, r) => n + (r.data?.length ?? 0), 0);
    const missed = updates.length - saved;
    for (const r of results) if (r.error) console.error(r.error);
    dctx.store.invalidate(task.student_id);
    dctx.toast({ text: updates.length > 1 ? `Changes saved to ${saved} ${itemNoun(task.kind, saved)}.` : 'Changes saved.' });
    if (missed > 0) dctx.toast({ text: `${missed === 1 ? '1 later copy' : `${missed} later copies`} could not be changed. Try again from ${missed === 1 ? 'it' : 'them'}.` });
    onSaved?.();
  }

  let saving = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    errorSlot.replaceChildren();

    const title = titleInput.value.trim();
    // A lesson fixes the student (Today and the all-students calendar have no scope)
    const studentId = editing
      ? task.student_id
      : (lesson ? lesson.student_id : (studentSelect ? studentSelect.value : dctx.scope?.student?.id));
    let firstInvalid = null;
    if (studentSelect) {
      setFieldError(studentField, studentId ? '' : 'Choose a student.');
      if (!studentId) firstInvalid = studentSelect;
    }
    setFieldError(titleField, title ? '' : 'Add a title.');
    if (!title) firstInvalid ??= titleInput;
    const repeat = checkRepeat(readRepeat());
    if (repeat.values.repeat) {
      setFieldError(dueField, repeat.errors.due ?? '');
      if (repeat.errors.due) firstInvalid ??= dueInput;
      setFieldError(countField, repeat.errors.count ?? '');
      if (repeat.errors.count) firstInvalid ??= countInput;
    }
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
        if (editing) {
          await saveEdit(values);
          return;
        }
        // One row, or every copy of a repeat (one insert: all or none)
        const base = { kind: currentKind, title: values.title, details: values.details, student_id: studentId };
        const inserts = repeat.values.repeat
          ? repeatRows(base, { ...repeat.values, seriesId: newSeriesId() })
          : [{ ...base, due_at: values.due_at, ...(lesson ? { session_id: lesson.id } : {}) }];
        const result = await sb.from('tasks').insert(inserts).select('id, due_at');
        if (result.error || !result.data?.length) {
          if (result.error) console.error(result.error);
          if (dctx.alive?.() === false) return;
          errorSlot.append(dangerCallout(
            repeat.values.repeat ? `We couldn’t create these ${itemNoun(currentKind, 2)}.` : `We couldn’t create this ${currentKind}.`,
            'Check your connection and try again.',
          ));
          errorSlot.scrollIntoView?.({ block: 'nearest' });
          return;
        }
        // The items exist: attach the files to the first, then copy them to
        // the rest. A file that fails is reported, and the items stay (files
        // can be added from them later).
        const dueTime = (t) => (t.due_at ? Date.parse(t.due_at) : 0);
        const made = [...result.data].sort((a, b) => dueTime(a) - dueTime(b) || a.id - b.id);
        const first = made[0];
        let attached = { added: 0, problems: [], rows: [] };
        let copied = { added: 0, problems: [] };
        if (pendingFiles.length) {
          attached = await uploadMaterialFiles({ studentId, owner: { task_id: first.id }, files: pendingFiles });
          if (attached.rows.length && made.length > 1) {
            copied = await copyMaterialFiles({ studentId, rows: attached.rows, owners: made.slice(1).map((t) => ({ task_id: t.id })) });
          }
        }
        // Invalidate first, so what renders next reads the saved values
        dctx.store.invalidate(studentId);
        dctx.toast({ text: createdText(currentKind, made.length, attached.added) });
        const problems = [...attached.problems, ...copied.problems];
        if (problems.length) dctx.toast({ text: problemsText(problems) });
        if (lesson) {
          // Homework from a lesson opens right away, so a worksheet can be added
          dctx.go(drawerHref(typeof location === 'undefined' ? '' : location.hash, first.id), { replace: true });
          return;
        }
        // Show the new row (it may sit in a closed "No due date" group)
        dctx.reveal?.(first.id);
        dctx.close();
      });
    } finally {
      saving = false;
    }
  });

  return root;
}
