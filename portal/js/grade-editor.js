// The grade editor on the review page (spec 5.9, preserved behaviours in 9).
//
// gradeEditor(sub, grade, { onSaved, onReleased, onUnreleased, ...options }) -> HTMLElement
//
// The tutor picks a result, Completed, Missing or Extended (radios in a
// fieldset, styled as a segmented control), and may write feedback. Extended
// reveals "New due date": releasing it moves the assignment's due date there
// (keeping its time of day, see results.js), keeps the first original due
// date in tasks.extended_from, and so puts the assignment back in the
// student's To do, where they may hand it in again.
//
// Unreleased: "Save draft" is the form's submit button and "Release to family"
// is type="button", so Enter in a field can only ever save a draft. A draft
// saves the result and feedback (the new due date is only kept on the page
// until release). Release validates (a result; for Extended a new due date
// still ahead; feedback optional), moves the due date for Extended, then
// writes released_at.
// Released: the result pill (and "Extended to Oct 12") and feedback,
// read-only, and an "Edit or unrelease" <details> whose form saves changes
// (keeping released_at) or unreleases. Unreleasing leaves an extended due
// date where it is.
//
// The editor writes grades (and the task's due date for Extended) itself and
// reports back:
//   onSaved({ kind: 'draft' | 'changes', values })
//   onReleased({ result, feedback, released_at })
//   onUnreleased({ previous })          previous released_at, for Undo
// Other options:
//   now, task ({ id, due_at, extended_from }: the assignment, for Extended),
//   attempt ({ n, total }), late (submitted after the due date),
//   previous (the result of an earlier released attempt), releasedBy (a
//   name), afterRelease (a Node shown under the meta line), initial ({ result,
//   feedback, dueDate } typed but not saved), onInput({ result, feedback,
//   dueDate }), onRetry() -> Promise<string | null> (null when grading
//   started, else the message to show), editOpen (start "Edit or unrelease"
//   open), onEditToggle(open),
//   caret ({ field: 'feedback', start, end }) and onCaret(caret): the caret in
//   the feedback, kept by the page so a refresh re-render can put it back
//   where it was. The checked result radio (else the first) carries
//   data-focus-key "rvw-result", the others "rvw-result-<value>", the date
//   "rvw-due" and the feedback "rvw-feedback", so the app's focus restore
//   after a redraw lands in the control the tutor was using.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { sb } from './supabase.js';
import { one } from './format.js';
import { canRetry } from './labels.js';
import { submissionStatus, resultStatus } from './status.js';
import { MAX_SUBMISSIONS } from './buckets.js';
import { button, busy, pill, field, setFieldError } from './ui.js';
import { stampLabel, dateLabel, validateGrade } from './review-model.js';
import { RESULTS, RESULT_LABELS, resultOf, resultLabel, extensionChanges, extensionTimeText } from './results.js';
import { dayKey, todayKey } from './dates.js';

// An error message as a sentence, so another sentence can follow it
function sentence(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  return /[.?!]$/.test(t) ? t : `${t}.`;
}

function noteLine(text) {
  return h('p', { class: 'note rvw-editor-note' }, icon('info'), h('span', {}, text));
}

// A danger or neutral callout with an optional action row
function callout({ tone, iconName, title, text, actions }) {
  const i = icon(iconName, { size: 20 });
  i.classList.add('callout-icon');
  return h('div', { class: `callout tone-${tone}` }, i,
    h('div', { class: 'callout-body' },
      title ? h('p', { class: 'callout-title' }, title) : null,
      text ? h('p', { class: 'callout-text' }, text) : null,
      actions ? h('div', { class: 'callout-actions' }, actions) : null));
}

// "Try grading again" with its own inline error line
function retryControl(onRetry) {
  const message = h('p', { class: 'rvw-inline-error', role: 'alert', hidden: true });
  const btn = button({ label: 'Try grading again', size: 'sm', icon: 'arrow-counter-clockwise', focusKey: 'rvw-retry' });
  btn.addEventListener('click', () => busy(btn, 'Starting…', async () => {
    message.hidden = true;
    const problem = await onRetry();
    if (problem && btn.isConnected) {
      message.textContent = problem;
      message.hidden = false;
    }
  }));
  return [btn, message];
}

