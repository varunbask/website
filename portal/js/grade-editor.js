// The grade editor on the review page (spec 5.9, preserved behaviours in 9).
//
// gradeEditor(sub, grade, { onSaved, onReleased, onUnreleased, ...options }) -> HTMLElement
//
// Unreleased: "Save draft" is the form's submit button and "Release to family"
// is type="button", so Enter in a field can only ever save a draft. Release
// validates (score 0 to 100, feedback required) and writes released_at.
// Released: read-only score and feedback, and an "Edit or unrelease" <details>
// whose form saves changes (keeping released_at) or unreleases.
//
// The editor writes grades itself and reports back:
//   onSaved({ kind: 'draft' | 'changes', values })
//   onReleased({ score, feedback, released_at })
//   onUnreleased({ previous })          previous released_at, for Undo
// Other options:
//   now, attempt ({ n, total }), late (submitted after the due date), releasedBy (a name), afterRelease (a Node shown
//   under the meta line), initial ({ score, feedback } typed but not saved),
//   onInput({ score, feedback }), onRetry() -> Promise<string | null>
//   (null when grading started, else the message to show),
//   editOpen (start "Edit or unrelease" open), onEditToggle(open),
//   caret ({ field: 'score' | 'feedback', start, end }) and onCaret(caret):
//   the caret in a field, kept by the page so a refresh re-render can put it
//   back where it was. Both fields carry a data-focus-key, so the app's focus
//   restore after a redraw lands in the field the tutor was typing in.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { sb } from './supabase.js';
import { one } from './format.js';
import { canRetry } from './labels.js';
import { submissionStatus } from './status.js';
import { MAX_SUBMISSIONS } from './buckets.js';
import { button, busy, pill, field, setFieldError, visuallyHidden } from './ui.js';
import { stampLabel, dateLabel, validateGrade } from './review-model.js';

const hasValue = (v) => v !== null && v !== undefined && v !== '';

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

