// The task checkbox (spec 5.11, 5.6). One control for every place a task can be
// ticked off: the Tasks view, the item drawer and the Overview cards.
//
// taskCheck(item, ctx, { size = 'md', onChange }) -> HTMLElement
//   item     a derived Item (buckets.deriveItems) whose task has kind 'task'
//   ctx      a view ctx or a drawer dctx: reads role, readOnly, scope, store, toast
//   size     'md': a 20px box in a 44px hit area; the label is visually hidden
//            'lg': a bordered 44px control with the visible label "Mark as done"
//   onChange optional (done) => void, called on every optimistic change and revert
//
// Students tick through rpc('set_task_done'); staff through tasks.update (staff
// never call set_task_done, it raises P0002 for non-students). Parents, and any
// read-only viewer, get a glyph with "Done" / "Not done yet" instead of an input.
//
// A toggle is optimistic: the box and the row's title change at once, the write
// runs, and 600ms after the last write settles the store is invalidated so every
// list, badge and overview moves the task together. Marking done toasts "Marked
// done." with Undo; unchecking toasts "Marked not done.". A failed write reverts,
// shows "We couldn’t update that task. Try again." under the row (or after the
// control) and puts focus back on the box.
//
// A failed write is remembered for a short while, so a store refresh that
// redraws the row (another task's write settling) keeps the error under it.
//
// Markup (styled in tasks.css):
//   label.tsk-check[.is-lg] > input.tsk-box[type=checkbox][data-focus-key="task-<id>"]
//     + span.tsk-mark[aria-hidden] > svg.icon (check) ; then the label text
//   span.tsk-glyph[.is-lg].tone-* > svg.icon + (visually hidden | visible) text
// When the control sits in an <li> next to an a.row (a row list), the row gets
// .is-done while the task is ticked. Every change also dispatches a bubbling
// "taskcheck" CustomEvent with detail { taskId, done } from the control.

import { h } from './dom.js';
import { icon } from './icons.js';
import { visuallyHidden } from './ui.js';
import { toast as defaultToast } from './overlays.js';

export const SETTLE_MS = 600;
export const ERROR_TEXT = 'We couldn’t update that task. Try again.';

const STAFF = new Set(['tutor', 'admin']);

// ---------------------------------------------------------------------------
// Pure logic

// 'student' | 'staff' | 'readonly': who may tick, and through which call
export function checkMode(ctx) {
  if (!ctx || ctx.readOnly) return 'readonly';
  if (ctx.role === 'student') return 'student';
  if (STAFF.has(ctx.role)) return 'staff';
  return 'readonly';
}

// The checkbox's accessible name in lists: Done: Read chapter 3. The checked
// state says whether it is done, so the name reads right both ways
export function checkLabel(title) {
  const t = String(title ?? '').trim() || 'Untitled';
  return `Done: ${t}`;
}

// The write for a toggle, as data (the runtime turns it into a supabase call)
export function doneWrite(mode, taskId, done, now = new Date()) {
  if (mode === 'student') {
    return { type: 'rpc', fn: 'set_task_done', args: { p_task_id: taskId, p_done: Boolean(done) } };
  }
  if (mode === 'staff') {
    return { type: 'update', table: 'tasks', id: taskId, values: { completed_at: done ? now.toISOString() : null } };
  }
  return null;
}

// Toast text after a successful toggle
export function toastText(done) {
  return done ? 'Marked done.' : 'Marked not done.';
}

// ---------------------------------------------------------------------------
// Writes

let client = null;
async function supabase() {
  if (!client) client = (await import('./supabase.js')).sb;
  return client;
}

async function runWrite(write) {
  const sb = await supabase();
  const result = write.type === 'rpc'
    ? await sb.rpc(write.fn, write.args)
    : await sb.from(write.table).update(write.values).eq('id', write.id);
  if (result?.error) throw result.error;
}

// Writes for one task run one after another, so a fast check and uncheck land in order
const chains = new Map();
function queue(taskId, job) {
  const key = String(taskId);
  const run = (chains.get(key) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => {});
  chains.set(key, tail);
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return run;
}

// One store refresh 600ms after the last write settles (never while one is in flight)
let inFlight = 0;
let settleTimer = null;
const dirty = new Map();   // studentId -> store to invalidate

function begin() {
  inFlight += 1;
  clearTimeout(settleTimer);
  settleTimer = null;
}

function finish(store, studentId, changed) {
  inFlight = Math.max(0, inFlight - 1);
  if (changed && store) dirty.set(String(studentId ?? ''), { store, studentId });
  if (inFlight > 0 || !dirty.size) return;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (inFlight > 0) return;
    const jobs = [...dirty.values()];
    dirty.clear();
    for (const { store: s, studentId: id } of jobs) s.invalidate(id ?? null);
  }, SETTLE_MS);
}