// The result radios: a fieldset whose legend names the group, styled as a
// segmented control (app.css). The checked radio carries the "rvw-result"
// focus key, so a redraw puts focus back on the result the tutor picked.
function resultGroup(value, onPick) {
  const radios = RESULTS.map((r) => {
    const input = h('input', { type: 'radio', name: 'result', value: r, class: 'visually-hidden' });
    input.checked = r === value;
    return input;
  });
  const keyFocus = () => {
    const checked = radios.find((r) => r.checked) ?? radios[0];
    for (const r of radios) r.dataset.focusKey = r === checked ? 'rvw-result' : `rvw-result-${r.value}`;
  };
  keyFocus();
  for (const input of radios) {
    input.addEventListener('change', () => {
      keyFocus();
      onPick(input.value);
    });
  }
  const fieldset = h('fieldset', { class: 'rvw-result-field' },
    h('legend', { class: 'field-label' }, 'Result'),
    h('div', { class: 'segmented is-block rvw-result' },
      radios.map((input) => h('label', {}, input, h('span', {}, RESULT_LABELS[input.value])))));
  return { fieldset, radios };
}

// Shows or clears (empty text) the result group's error, linked to each radio
function setGroupError({ fieldset, radios }, text) {
  fieldset.querySelector(':scope > .field-error')?.remove();
  if (text) {
    const id = uid('rvw-result-error');
    fieldset.append(h('p', { class: 'field-error', id, role: 'alert' }, icon('warning-circle'), h('span', {}, text)));
    for (const r of radios) {
      r.setAttribute('aria-describedby', id);
      r.setAttribute('aria-invalid', 'true');
    }
  } else {
    for (const r of radios) {
      r.removeAttribute('aria-describedby');
      r.removeAttribute('aria-invalid');
    }
  }
}

