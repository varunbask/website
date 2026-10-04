// Review page, #/review/<submissionId>?filter=... (spec 5.9).
// The submitted file on the left, the grade editor on the right (last on
// narrower screens), a "3 of 7" pager in the top bar. Releasing writes at
// once and shows a shell toast with Undo; the toast lives outside the view,
// so Undo still works after "Next in queue" or any other navigation.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { sb } from '../supabase.js';
import { avatar, button, iconButton, emptyState, errorCallout, pill, draftChip } from '../ui.js';
import { one, displayName, firstName } from '../format.js';
import { dueLabel } from '../dates.js';
import { submissionStatus } from '../status.js';
import { staffNames } from '../updates-feed.js';
import { startGrading } from '../grading.js';
import { filePreview } from '../file-preview.js';
import { workIcon } from '../labels.js';
import { gradeEditor } from '../grade-editor.js';
import { answerView } from '../rich-doc-dom.js';
import {
  normalizeFilter, queueOrder, neighbors, attemptInfo, reviewHref, stampLabel,
} from '../review-model.js';

const FIELDS = 'id, task_id, student_id, body, body_doc, storage_path, file_type, note, status, error, attempts, '
  + 'status_changed_at, created_at, student:profiles(full_name, email), task:tasks(title, details, due_at), '
  + 'grade:grades(score, feedback, reviewed_by, reviewed_at, released_at)';

const JUST_RELEASED_MS = 10 * 60 * 1000;

// Kept only across refresh re-renders: a store change (after the tutor's own
// save or release, a retry, the visibility refresh) remounts the view, and the
// tutor's typing, caret, open editor or "Released just now" panel must survive
// that. A fresh visit (not a refresh) clears them, so abandoned typing never
// overrides the stored grade and an old release never shows as "just now".
const justReleased = new Map();   // submission id -> { at, nextId }
const unsaved = new Map();        // submission id -> { score, feedback }
const carets = new Map();         // submission id -> { field, start, end }
const editOpen = new Set();       // submission ids whose "Edit or unrelease" is open

const NARROW = '(max-width: 1279.98px)';
const matches = (query) => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

const queueHref = (filter) => (filter === 'all' ? '#/review' : `#/review?filter=${filter}`);

function skeleton() {
  return h('div', { class: 'rvw-layout', 'aria-busy': 'true' },
    h('div', { class: 'rvw-main' },
      h('div', { class: 'rvw-file' },
        h('div', { class: 'rvw-file-bar' }, h('span', { class: 'skeleton rvw-sk-bar' })),
        h('div', { class: 'rvw-file-stage' }, h('div', { class: 'rvw-file-loading' }, h('span', { class: 'skeleton rvw-file-skeleton' }))))),
    h('div', { class: 'rvw-side' },
      h('div', { class: 'card rvw-editor' },
        h('span', { class: 'skeleton rvw-sk-line' }),
        h('span', { class: 'skeleton rvw-sk-line is-short' }),
        h('span', { class: 'skeleton rvw-sk-input' }),
        h('span', { class: 'skeleton rvw-sk-area' }))),
    h('span', { class: 'visually-hidden' }, 'Loading…'));
}

// "3 of 7" with previous and next links, for the top bar
function pager(nb, filter) {
  const link = (targetId, iconName, label, tip) => {
    if (targetId === null) {
      const btn = iconButton({ icon: iconName, label, tip: false });
      btn.disabled = true;
      return btn;
    }
    return h('a', { class: 'icon-btn has-tip', href: reviewHref(targetId, filter), 'aria-label': label },
      icon(iconName), h('span', { class: tip, 'aria-hidden': 'true' }, label));
  };
  return h('div', { class: 'rvw-pager', role: 'group', 'aria-label': 'Review queue position' },
    link(nb.prevId, 'caret-left', 'Previous submission', 'tip'),
    h('span', { class: 'rvw-pager-pos num' }, `${nb.index + 1} of ${nb.total}`),
    link(nb.nextId, 'caret-right', 'Next submission', 'tip tip-end'));
}