export function gradeEditor(sub, grade, {
  onSaved, onReleased, onUnreleased, onRetry, onInput,
  now = new Date(), attempt, late = false, releasedBy = null, afterRelease = null, initial = null,
  editOpen = false, onEditToggle, caret = null, onCaret,
} = {}) {
  const g = one(grade);
  const released = Boolean(g?.released_at);
  const status = submissionStatus(sub, g, { audience: 'staff' });
  const headingId = uid('rvw-editor');
  const n = attempt?.n;
  const total = attempt?.total ?? MAX_SUBMISSIONS;

  const meta = [
    `Submitted ${stampLabel(sub.created_at, now)}`,
    n ? `attempt ${n} of ${total}` : null,
    late ? 'after the due date' : null,
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
      card.append(noteLine('AI draft. Only you can see this until you release it.'));
    } else if (status.key === 'edited') {
      card.append(noteLine('Edited draft. Only you can see this until you release it.'));
    }
  }

  // ---------------------------------------------------------------------------
  // The form (both states)

  const start = {
    score: initial ? String(initial.score ?? '') : (hasValue(g?.score) ? String(g.score) : ''),
    feedback: initial ? String(initial.feedback ?? '') : (g?.feedback ?? ''),
  };

  const scoreInput = h('input', {
    class: 'input rvw-score-input',
    type: 'text',
    name: 'score',
    inputmode: 'decimal',
    autocomplete: 'off',
    spellcheck: 'false',
    dataset: { focusKey: 'rvw-score' },
  });
  scoreInput.value = start.score;
  const scoreField = field({
    label: ['Score', visuallyHidden(', out of 100')],
    control: h('div', { class: 'rvw-score' }, scoreInput, h('span', { class: 'rvw-score-max', 'aria-hidden': 'true' }, '/ 100')),
  });

  const feedbackInput = h('textarea', {
    class: 'input textarea rvw-feedback', name: 'feedback', rows: '12', maxlength: '10000',
    dataset: { focusKey: 'rvw-feedback' },
  });
  feedbackInput.value = start.feedback;
  const feedbackField = field({ label: 'Feedback for the student and family', control: feedbackInput });

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

  const form = h('form', { class: 'rvw-form', novalidate: true }, scoreField, feedbackField, formError, actions);

  const read = () => ({ score: scoreInput.value, feedback: feedbackInput.value });

  for (const [input, fieldEl] of [[scoreInput, scoreField], [feedbackInput, feedbackField]]) {
    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') setFieldError(fieldEl, '');
      onInput?.(read());
    });
  }

  // Put the caret back where it was, so the refocus after a redraw does not
  // jump to the end of the text; report caret moves so the page can keep them
  const inputs = { score: scoreInput, feedback: feedbackInput };
  const caretInput = caret ? inputs[caret.field] : null;
  if (caretInput) {
    const max = caretInput.value.length;
    const startAt = Math.min(Math.max(Number(caret.start) || 0, 0), max);
    const endAt = Math.min(Math.max(Number(caret.end) || startAt, startAt), max);
    try { caretInput.setSelectionRange(startAt, endAt); } catch { /* not a text control */ }
  }
  if (onCaret) {
    for (const [fieldName, input] of Object.entries(inputs)) {
      const report = () => onCaret({ field: fieldName, start: input.selectionStart, end: input.selectionEnd });
      for (const type of ['input', 'keyup', 'mouseup', 'select', 'focus']) input.addEventListener(type, report);
    }
  }

  function showFormError(text) {
    if (text) formError.replaceChildren(callout({ tone: 'danger', iconName: 'warning-circle', title: 'That didn’t save.', text }));
    else formError.replaceChildren();
  }

  function check({ release }) {
    const result = validateGrade(read(), { release });
    setFieldError(scoreField, result.errors.score ?? '');
    setFieldError(feedbackField, result.errors.feedback ?? '');
    if (result.errors.score) scoreInput.focus();
    else if (result.errors.feedback) feedbackInput.focus();
    return result;
  }

  // One write at a time; the row must come back or the write did not happen
  let working = false;
  async function write(btn, label, changes) {
    showFormError('');
    const { data, error } = await busy(btn, label, () => sb.from('grades')
      .update(changes)
      .eq('submission_id', sub.id)
      .select('submission_id'));
    if (error) {
      showFormError(`${error.message || 'Something went wrong.'} Try again.`);
      return false;
    }
    if (!data?.length) {
      showFormError('This grade could not be changed. Refresh the page and try again.');
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
    const { ok, values } = check({ release: true });
    if (!ok) return;
    const releasedAt = new Date().toISOString();
    if (await write(primary, 'Releasing…', { ...values, released_at: releasedAt })) {
      onReleased?.({ ...values, released_at: releasedAt });
    }
  }

  // A released grade must stay complete, so it validates like a release
  async function saveChanges() {
    const { ok, values } = check({ release: true });
    if (!ok) return;
    if (await write(primary, 'Saving…', values)) onSaved?.({ kind: 'changes', values });
  }

  async function unrelease() {
    const previous = g.released_at;
    if (await write(secondary, 'Unreleasing…', { released_at: null })) onUnreleased?.({ previous });
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
  // Released: read-only grade, then the editor inside "Edit or unrelease"

  const releasedLine = `Released ${dateLabel(g.released_at, now)}${releasedBy ? ` by ${releasedBy}` : ''}`;
  card.append(h('div', { class: 'rvw-released' },
    h('p', { class: 'rvw-figure' },
      h('span', { class: 'rvw-figure-score' }, hasValue(g.score) ? String(g.score) : 'No score'),
      hasValue(g.score) ? h('span', { class: 'rvw-figure-max' }, '/100') : null,
      hasValue(g.score) ? visuallyHidden(' out of 100') : null),
    g.feedback ? h('p', { class: 'read is-pre rvw-released-feedback' }, g.feedback) : null,
    h('p', { class: 'rvw-released-by num', title: `Released ${stampLabel(g.released_at, now)}` }, releasedLine)));

  const editCaret = icon('caret-right');
  editCaret.classList.add('rvw-edit-caret');
  const changed = initial && (String(initial.score ?? '') !== String(g.score ?? '') || String(initial.feedback ?? '') !== String(g.feedback ?? ''));
  const edit = h('details', { class: 'rvw-edit', open: Boolean(editOpen || changed) },
    h('summary', { class: 'rvw-edit-summary', dataset: { focusKey: 'rvw-edit' } }, editCaret, icon('pencil-simple'), h('span', {}, 'Edit or unrelease')),
    form);
  if (onEditToggle) edit.addEventListener('toggle', () => onEditToggle(edit.open));
  card.append(edit);
  return card;
}
