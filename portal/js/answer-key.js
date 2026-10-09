// The answer key of an assignment (table task_answer_keys): staff only. The
// database lets only the staff who teach the student (and the admin) read or
// write it, and the grader reads it to check work. Students and parents never
// load this module, and nothing they can open shows a key.
//
// answerKeySection(dctx, { taskId, body, onSaved }) -> section for the staff
// item drawer: collapsed under "Answer key (only staff see this)", with Edit.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { sb } from './supabase.js';
import { button, busy } from './ui.js';
import { openDocViewer } from './doc-viewer.js';
import { parseKey, hasMath } from './homework-doc.js';
import { richText } from './homework-view.js';
import { typesetIn } from './math.js';

export const MAX_ANSWER_KEY = 20000;
export const ANSWER_KEY_HEADING = 'Answer key (only staff see this)';
export const ANSWER_KEY_HINT = 'Only staff see this. The AI grader uses it to check the work and never shows it to the student.';

// The key as the portal shows it: grouped by part, each answer by its ref
// (A1, B3...) with its steps, math typeset. A key a tutor typed shows as typed.
export function keyView(body) {
  const groups = parseKey(body);
  let node;
  if (!groups) {
    node = h('div', { class: 'hw-key' }, h('p', { class: 'read is-pre asg-key-text' }, ...richText(body, { breaks: false })));
  } else {
    node = h('div', { class: 'hw-key' }, groups.map((g) => h('section', { class: 'hw-key-group' },
      g.heading ? h('h4', { class: 'hw-key-heading' }, ...richText(g.heading)) : null,
      h('ol', { class: 'hw-key-list' }, g.entries.map((e) => h('li', { class: 'hw-key-entry' },
        h('span', { class: 'hw-key-ref' }, e.ref),
        h('div', { class: 'hw-key-body' },
          h('p', { class: 'hw-key-answer' }, ...richText(e.answer)),
          e.steps.length ? h('ol', { class: 'hw-key-steps' }, e.steps.map((st) => h('li', {}, ...richText(st)))) : null)))))));
  }
  if (hasMath(body)) typesetIn(node).catch((error) => console.error(error));
  return node;
}

// The key's text, or null when there is none
export async function loadAnswerKey(taskId) {
  const { data, error } = await sb.from('task_answer_keys').select('body').eq('task_id', taskId).maybeSingle();
  if (error) throw error;
  return data?.body ?? null;
}

// Adds the same key to new assignments (one, or every copy of a repeat).
// Resolves with null, or an error.
export async function addAnswerKeys(taskIds, body) {
  const text = String(body ?? '').trim().slice(0, MAX_ANSWER_KEY);
  if (!text || !taskIds.length) return null;
  const { error } = await sb.from('task_answer_keys').insert(taskIds.map((id) => ({ task_id: id, body: text }))).select('task_id');
  return error ?? null;
}

// Saves an edit: empty text removes the key; otherwise update it, or add it
// when there was none. Resolves with the saved text (or null), throws on failure.
export async function saveAnswerKey(taskId, body) {
  const text = String(body ?? '').trim().slice(0, MAX_ANSWER_KEY);
  if (!text) {
    const { error } = await sb.from('task_answer_keys').delete().eq('task_id', taskId);
    if (error) throw error;
    return null;
  }
  const updated = await sb.from('task_answer_keys').update({ body: text }).eq('task_id', taskId).select('task_id');
  if (updated.error) throw updated.error;
  if (updated.data?.length) return text;
  const added = await sb.from('task_answer_keys').insert({ task_id: taskId, body: text }).select('task_id');
  if (added.error) throw added.error;
  return text;
}

// The drawer section. While it is being edited it carries data-editing, so a
// refresh of the drawer keeps it (and what was typed) as it is.
export function answerKeySection(dctx, { taskId, body = null, onSaved } = {}) {
  const textId = uid('asg-key');
  const section = h('section', { class: 'drawer-section asg-key-section', dataset: { taskId: String(taskId) } });
  const details = h('details', { class: 'asg-key' });
  const summary = h('summary', { class: 'asg-key-summary', dataset: { focusKey: 'asg-key' } },
    icon('caret-right'), h('span', {}, ANSWER_KEY_HEADING));
  summary.firstChild.classList.add('asg-key-caret');
  details.append(summary);
  const content = h('div', { class: 'asg-key-body' });
  details.append(content);
  section.append(details);

  function showRead() {
    delete section.dataset.editing;
    content.replaceChildren(
      body
        ? keyView(body)
        : h('p', { class: 'asg-muted' }, 'No answer key yet. Add one so grading can check the answers.'),
      h('div', { class: 'asg-key-actions' }, button({
        label: body ? 'Edit answer key' : 'Add answer key', size: 'sm', icon: 'pencil-simple', focusKey: 'asg-key-edit', onClick: showEdit,
      })));
  }

  function showEdit() {
    section.dataset.editing = 'true';
    const input = h('textarea', { class: 'input textarea asg-key-input', id: textId, rows: '8', maxlength: String(MAX_ANSWER_KEY), 'aria-describedby': `${textId}-hint` }, body ?? '');
    const problem = h('div', { class: 'asg-key-problem' });
    const save = button({ label: 'Save answer key', variant: 'primary', size: 'sm', focusKey: 'asg-key-save' });
    const cancel = button({ label: 'Cancel', variant: 'ghost', size: 'sm', onClick: () => { showRead(); content.querySelector('button')?.focus(); } });
    save.addEventListener('click', async () => {
      problem.replaceChildren();
      try {
        const saved = await busy(save, 'Saving…', () => saveAnswerKey(taskId, input.value));
        body = saved;
        dctx.toast?.({ text: saved ? 'Answer key saved.' : 'Answer key removed.' });
        showRead();
        content.querySelector('button')?.focus();
        onSaved?.(saved);
      } catch (error) {
        console.error(error);
        if (section.isConnected) {
          problem.replaceChildren(h('p', { class: 'field-error', role: 'alert' }, icon('warning-circle'), h('span', {}, 'We couldn’t save the answer key. Try again.')));
        }
      }
    });
    content.replaceChildren(h('div', { class: 'field' },
      h('label', { class: 'field-label', for: textId }, 'Answer key'),
      input,
      h('p', { class: 'field-hint', id: `${textId}-hint` }, `${ANSWER_KEY_HINT} Leave it empty to remove it.`)),
    problem,
    h('div', { class: 'asg-key-actions' }, cancel, save));
    input.focus();
  }

  showRead();
  return section;
}

// "With answer key" in the worksheet section: the document viewer showing the
// student's worksheet with the key on its own pages at the end. Staff only,
// like everything in this module; the key is read again on each click, so an
// edit shows at once.
export function keyWorksheetButton(dctx, { task }) {
  const btn = button({ label: 'With answer key', icon: 'eye', size: 'sm', focusKey: 'ws-key' });
  btn.addEventListener('click', async () => {
    try {
      await busy(btn, 'Preparing…', async () => {
        const body = await loadAnswerKey(task.id);
        openDocViewer({
          source: { title: task.title, details: task.details, dueAt: task.due_at }, keyText: body, withKey: true, returnFocus: btn, toast: dctx.toast,
        });
      });
    } catch (error) {
      console.error(error);
      dctx.toast?.({ text: 'We couldn’t make the worksheet. Try again.' });
    }
  });
  return btn;
}