function attemptRow(other, n, { filter, now }) {
  const g = one(other.grade);
  const status = submissionStatus(other, g, { audience: 'staff' });
  const draft = g && !g.released_at && g.score !== null && g.score !== undefined ? draftChip(g.score) : null;
  const when = stampLabel(other.created_at, now);
  return h('li', {}, h('a', {
    class: 'row',
    href: reviewHref(other.id, filter),
    'aria-label': [`Attempt ${n}`, `submitted ${when}`, draft?.textContent, status.label].filter(Boolean).join(', '),
    dataset: { focusKey: `sub-${other.id}` },
  },
  h('span', { class: 'row-lead tone-neutral' }, icon(workIcon(other))),
  h('span', { class: 'row-main' },
    h('span', { class: 'row-title' }, `Attempt ${n}`),
    h('span', { class: 'row-meta num' }, `Submitted ${when}`)),
  h('span', { class: 'row-aside' }, h('span', { class: 'row-status' }, draft, pill(status))),
  (() => { const c = icon('caret-right'); c.classList.add('row-caret'); return c; })()));
}

export async function mount(ctx) {
  const id = ctx.route.id;
  const key = String(id ?? '');
  const filter = normalizeFilter(ctx.route.params.filter);
  if (!ctx.isRefresh) {
    unsaved.delete(key);
    justReleased.delete(key);
    carets.delete(key);
    editOpen.delete(key);
  }
  const body = h('div', { class: 'rvw-page' }, skeleton());
  ctx.host.append(body);

  const unavailable = () => {
    ctx.setHeader({ title: 'Review' });
    body.replaceChildren(emptyState({
      icon: 'tray',
      text: 'This submission isn’t available. It may have been deleted.',
      action: { label: 'Back to review queue', href: queueHref(filter) },
    }));
    ctx.announce('Review, submission not available');
  };

  // A malformed id (#/review/abc) would fail in Postgres as a load error
  if (!/^\d+$/.test(key)) {
    unavailable();
    return;
  }

  const [result, ws, names] = await Promise.all([
    sb.from('submissions').select(FIELDS).eq('id', id).maybeSingle().then((r) => r, (error) => ({ error })),
    ctx.store.getWorkspace().catch(() => null),
    staffNames().catch(() => new Map()),
  ]);
  if (!ctx.alive()) return;

  if (result.error) {
    console.error(result.error);
    ctx.setHeader({ title: 'Review' });
    body.replaceChildren(errorCallout({
      title: 'We couldn’t load this submission.',
      text: 'Check your connection and try again.',
      onRetry: () => ctx.store.invalidate(null),
    }));
    ctx.announce('Review, could not load');
    return;
  }

  const sub = result.data ? { ...result.data, grade: one(result.data.grade) } : null;
  if (!sub) {
    unavailable();
    return;
  }

  const student = one(sub.student);
  const task = one(sub.task);
  const studentId = sub.student_id;
  const profile = student ?? ws?.students.find((s) => s.id === studentId) ?? null;
  const name = profile ? displayName(profile) : 'Student';
  const first = firstName(profile?.full_name || name);
  const title = task?.title || 'Assignment';

  // Other attempts at the same assignment (newest first), from the student's data
  let taskSubs = null;
  try {
    const data = await ctx.store.getStudentData(studentId);
    taskSubs = data.subsByTask.get(sub.task_id) ?? null;
  } catch {
    taskSubs = null;
  }
  if (!ctx.alive()) return;
  if (!taskSubs) taskSubs = (ws?.submissions ?? []).filter((s) => s.task_id === sub.task_id);
  if (!taskSubs.some((s) => String(s.id) === String(sub.id))) taskSubs = [sub, ...taskSubs];
  const info = attemptInfo(sub, taskSubs);
  const late = Boolean(task?.due_at && Date.parse(sub.created_at) > Date.parse(task.due_at));

  // Queue position within the current filter
  const queue = ws ? queueOrder(ws.submissions, filter) : [];
  const nb = neighbors(queue, sub.id);
  const others = queue.filter((s) => String(s.id) !== String(sub.id));
  const nextAfterRelease = nb.index >= 0 ? (nb.nextId ?? others[0]?.id ?? null) : (others[0]?.id ?? null);

  // Header, crumbs, pager
  const due = task?.due_at ? dueLabel(task.due_at, ctx.now) : null;
  const lede = h('p', { class: 'view-lede rvw-lede' },
    h('span', { class: 'rvw-lede-name' }, name),
    due ? h('span', { class: 'rvw-lede-due num', title: due.full }, due.text) : null);
  ctx.setHeader({
    title,
    lead: avatar(name, { size: 40 }),
    lede,
    docTitle: `Review: ${title}`,
    crumbs: [
      { label: 'Review queue', href: queueHref(filter) },
      { label: name, href: `?student=${encodeURIComponent(studentId)}#/overview` },
      { label: title },
    ],
  });
  ctx.setTopbarActions(nb.index >= 0 ? [pager(nb, filter)] : []);

  // Left column: typed answer, file, note, instructions, other attempts
  const main = h('div', { class: 'rvw-main' });
  if (typeof sub.body === 'string' && sub.body.trim()) {
    main.append(h('section', { class: 'rvw-block rvw-answer', 'aria-label': 'Typed answer' },
      h('h2', { class: 'rvw-block-title' }, `${first}’s answer`, h('span', { class: 'rvw-file-attempt' }, `attempt ${info.n}`)),
      answerView(sub, { className: 'rvw-answer-text' })));
  }
  if (sub.storage_path) main.append(filePreview(sub, { signal: ctx.signal, attempt: info.n }));

  if (sub.note) {
    main.append(h('section', { class: 'rvw-block' },
      h('h2', { class: 'rvw-block-title' }, `Note from ${first}`),
      h('blockquote', { class: 'quote rvw-note' }, sub.note)));
  }

  const caret = icon('caret-right');
  caret.classList.add('rvw-disclosure-caret');
  main.append(h('details', { class: 'rvw-block rvw-disclosure' },
    h('summary', { class: 'rvw-disclosure-summary' }, caret, h('span', {}, 'Assignment instructions')),
    task?.details
      ? h('p', { class: 'read is-pre rvw-instructions' }, task.details)
      : h('p', { class: 'rvw-muted' }, 'No extra instructions.')));

  const ordered = [...taskSubs].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || Number(a.id) - Number(b.id));
  const otherRows = ordered
    .map((s, i) => ({ s, n: i + 1 }))
    .filter(({ s }) => String(s.id) !== String(sub.id))
    .reverse()
    .map(({ s, n }) => attemptRow(s, n, { filter, now: ctx.now }));
  if (otherRows.length) {
    main.append(h('section', { class: 'rvw-block' },
      h('h2', { class: 'rvw-block-title' }, 'Other attempts'),
      h('ul', { class: 'row-list rvw-attempts', 'aria-label': 'Other attempts' }, otherRows)));
  }

  // Right column: the editor
  const side = h('div', { class: 'rvw-side' });
  let grade = one(sub.grade);

  function releasedPanel(nextId) {
    const check = icon('check-circle', { size: 20 });
    check.classList.add('callout-icon');
    const action = nextId !== null && nextId !== undefined
      ? button({ label: 'Next in queue', variant: 'primary', size: 'sm', href: reviewHref(nextId, filter), iconEnd: 'caret-right', focusKey: 'rvw-primary' })
      : button({ label: 'Back to review queue', variant: 'primary', size: 'sm', href: queueHref(filter), focusKey: 'rvw-primary' });
    return h('div', { class: 'callout tone-success rvw-just-released' }, check,
      h('div', { class: 'callout-body' },
        h('p', { class: 'callout-title' }, 'Released just now'),
        h('p', { class: 'callout-text' }, `${first}’s family can see this grade.`),
        h('div', { class: 'callout-actions' }, action)));
  }

  // The row must come back or the write did not happen (RLS can block it silently)
  const writeReleasedAt = async (releasedAt) => {
    try {
      const { data, error } = await sb.from('grades').update({ released_at: releasedAt })
        .eq('submission_id', sub.id).select('submission_id');
      if (error) console.error(error);
      return !error && Boolean(data?.length);
    } catch (error) {
      console.error(error);
      return false;
    }
  };

  async function undoRelease() {
    if (!(await writeReleasedAt(null))) {
      ctx.toast({ text: 'We couldn’t undo the release. Open the submission and unrelease it.' });
      return;
    }
    justReleased.delete(String(sub.id));
    ctx.store.invalidate(studentId);
    ctx.toast({ text: 'Release undone. The grade is a draft again.' });
  }

  async function undoUnrelease(previous) {
    if (!(await writeReleasedAt(previous))) {
      ctx.toast({ text: 'We couldn’t release the grade again. Open the submission and release it.' });
      return;
    }
    ctx.store.invalidate(studentId);
    ctx.toast({ text: `Grade released again. ${first}’s family can see it now.` });
  }

  function renderEditor({ focus } = {}) {
    if (!ctx.alive()) return;
    const jr = justReleased.get(key);
    const recent = grade?.released_at && jr && Date.now() - jr.at < JUST_RELEASED_MS;
    const reviewer = grade?.reviewed_by ? names.get(grade.reviewed_by) : null;
    const editor = gradeEditor(sub, grade, {
      now: ctx.now,
      attempt: info,
      late,
      releasedBy: reviewer ? firstName(reviewer) : null,
      afterRelease: recent ? releasedPanel(jr.nextId) : null,
      initial: unsaved.get(key) ?? null,
      onInput: (values) => unsaved.set(key, values),
      caret: carets.get(key) ?? null,
      onCaret: (value) => carets.set(key, value),
      editOpen: editOpen.has(key),
      onEditToggle: (open) => (open ? editOpen.add(key) : editOpen.delete(key)),
      onRetry: async () => {
        const problem = await startGrading(sub.id);
        if (!problem) {
          // The retry button may be gone from the next render (canRetry turns
          // false), so hand focus to the score field first: the refresh swap
          // restores it by key and busy() leaves it alone
          if (ctx.alive() && side.contains(document.activeElement)) {
            side.querySelector('[data-focus-key="rvw-score"]')?.focus({ preventScroll: true });
          }
          ctx.toast({ text: 'Grading started.' });
          ctx.store.invalidate(studentId);
        }
        return problem;
      },
      onSaved: ({ kind, values }) => {
        unsaved.delete(key);
        grade = { ...(grade ?? {}), ...values };
        ctx.toast({ text: kind === 'draft' ? 'Draft saved.' : 'Changes saved.' });
        ctx.store.invalidate(studentId);
      },
      onReleased: (values) => {
        unsaved.delete(key);
        justReleased.set(key, { at: Date.now(), nextId: nextAfterRelease });
        grade = { ...(grade ?? {}), ...values };
        ctx.setTopbarActions([]);
        renderEditor({ focus: '[data-focus-key="rvw-primary"]' });
        // On narrower screens the editor is last in the page and the floating
        // bar is gone, so bring the "Released just now" panel into view. An
        // instant jump: the refresh swap that follows restores window.scrollY,
        // which would cut a smooth scroll short
        if (matches(NARROW)) {
          side.querySelector('.rvw-just-released')?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
        ctx.toast({ text: `Grade released. ${first}’s family can see it now.`, action: { label: 'Undo', run: undoRelease } });
        ctx.store.invalidate(studentId);
      },
      onUnreleased: ({ previous }) => {
        justReleased.delete(key);
        editOpen.delete(key);
        grade = { ...(grade ?? {}), released_at: null };
        // Not "Release to family": a stray Enter must never re-release
        renderEditor({ focus: '[data-focus-key="rvw-score"]' });
        ctx.toast({
          text: `Grade unreleased. ${first}’s family can no longer see it.`,
          action: { label: 'Undo', run: () => undoUnrelease(previous) },
        });
        ctx.store.invalidate(studentId);
      },
    });
    side.replaceChildren(editor);
    if (focus) side.querySelector(focus)?.focus({ preventScroll: true });
  }
  renderEditor();

  body.replaceChildren(h('div', { class: 'rvw-layout' }, main, side));
  ctx.announce(`Review, ${title}, ${name}`);
}