// Tasks whose last write failed: id -> time. Cleared on the task's next change
// or success; an old failure is not shown again on a later visit
const FAILED_MS = 30000;
const failed = new Map();

function markFailed(taskId) {
  failed.set(String(taskId), Date.now());
}

function clearFailed(taskId) {
  failed.delete(String(taskId));
}

function hasFailed(taskId) {
  const key = String(taskId);
  const at = failed.get(key);
  if (at === undefined) return false;
  if (Date.now() - at > FAILED_MS) {
    failed.delete(key);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// DOM

function readOnlyGlyph(done, size) {
  const text = done ? 'Done' : 'Not done yet';
  const lg = size === 'lg';
  return h('span', { class: ['tsk-glyph', 'tone-neutral', lg ? 'is-lg' : null].filter(Boolean).join(' ') },
    icon(done ? 'check-circle' : 'circle', { size: lg ? 20 : 16 }),
    lg ? h('span', { class: 'tsk-glyph-text' }, text) : visuallyHidden(text));
}

function checkMark() {
  const mark = icon('check', { size: 14 });
  return h('span', { class: 'tsk-mark', 'aria-hidden': 'true' }, mark);
}

export function taskCheck(item, ctx, { size = 'md', onChange } = {}) {
  const task = item?.task ?? {};
  const done = Boolean(task.completed_at);
  const mode = checkMode(ctx);
  const lg = size === 'lg';
  if (mode === 'readonly') return readOnlyGlyph(done, size);

  const taskId = task.id;
  const studentId = task.student_id ?? ctx.scope?.student?.id ?? null;
  const store = ctx.store ?? null;
  const notify = ctx.toast ?? defaultToast;

  const box = h('input', {
    type: 'checkbox',
    class: 'tsk-box',
    dataset: { focusKey: `task-${taskId}` },
  });
  box.checked = done;

  const wrap = h('label', { class: lg ? 'tsk-check is-lg' : 'tsk-check' },
    box,
    checkMark(),
    lg ? h('span', { class: 'tsk-check-text' }, 'Mark as done') : visuallyHidden(checkLabel(task.title)));

  // The row this control sits beside (a Tasks list row), if any
  const rowOf = () => {
    const li = wrap.closest('li');
    return li ? li.querySelector(':scope > a.row, :scope > .row') : null;
  };

  const show = (value) => {
    box.checked = value;
    rowOf()?.classList.toggle('is-done', value);
    wrap.dispatchEvent(new CustomEvent('taskcheck', { bubbles: true, detail: { taskId, done: value } }));
    onChange?.(value);
  };

  let errorEl = null;
  const clearError = () => {
    errorEl?.remove();
    errorEl = null;
  };

  const showError = () => {
    clearError();
    if (!wrap.isConnected) {
      notify({ text: ERROR_TEXT });
      return;
    }
    errorEl = h('p', { class: 'tsk-error', role: 'alert' }, icon('warning-circle'), h('span', {}, ERROR_TEXT));
    const li = wrap.closest('li');
    if (li) li.append(errorEl);
    else wrap.after(errorEl);
  };

  // Undo from the toast: runs after the view may be gone, so it only writes and refreshes
  const undo = (value) => queue(taskId, async () => {
    begin();
    let ok = false;
    try {
      await runWrite(doneWrite(mode, taskId, value, new Date()));
      ok = true;
      clearFailed(taskId);
      if (wrap.isConnected && box.checked !== value) show(value);
      notify({ text: toastText(value) });
    } catch (error) {
      console.error(error);
      notify({ text: ERROR_TEXT });
    } finally {
      finish(store, studentId, ok);
    }
  });

  box.addEventListener('change', () => {
    const want = box.checked;
    clearError();
    clearFailed(taskId);
    show(want);
    queue(taskId, async () => {
      begin();
      let ok = false;
      try {
        await runWrite(doneWrite(mode, taskId, want, new Date()));
        ok = true;
      } catch (error) {
        console.error(error);
      } finally {
        finish(store, studentId, ok);
      }
      if (ok) {
        clearFailed(taskId);
        notify(want
          ? { text: toastText(true), action: { label: 'Undo', run: () => undo(false) } }
          : { text: toastText(false) });
        return;
      }
      // Revert only if nothing newer has changed the box since
      if (box.checked === want) show(!want);
      markFailed(taskId);
      showError();
      if (wrap.isConnected) box.focus();
    });
  });

  // A redraw after a failed write: put the error back once the row is on the
  // page (views attach their rows in the same task they build them)
  if (hasFailed(taskId)) {
    queueMicrotask(() => {
      if (wrap.isConnected && !errorEl && hasFailed(taskId)) showError();
    });
  }

  return wrap;
}