export function gradeEditor(sub, grade, {
  onSaved, onReleased, onUnreleased, onRetry, onInput,
  now = new Date(), task = null, attempt, late = false, previous = null, releasedBy = null, afterRelease = null,
  initial = null, editOpen = false, onEditToggle, caret = null, onCaret,
} = {}) {
  const g = one(grade);
  const released = Boolean(g?.released_at);
  const stored = resultOf(g);
  const status = submissionStatus(sub, g, { audience: 'staff' });
  const headingId = uid('rvw-editor');
  const n = attempt?.n;
  const total = attempt?.total ?? MAX_SUBMISSIONS;
  // The assignment as the page loaded it; its id is the submission's task
  const assignment = { id: sub.task_id, due_at: null, extended_from: null, ...(task ?? {}) };

  const meta = [
    `Submitted ${stampLabel(sub.created_at, now)}`,
    n ? `attempt ${n} of ${total}` : null,
    late ? 'after the due date' : null,
    resultLabel(previous) ? `previous result ${resultLabel(previous)}` : null,
  ].filter(Boolean).join(', ');

  const card = h('section', { class: 'card rvw-editor', 'aria-labelledby': headingId },
    h('div', { class: 'rvw-editor-head' },
      h('h2', { class: 'rvw-editor-title', id: headingId }, 'Grade'),
      pill(status)),
    h('p', { class: 'rvw-editor-meta num' }, meta));

  if (afterRelease) card.append(afterRelease);

  // State notes (unreleased only)
  if (!released) {
    const retry = onRetry && canRetry(sub, now) ? retryControl(onRetry) : null;
    if (status.key === 'failed') {
      card.append(callout({
        tone: 'danger',
        iconName: 'x-circle',
        title: 'Could not grade',
        text: `${sentence(sub.error) || 'The grader couldn’t read this file.'} You can still grade it here.`,
        actions: retry,
      }));
    } else if (status.key === 'submitted' || status.key === 'grading') {
      card.append(callout({
        tone: 'neutral',
        iconName: 'hourglass-medium',
        title: 'Grading now',
        text: 'The AI draft shows up here when it’s ready. You can also grade it yourself.',
        actions: retry,
      }));
    } else if (status.key === 'draft') {
      const suggests = resultLabel(stored) ? `, suggesting ${resultLabel(stored)}` : '';
      card.append(noteLine(`AI draft${suggests}. Only you can see this until you release it.`));
    } else if (status.key === 'edited') {
      card.append(noteLine('Edited draft. Only you can see this until you release it.'));
    }
  }

  // ---------------------------------------------------------------------------
  // The form (both states)

  // A released Extended starts on its current due date; anything else empty
  const storedDay = released && stored === 'extended' && assignment.due_at ? dayKey(assignment.due_at) : '';
  const start = {
    result: initial ? (RESULTS.includes(initial.result) ? initial.result : null) : stored,
    feedback: initial ? String(initial.feedback ?? '') : (g?.feedback ?? ''),
    dueDate: initial ? String(initial.dueDate ?? '') : storedDay,
  };

  const dueInput = h('input', {
    type: 'date',
    class: 'input rvw-due-input',
    name: 'due',
    min: todayKey(now),
    dataset: { focusKey: 'rvw-due' },
  });
  dueInput.value = start.dueDate;
  const dueField = field({
    label: 'New due date',
    hint: `Due at ${extensionTimeText(assignment.due_at)} Pacific time on this date. The assignment goes back to the student’s To do.`,
    control: dueInput,
  });
  dueField.classList.add('rvw-due-field');
  dueField.hidden = start.result !== 'extended';

  const group = resultGroup(start.result, (value) => {
    setGroupError(group, '');
    const show = value === 'extended';
    if (!show && dueInput.getAttribute('aria-invalid') === 'true') setFieldError(dueField, '');
    dueField.hidden = !show;
    onInput?.(read());
  });

  const feedbackInput = h('textarea', {
    class: 'input textarea rvw-feedback', name: 'feedback', rows: '12', maxlength: '10000',
    dataset: { focusKey: 'rvw-feedback' },
  });
  feedbackInput.value = start.feedback;
  const feedbackField = field({ label: 'Feedback for the student and family', optional: true, control: feedbackInput });

  const formError = h('div', { class: 'rvw-form-error', role: 'alert' });

  let primary;
  let secondary;
  if (released) {
    primary = button({ label: 'Save changes', variant: 'primary', type: 'submit', focusKey: 'rvw-save' });
    secondary = button({ label: 'Unrelease', variant: 'danger-ghost', type: 'button', focusKey: 'rvw-unrelease' });
  } else {
    primary = button({ label: 'Release to family', variant: 'primary', type: 'button', focusKey: 'rvw-primary' });
    secondary = button({ label: 'Save draft', variant: 'secondary', type: 'submit', focusKey: 'rvw-save' });
  }
  const actions = released
    ? h('div', { class: 'rvw-editor-actions' }, primary, secondary)
    : h('div', { class: 'rvw-editor-actions is-floating' }, secondary, primary);

  const form = h('form', { class: 'rvw-form', novalidate: true }, group.fieldset, dueField, feedbackField, formError, actions);

  const read = () => ({
    result: group.radios.find((r) => r.checked)?.value ?? null,
    feedback: feedbackInput.value,
    dueDate: dueInput.value,
  });

  for (const [input, fieldEl] of [[dueInput, dueField], [feedbackInput, feedbackField]]) {
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') setFieldError(fieldEl, '');
      onInput?.(read());
    });
  }
  dueInput.addEventListener('change', () => onInput?.(read()));

  // Put the caret back where it was, so the refocus after a redraw does not
  // jump to the end of the text; report caret moves so the page can keep them
  if (caret?.field === 'feedback') {
    const max = feedbackInput.value.length;
    const startAt = Math.min(Math.max(Number(caret.start) || 0, 0), max);
    const endAt = Math.min(Math.max(Number(caret.end) || startAt, startAt), max);
    try { feedbackInput.setSelectionRange(startAt, endAt); } catch { /* not a text control */ }
  }
  if (onCaret) {
    const report = () => onCaret({ field: 'feedback', start: feedbackInput.selectionStart, end: feedbackInput.selectionEnd });
    for (const type of ['input', 'keyup', 'mouseup', 'select', 'focus']) feedbackInput.addEventListener(type, report);
  }

  function showFormError(text) {
    if (text) formError.replaceChildren(callout({ tone: 'danger', iconName: 'warning-circle', title: 'That didn’t save.', text }));
    else formError.replaceChildren();
  }

  // A released Extended keeps its date unless the tutor picks another
  function check({ release }) {
    const result = validateGrade(read(), {
      release, dueAt: assignment.due_at, now: new Date(), keepDate: released && stored === 'extended',
    });
    setGroupError(group, result.errors.result ?? '');
    setFieldError(dueField, result.errors.dueDate ?? '');
    if (result.errors.result) (group.radios.find((r) => r.checked) ?? group.radios[0]).focus();
    else if (result.errors.dueDate) dueInput.focus();
    return result;
  }

  // One write at a time; a row must come back or the write did not happen.
  // Each grade write also requires the release state this page was drawn
  // with, so a stale page cannot write a draft over a grade someone else
  // released, and moving the due date requires the due date it was drawn with.
  const gradeWrite = (changes) => {
    const query = sb.from('grades').update(changes).eq('submission_id', sub.id);
    const guarded = released ? query.not('released_at', 'is', null) : query.is('released_at', null);
    return guarded.select('submission_id');
  };
  const taskWrite = (changes, from) => {
    const query = sb.from('tasks').update(changes).eq('id', assignment.id);
    const guarded = from ? query.eq('due_at', from) : query.is('due_at', null);
    return guarded.select('id');
  };

  let working = false;
  // dueAt: an Extended's new due date; the task moves first, and moves back
  // when the grade then does not save, so either both change or neither
  async function write(btn, label, changes, { dueAt = null } = {}) {
    showFormError('');
    const moving = Boolean(dueAt) && dueAt !== assignment.due_at;
    const outcome = await busy(btn, label, async () => {
      if (moving) {
        const moved = await taskWrite(extensionChanges(assignment, dueAt), assignment.due_at);
        if (moved.error || !moved.data?.length) return { ...moved, part: 'task' };
      }
      const saved = await gradeWrite(changes);
      if (moving && (saved.error || !saved.data?.length)) {
        try {
          await taskWrite({ due_at: assignment.due_at, extended_from: assignment.extended_from }, dueAt);
        } catch (error) {
          console.error(error);
        }
      }
      return { ...saved, part: 'grade' };
    });
    if (outcome.error) {
      showFormError(`${outcome.error.message || 'Something went wrong.'} Try again.`);
      return false;
    }
    if (!outcome.data?.length) {
      showFormError(outcome.part === 'task'
        ? 'This assignment’s due date changed since the page loaded. Refresh the page and try again.'
        : 'This grade changed since the page loaded. Refresh the page and try again.');
      return false;
    }
    return true;
  }

  async function guarded(fn) {
    if (working) return;
    working = true;
    try {
      await fn();
    } catch (error) {
      console.error(error);
      showFormError('Check your connection and try again.');
    } finally {
      working = false;
    }
  }

  async function saveDraft() {
    const { ok, values } = check({ release: false });
    if (!ok) return;
    if (await write(secondary, 'Saving…', values)) onSaved?.({ kind: 'draft', values });
  }

  async function release() {
    const { ok, values, dueAt } = check({ release: true });
    if (!ok) return;
    const releasedAt = new Date().toISOString();
    if (await write(primary, 'Releasing…', { ...values, released_at: releasedAt }, { dueAt })) {
      onReleased?.({ ...values, released_at: releasedAt });
    }
  }

  // A released grade must keep a result, so it validates like a release
  async function saveChanges() {
    const { ok, values, dueAt } = check({ release: true });
    if (!ok) return;
    if (await write(primary, 'Saving…', values, { dueAt })) onSaved?.({ kind: 'changes', values });
  }

  async function unrelease() {
    const previousAt = g.released_at;
    if (await write(secondary, 'Unreleasing…', { released_at: null })) onUnreleased?.({ previous: previousAt });
  }

  // Enter in a field submits: a draft save, or saving a released grade's edits
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    guarded(released ? saveChanges : saveDraft);
  });
  if (released) secondary.addEventListener('click', () => guarded(unrelease));
  else primary.addEventListener('click', () => guarded(release));

  if (!released) {
    card.append(form);
    return card;
  }

  // ---------------------------------------------------------------------------
  // Released: read-only result, then the editor inside "Edit or unrelease"

  const shown = resultStatus(stored, { audience: 'staff' });
  if (stored === 'extended' && assignment.due_at) shown.label = `Extended to ${dateLabel(assignment.due_at, now)}`;
  const originally = stored === 'extended' && assignment.extended_from
    ? `Originally due ${dateLabel(assignment.extended_from, now)}` : null;
  const releasedLine = `Released ${dateLabel(g.released_at, now)}${releasedBy ? ` by ${releasedBy}` : ''}`;
  card.append(h('div', { class: 'rvw-released' },
    h('p', { class: 'rvw-figure' }, pill(shown), originally ? h('span', { class: 'rvw-figure-note num' }, originally) : null),
    g.feedback ? h('p', { class: 'read is-pre rvw-released-feedback' }, g.feedback) : h('p', { class: 'rvw-muted' }, 'No written feedback.'),
    h('p', { class: 'rvw-released-by num', title: `Released ${stampLabel(g.released_at, now)}` }, releasedLine)));

  const editCaret = icon('caret-right');
  editCaret.classList.add('rvw-edit-caret');
  const changed = initial && (String(initial.result ?? '') !== String(stored ?? '')
    || String(initial.feedback ?? '') !== String(g.feedback ?? '')
    || String(initial.dueDate ?? '') !== storedDay);
  const edit = h('details', { class: 'rvw-edit', open: Boolean(editOpen || changed) },
    h('summary', { class: 'rvw-edit-summary', dataset: { focusKey: 'rvw-edit' } }, editCaret, icon('pencil-simple'), h('span', {}, 'Edit or unrelease')),
    form);
  if (onEditToggle) edit.addEventListener('toggle', () => onEditToggle(edit.open));
  card.append(edit);
  return card;
}
