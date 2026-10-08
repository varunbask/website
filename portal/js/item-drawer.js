// The item drawer (spec 5.6 and 5.7): details for an assignment or task, the
// student's upload, submission history, and for staff create, edit, mark done
// and delete. The drawer host (drawer.js) owns the dialog; this file fills it.
//
// Staff see an assignment's answer key (answer-key.js), collapsed, with Edit.
// The create and edit form (item-form.js, with the draft panel) and the answer
// key are imported with import() on staff paths only, so student.html and
// parent.html never download them or their staff wording. A test walks the
// static imports from the family pages to keep it that way.
//
// Staff can also Extend an assignment still waiting on the student (To do,
// Missing, or archived as missing): a new due date, checked like the review
// page's Extended (results.js), that keeps the first original due date in
// tasks.extended_from. Families never see it.
//
// renderItemDrawer(dctx)
//   dctx.taskId 'new'  the create form (staff only; params kind and due, session
//                      for homework set in a lesson, draft=1 to open the panel
//                      that drafts it from lesson photos)
//   dctx.taskId <id>   the item. Staff whose scope does not hold the task (Today,
//                      the all-students calendar) find its student in the
//                      workspace and load that student's data.
//
// Store changes re-render the detail in place (dctx.onRefresh) so focus and
// scroll survive. The student's upload section is carried over as is (chosen
// file, note, busy state) while it still applies; the create and edit forms
// ignore store changes.

import { h } from './dom.js';
import { icon } from './icons.js';
import { pill, draftChip, emptyState, errorCallout, button, busy, timeEl, drawerHref, field, setFieldError } from './ui.js';
import { menu } from './overlays.js';
import { itemStatus, submissionStatus, resultStatus } from './status.js';
import { resultOf, checkExtension, extensionChanges, extensionTimeText } from './results.js';
import { dueLabel, dayKey, parseKey, todayKey, relativeTime } from './dates.js';
import { MAX_SUBMISSIONS } from './buckets.js';
import { SUPPORT_EMAIL, supportMailto } from './help-model.js';
import { workLabel, workIcon } from './labels.js';
import { displayName, firstName } from './format.js';
import { staffNames } from './updates-feed.js';
import { taskCheck } from './task-check.js';
import { submitWorkSection } from './submit-work.js';
import { materialsSection, filesOn, removeFilesOf } from './materials-ui.js';
import { materialsFor, lessonLabel } from './materials-model.js';
import { tutorToneClass } from './sessions-model.js';
import { renderSessionCreate, renderSessionDetail } from './session-drawer.js';
import { renderSessionNotes } from './session-notes-drawer.js';
import { notesDrawerSession } from './schedule-summary.js';
import { renderProfileDrawer } from './student-profile-drawer.js';
import { PROFILE_DRAWER } from './student-profile-model.js';
import { sb } from './supabase.js';
import { answerView } from './rich-doc-dom.js';
import { followingInTaskSeries, seriesPosition, seriesText, itemNoun } from './task-repeat-model.js';
import { worksheetSection } from './worksheet-ui.js';
import { homeworkView } from './homework-view.js';
import { hasWorksheet } from './worksheet-model.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SUBMITTED = 'Work submitted. Your tutor will review it soon.';
const GONE = 'This item was changed or removed. Refresh the page and try again.';
// The portal has no messaging, so the way out of the attempt limit is the
// support address (also on the Help page). A sentence with a mail link.
const atCapText = () => [
  `You’ve used all ${MAX_SUBMISSIONS} attempts for this assignment. If you need to send another file, ask your tutor or email `,
  h('a', { class: 'link', href: supportMailto('Another attempt on an assignment') }, SUPPORT_EMAIL),
  '.',
];
const MISSING = 'This assignment isn’t available. It may have been deleted.';
const HAS_WORK = 'This assignment has submitted work, so it cannot be deleted.';
const SOME_HAVE_WORK = 'Some of these have submitted work, so they cannot be deleted. Refresh the page and try again.';

const blank = (v) => v === null || v === undefined || v === '';

// Staff-only modules, fetched when staff first need them (never by families)
const staffForm = () => import('./item-form.js');
const answerKeyModule = () => import('./answer-key.js');
const sameId = (a, b) => String(a) === String(b);

// "Oct 5", or "Oct 5, 2025" in another year (business zone)
function shortDate(iso, now) {
  const { y, m, d } = parseKey(dayKey(iso));
  return `${MONTHS[m - 1]} ${d}${y === parseKey(todayKey(now)).y ? '' : `, ${y}`}`;
}

function callout({ tone = 'neutral', icon: iconName = 'info', title, text, role }) {
  const glyph = icon(iconName, { size: 20 });
  glyph.classList.add('callout-icon');
  return h('div', { class: `callout tone-${tone}`, role },
    glyph,
    h('div', { class: 'callout-body' },
      title ? h('p', { class: 'callout-title' }, title) : null,
      text ? h('p', { class: 'callout-text' }, text) : null));
}

function section(title, ...children) {
  return h('section', { class: 'drawer-section' }, h('h3', {}, title), ...children);
}

export function renderItemDrawer(dctx) {
  // Tutoring sessions share the drawer: open=s<id>, open=new-session and, from
  // Today, open=notes-s<id> (the notes form on its own)
  if (dctx.taskId === 'new-session') return renderSessionCreate(dctx);
  if (notesDrawerSession(dctx.taskId)) return renderSessionNotes(dctx);
  if (dctx.taskId === PROFILE_DRAWER) return renderProfileDrawer(dctx);
  if (/^s\d+$/.test(dctx.taskId)) return renderSessionDetail(dctx);
  if (dctx.taskId === 'new') return renderCreate(dctx);
  return renderItem(dctx);
}

// ---------------------------------------------------------------------------
// Create (open=new&kind=...&due=...)

async function renderCreate(dctx) {
  if (dctx.audience !== 'staff' || dctx.readOnly) {
    paintMissing(dctx);
    return;
  }
  const kind = dctx.params?.kind === 'task' ? 'task' : 'assignment';
  // The Student select shows without a selected student and on the
  // all-students calendar, where ?student= may linger from the switcher (spec
  // 3.6); there it starts on that student but stays visible and changeable.
  const workspace = dctx.params?.scope === 'all' || dctx.route?.view === 'today';
  let studentOptions = null;
  if (!dctx.scope?.student || workspace) {
    try {
      const ws = await dctx.store.getWorkspace();
      studentOptions = ws.students ?? [];
    } catch (error) {
      if (!dctx.alive()) return;
      console.error(error);
      paintError(dctx, { onRetry: () => dctx.store.invalidate(null) });
      return;
    }
    if (!dctx.alive()) return;
  }
  // Homework set in a lesson (open=new&session=<id>): the lesson fixes the student
  let lesson = null;
  if (/^\d+$/.test(String(dctx.params?.session ?? ''))) {
    lesson = await findSession(dctx, dctx.params.session).catch(() => null);
    if (!dctx.alive()) return;
  }
  let itemForm;
  try {
    ({ itemForm } = await staffForm());
  } catch (error) {
    if (!dctx.alive()) return;
    console.error(error);
    paintError(dctx, { onRetry: () => dctx.store.invalidate(null) });
    return;
  }
  if (!dctx.alive()) return;
  // Keep what the tutor typed through any store change
  dctx.onRefresh(() => {});
  const form = itemForm(dctx, {
    kind,
    due: dctx.params?.due,
    studentOptions: lesson ? null : studentOptions,
    selectedStudent: lesson ? lesson.student_id : dctx.scope?.student?.id ?? null,
    lesson,
    draft: dctx.params?.draft === '1',
  });
  dctx.header.replaceChildren();
  dctx.headerActions.replaceChildren();
  dctx.body.replaceChildren(form);
  dctx.setTitle(form.dataset.title);
}

// A session by id: the scoped student's sessions first, then (staff) the
// workspace's, then that student's fresh list
async function findSession(dctx, id) {
  const { store } = dctx;
  const pick = (list) => (list ?? []).find((s) => sameId(s.id, id)) ?? null;
  const scoped = dctx.scope?.student ?? null;
  if (scoped) {
    const found = pick(await store.getSessions(scoped.id));
    if (found) return found;
  }
  if (dctx.audience !== 'staff') return null;
  const summary = pick((await store.getWorkspace()).sessions);
  return summary ? pick(await store.getSessions(summary.student_id)) : null;
}

// The task's attachments, the lesson it was set in and (staff, an
// assignment) its answer key. Any failing leaves that part out instead of
// failing the drawer.
async function loadExtras(dctx, found) {
  const keyed = dctx.audience === 'staff' && found.task.kind !== 'task';
  const [materials, lesson, answerKey] = await Promise.all([
    dctx.store.getMaterials(found.studentId).catch((error) => { console.error(error); return null; }),
    found.task.session_id !== null && found.task.session_id !== undefined
      ? dctx.store.getSessions(found.studentId)
        .then((list) => list.find((s) => sameId(s.id, found.task.session_id)) ?? null)
        .catch(() => null)
      : null,
    keyed
      ? answerKeyModule()
        .then(async ({ loadAnswerKey, answerKeySection, keyWorksheetButton }) => ({
          body: await loadAnswerKey(found.task.id), build: answerKeySection, worksheetButton: keyWorksheetButton,
        }))
        .catch((error) => { console.error(error); return null; })
      : null,
  ]);
  return {
    attachments: materials ? materialsFor(materials, { taskId: found.task.id }) : null,
    lesson,
    // { body, build } for staff (body null when there is none; build makes the
    // section); null for families, for tasks, or when it failed
    answerKey,
  };
}

// ---------------------------------------------------------------------------
// Shared states

function paintMissing(dctx) {
  dctx.header.replaceChildren();
  dctx.headerActions.replaceChildren();
  dctx.setFooter(null);
  dctx.body.replaceChildren(
    h('h2', { class: 'drawer-title', tabindex: '-1' }, 'Not available'),
    emptyState({ icon: 'info', text: MISSING, action: { label: 'Close', onClick: () => dctx.close() } }),
  );
  dctx.setTitle('Not available');
}

function paintError(dctx, { onRetry }) {
  dctx.header.replaceChildren();
  dctx.headerActions.replaceChildren();
  dctx.setFooter(null);
  dctx.body.replaceChildren(
    h('h2', { class: 'drawer-title', tabindex: '-1' }, 'Details'),
    errorCallout({
      title: 'We couldn’t load this assignment.',
      text: 'Check your connection and try again.',
      onRetry,
    }),
  );
  dctx.setTitle('Details');
}

// ---------------------------------------------------------------------------
// Data

// { data, task, item, studentId, student, crossScope } or null when unknown
async function locate(dctx, now) {
  const { store } = dctx;
  const id = dctx.taskId;
  const staff = dctx.audience === 'staff';
  const scoped = dctx.scope?.student ?? null;
  const derive = (data) => store.itemsFor(data, { now, audience: dctx.audience, viewerId: dctx.me?.id })
    .find((i) => sameId(i.task.id, id)) ?? null;

  if (scoped) {
    const data = await store.getStudentData(scoped.id);
    const item = derive(data);
    if (item) return { data, item, task: item.task, studentId: scoped.id, student: scoped, crossScope: false };
  }
  if (!staff) return null;

  const ws = await store.getWorkspace();
  const summary = (ws.tasks ?? []).find((t) => sameId(t.id, id));
  if (!summary) return null;
  const data = await store.getStudentData(summary.student_id);
  const item = derive(data);
  if (!item) return null;
  const student = (ws.students ?? []).find((s) => sameId(s.id, summary.student_id)) ?? null;
  return {
    data, item, task: item.task, studentId: summary.student_id, student,
    crossScope: !scoped || !sameId(scoped.id, summary.student_id),
  };
}

// The grade to show: families the newest released one; staff the latest in any
// state, else the newest released one. previous: it belongs to an older attempt.
function gradeToShow(item, audience) {
  const hasContent = (g) => g && (resultOf(g) || !blank(g.feedback));
  if (audience === 'staff' && hasContent(item.grade)) return { sub: item.latest, grade: item.grade, previous: false };
  const sub = item.subs.find((s) => s.grade?.released_at && hasContent(s.grade));
  if (!sub) return null;
  return { sub, grade: sub.grade, previous: sub !== item.latest };
}

// ---------------------------------------------------------------------------
// Detail

function renderItem(dctx) {
  // flash: the next paint shows "Work submitted." (set right before the redraw)
  // focusTitle: a paint still owes the title focus (survives a superseded paint)
  const state = { mode: 'detail', seq: 0, flash: false, focusTitle: false };

  async function paint({ refresh = false, focusTitle = false } = {}) {
    const my = ++state.seq;
    const now = new Date();
    const current = () => dctx.alive() && my === state.seq && state.mode === 'detail';
    let found;
    try {
      found = await locate(dctx, now);
      if (found) Object.assign(found, await loadExtras(dctx, found));
    } catch (error) {
      if (!current()) return;
      console.error(error);
      paintError(dctx, { onRetry: () => dctx.store.invalidate(dctx.scope?.student?.id ?? null) });
      return;
    }
    if (!current()) return;
    if (!found) {
      paintMissing(dctx);
      return;
    }

    const shown = gradeToShow(found.item, dctx.audience);
    let names = null;
    if (shown?.grade?.reviewed_by) {
      try {
        names = await staffNames();
      } catch {
        names = null;
      }
      if (!current()) return;
    }

    // Where focus was, so a refresh can put it back
    const active = document.activeElement;
    const inBody = Boolean(active && dctx.body.contains(active));
    const inMenu = Boolean(active && dctx.headerActions.contains(active));
    const keepKey = refresh && inBody ? active.dataset?.focusKey ?? null : null;
    const caret = inBody && typeof active.selectionStart === 'number'
      ? { start: active.selectionStart, end: active.selectionEnd, dir: active.selectionDirection }
      : null;

    const flash = state.flash;
    state.flash = false;
    const wantTitle = focusTitle || state.focusTitle;
    state.focusTitle = false;

    // The upload section in the drawer now: reused on a refresh unless a
    // submission just landed, so the chosen file and typed note survive
    const keepSubmit = refresh && !flash ? dctx.body.querySelector('.asg-submit') : null;
    // The answer key being edited is kept too, with what was typed
    const keepAnswerKey = refresh ? dctx.body.querySelector('.asg-key-section[data-editing="true"]') : null;

    const view = buildDetail(dctx, found, { now, names, shown, flash, keepSubmit, keepAnswerKey, actions: { enterEdit, toggleDone, remove, removeFollowing, submitted, extend } });
    dctx.header.replaceChildren(...view.status);
    dctx.headerActions.replaceChildren(...view.actions);
    dctx.setFooter(null);
    dctx.body.replaceChildren(...view.nodes);
    dctx.setTitle(found.task.title || 'Untitled');
    state.found = found;

    if (view.live) {
      // Filled a moment after insertion so screen readers announce it
      setTimeout(() => {
        if (!view.live.isConnected) return;
        view.live.append(callout({ tone: 'success', icon: 'check-circle', title: SUBMITTED }));
        view.live.scrollIntoView?.({ block: 'nearest' });
      }, 60);
    }

    const title = dctx.body.querySelector('h2.drawer-title');
    // Focus that fell to the page (its element was removed) comes back here
    const focusLost = () => !document.activeElement || document.activeElement === document.body;
    if (wantTitle) {
      title?.focus();
    } else if (refresh) {
      const esc = globalThis.CSS?.escape ?? ((s) => s);
      const again = keepKey ? dctx.body.querySelector(`[data-focus-key="${esc(keepKey)}"]`) : null;
      if (again) {
        again.focus({ preventScroll: true });
      } else if (inBody && active.isConnected && dctx.body.contains(active)) {
        // A kept node (the upload section) was moved: moving drops focus
        if (document.activeElement !== active) {
          active.focus({ preventScroll: true });
          if (caret) {
            try { active.setSelectionRange(caret.start, caret.end, caret.dir ?? 'none'); } catch { /* not a text field */ }
          }
        }
      } else if (inMenu && dctx.headerActions.querySelector('button')) {
        dctx.headerActions.querySelector('button').focus();
      } else if ((inBody || inMenu || focusLost()) && !dctx.body.contains(document.activeElement)) {
        (view.live ?? title)?.focus({ preventScroll: true });
      }
    }
  }

  // Staff actions ---------------------------------------------------------

  function showActionError(text) {
    const slot = dctx.body.querySelector('.asg-action-error');
    if (!slot) return;
    slot.replaceChildren(callout({ tone: 'danger', icon: 'warning-circle', title: text, role: 'alert' }));
  }

  async function enterEdit() {
    if (!state.found) return;
    let itemForm;
    try {
      ({ itemForm } = await staffForm());
    } catch (error) {
      console.error(error);
      if (dctx.alive()) showActionError('We couldn’t open the editor. Check your connection and try again.');
      return;
    }
    const found = state.found;
    if (!found || !dctx.alive() || state.mode !== 'detail') return;
    state.mode = 'edit';
    state.seq += 1;
    const status = itemStatus(found.item, { audience: dctx.audience });
    dctx.header.replaceChildren(pill(status));
    dctx.headerActions.replaceChildren();
    // Later copies with submitted work are left as they are
    const following = followingInTaskSeries(found.data?.tasks, found.task);
    const hasWork = (t) => (found.data?.subsByTask?.get(t.id) ?? []).length > 0;
    const series = following.filter((t) => sameId(t.id, found.task.id) || !hasWork(t));
    const form = itemForm(dctx, {
      task: found.task,
      series,
      seriesKept: following.length - series.length,
      onCancel: backToDetail,
      onSaved: backToDetail,
    });
    dctx.body.replaceChildren(form);
    dctx.body.scrollTop = 0;
    dctx.setTitle(form.dataset.title);
    form.querySelector('input[name="title"]')?.focus();
  }

  function backToDetail() {
    state.mode = 'detail';
    // Kept on state: the store change a save causes supersedes this paint
    state.focusTitle = true;
    dctx.setFooter(null);
    paint();
  }

  async function toggleDone() {
    const found = state.found;
    if (!found) return;
    const done = !found.task.completed_at;
    const result = await sb.from('tasks')
      .update({ completed_at: done ? new Date().toISOString() : null })
      .eq('id', found.task.id)
      .select('id');
    if (result.error || !result.data?.length) {
      if (result.error) console.error(result.error);
      if (dctx.alive()) showActionError(result.error ? 'We couldn’t update that task. Try again.' : GONE);
      return;
    }
    dctx.store.invalidate(found.studentId);
    dctx.toast({ text: done ? 'Marked done.' : 'Marked not done.' });
  }

  async function remove() {
    const found = state.found;
    if (!found) return;
    const title = found.task.title || 'Untitled';
    const who = found.student ? `${firstName(displayName(found.student))}’s` : 'the student’s';
    const ok = await dctx.confirm({
      title: `Delete “${title}”?`,
      body: `It will be removed from ${who} portal. This can’t be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok || !dctx.alive()) return;
    const files = await filesOn({ taskIds: [found.task.id] });
    const result = await sb.from('tasks').delete().eq('id', found.task.id).select('id');
    if (result.error) {
      console.error(result.error);
      if (dctx.alive()) {
        showActionError(result.error.code === '23503' ? HAS_WORK : 'We couldn’t delete this. Try again.');
      }
      return;
    }
    if (!result.data?.length) {
      if (dctx.alive()) showActionError(GONE);
      return;
    }
    // Its worksheets' files go too (in the background)
    removeFilesOf(files, result.data.map((r) => r.id));
    // Ignore the refresh this causes: the drawer is on its way out
    state.mode = 'deleted';
    state.seq += 1;
    dctx.close();
    dctx.store.invalidate(found.studentId);
    dctx.toast({ text: `Deleted “${title}”.` });
  }

  // A repeating item: this copy and the ones after it. Copies with submitted
  // work stay (work is never deleted); the rest go in one delete.
  async function removeFollowing() {
    const found = state.found;
    if (!found) return;
    const rows = followingInTaskSeries(found.data?.tasks, found.task);
    const hasWork = (t) => (found.data?.subsByTask?.get(t.id) ?? []).length > 0;
    const targets = rows.filter((t) => !hasWork(t));
    const kept = rows.length - targets.length;
    const kind = found.task.kind;
    if (!targets.length) {
      showActionError(`These ${itemNoun(kind, 2)} all have submitted work, so they cannot be deleted.`);
      return;
    }
    const title = found.task.title || 'Untitled';
    const who = found.student ? `${firstName(displayName(found.student))}’s` : 'the student’s';
    const dated = targets.filter((t) => t.due_at);
    const now = new Date();
    const range = dated.length > 1
      ? `, due ${shortDate(dated[0].due_at, now)} to ${shortDate(dated[dated.length - 1].due_at, now)},`
      : '';
    const keepText = kept ? ` ${kept === 1 ? 'One has' : `${kept} have`} submitted work and will stay.` : '';
    const ok = await dctx.confirm({
      title: `Delete ${targets.length} ${itemNoun(kind, targets.length)}?`,
      body: `“${title}”${range} will be removed from ${who} portal. This can’t be undone.${keepText}`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok || !dctx.alive()) return;
    const files = await filesOn({ taskIds: targets.map((t) => t.id) });
    const result = await sb.from('tasks').delete().in('id', targets.map((t) => t.id)).select('id');
    if (result.error) {
      console.error(result.error);
      if (dctx.alive()) showActionError(result.error.code === '23503' ? SOME_HAVE_WORK : 'We couldn’t delete these. Try again.');
      return;
    }
    const removed = result.data ?? [];
    if (!removed.length) {
      if (dctx.alive()) showActionError(GONE);
      return;
    }
    // The deleted copies' files go too (in the background)
    removeFilesOf(files, removed.map((r) => r.id));
    const self = removed.some((r) => sameId(r.id, found.task.id));
    if (self) {
      // Ignore the refresh this causes: the drawer is on its way out
      state.mode = 'deleted';
      state.seq += 1;
      dctx.close();
    }
    dctx.store.invalidate(found.studentId);
    dctx.toast({ text: `Deleted ${removed.length} ${itemNoun(kind, removed.length)}.` });
  }

  // A new due date for an assignment still waiting on the student. The row
  // must still have the due date this drawer showed, so a stale drawer cannot
  // undo someone else's change. Returns an error message, or null when done.
  async function extend(dateKey) {
    const found = state.found;
    if (!found) return GONE;
    const { task } = found;
    const check = checkExtension(dateKey, task.due_at, new Date());
    if (!check.ok) return check.error;
    let query = sb.from('tasks').update(extensionChanges(task, check.dueAt)).eq('id', task.id);
    query = task.due_at ? query.eq('due_at', task.due_at) : query.is('due_at', null);
    const result = await query.select('id');
    if (result.error || !result.data?.length) {
      if (result.error) console.error(result.error);
      return result.error ? 'We couldn’t extend this. Try again.' : GONE;
    }
    dctx.store.invalidate(found.studentId);
    dctx.toast({ text: `Extended to ${shortDate(check.dueAt, new Date())}.` });
    return null;
  }

  // Called by the upload once the submission exists: redraw, then say so
  function submitted(studentId) {
    state.flash = true;
    dctx.store.invalidate(studentId);
  }

  // Store changes re-render the detail in place; edit mode keeps its input
  dctx.onRefresh(() => {
    if (state.mode === 'detail') paint({ refresh: true });
  });

  // A file dropped outside a drop target (the upload section, the materials
  // section) must not open in the tab; one a target already took is left alone
  const guardDrop = (e) => {
    if (e.defaultPrevented || ![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    if (e.target instanceof Element && e.target.closest('.asg-submit')) return;
    e.preventDefault();
    if (e.type === 'dragover' && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  };
  dctx.body.addEventListener('dragover', guardDrop, { signal: dctx.signal });
  dctx.body.addEventListener('drop', guardDrop, { signal: dctx.signal });

  return paint();
}

// Builds the detail content. Returns { status, actions, nodes, live }.
function buildDetail(dctx, found, { now, names, shown, flash, keepSubmit, keepAnswerKey = null, actions }) {
  const { task, item, student, crossScope } = found;
  const audience = dctx.audience;
  const staff = audience === 'staff';
  const isStudent = dctx.role === 'student' && !dctx.readOnly;
  const parent = dctx.role === 'parent';
  const isTask = task.kind === 'task';
  const status = itemStatus(item, { audience });

  // Bar: pill (and the drafted result for staff); staff menu
  const statusNodes = [pill(status)];
  if (staff && item.bucket === 'in-review' && item.grade && !item.grade.released_at) {
    const draft = draftChip(item.grade);
    if (draft) statusNodes.push(draft);
  }
  const actionNodes = [];
  const following = staff ? followingInTaskSeries(found.data?.tasks, task) : [];
  if (staff) {
    actionNodes.push(menu({
      label: `More actions for ${task.title || 'this item'}`,
      items: [
        { label: 'Edit', icon: 'pencil-simple', onSelect: actions.enterEdit },
        isTask
          ? (task.completed_at
            ? { label: 'Mark not done', icon: 'arrow-counter-clockwise', onSelect: actions.toggleDone }
            : { label: 'Mark done', icon: 'check-circle', onSelect: actions.toggleDone })
          : null,
        { separator: true },
        { label: 'Delete', icon: 'trash', tone: 'danger', onSelect: actions.remove },
        following.length > 1
          ? { label: 'Delete this and following', icon: 'trash', tone: 'danger', onSelect: actions.removeFollowing }
          : null,
      ],
    }));
  }

  const nodes = [headBlock(dctx, found, { now, showStudent: staff && crossScope, student })];
  nodes.push(h('div', { class: 'asg-action-error' }));

  // Homework from a lesson: a link back to it
  if (found.lesson) {
    const hash = typeof location === 'undefined' ? '' : location.hash;
    const caret = icon('caret-right');
    caret.classList.add('asg-lesson-caret');
    nodes.push(h('a', {
      class: `asg-lesson ${tutorToneClass(found.lesson.tutor_id)}`,
      href: drawerHref(hash, `s${found.lesson.id}`),
      dataset: { focusKey: 'asg-lesson' },
    },
    icon('book-open-text'),
    h('span', {}, `Set in ${lessonLabel(found.lesson, todayKey(now))}`),
    caret));
  }

  // 1. Instructions
  nodes.push(section('Instructions', task.details
    ? h('div', { class: 'asg-instructions' }, homeworkView(task.details))
    : h('p', { class: 'asg-muted' }, 'No extra instructions.')));

  // The worksheet: the details as a page to print, fill in or mark up. The
  // student may hand a marked-up one in while they can still submit; staff
  // also get the version with the answer key (built by answer-key.js).
  if (!isTask && hasWorksheet(task)) {
    const canHandIn = isStudent && item.canSubmit && item.attempts < MAX_SUBMISSIONS;
    nodes.push(worksheetSection(dctx, {
      task,
      studentId: found.studentId,
      role: staff ? 'staff' : (parent ? 'parent' : 'student'),
      canMarkUp: staff || canHandIn,
      canHandIn,
      attemptText: `It counts as attempt ${item.attempts + 1} of ${MAX_SUBMISSIONS}.`,
      onHandedIn: () => actions.submitted(found.studentId),
      extra: staff && found.answerKey?.body && found.answerKey.worksheetButton
        ? [found.answerKey.worksheetButton(dctx, { task })] : [],
    }));
  }

  // Worksheets and files from the tutor (staff add and remove them)
  if (found.attachments) {
    const files = materialsSection(dctx, {
      studentId: found.studentId,
      taskId: task.id,
      items: found.attachments,
      canEdit: staff && !dctx.readOnly,
      heading: isTask ? 'Files' : 'Worksheets and files',
      emptyText: 'No files yet. Add a worksheet, slides or a link.',
      keyPrefix: 'asg-mat',
    });
    if (files) nodes.push(files);
  }

  // The answer key: staff only, collapsed, with Edit (never built for families)
  if (staff && !isTask && found.answerKey) {
    const kept = keepAnswerKey && keepAnswerKey.dataset.taskId === String(task.id) ? keepAnswerKey : null;
    nodes.push(kept ?? found.answerKey.build(dctx, { taskId: task.id, body: found.answerKey.body }));
  }

  if (isTask) {
    // Students tick it off here; parents see where it stands
    if (isStudent || parent) {
      nodes.push(h('section', { class: 'drawer-section asg-task-status' },
        h('h3', { class: 'visually-hidden' }, 'Status'),
        taskCheck(item, { ...dctx, scope: dctx.scope ?? { student: { id: found.studentId } } }, { size: 'lg' })));
    }
    return { status: statusNodes, actions: actionNodes, nodes, live: null };
  }

  // 2. Grade
  if (shown) nodes.push(gradeSection(shown, { staff, names, now, task }));

  // Staff: more time for work still waiting on the student
  const waiting = item.bucket === 'todo' || (item.bucket === 'archived' && item.archiveReason === 'missed');
  if (staff && !dctx.readOnly && waiting && task.due_at) nodes.push(extendSection(task, { now, onExtend: actions.extend }));

  // 3. Submit (students). A section already on screen is kept while it still
  // fits this item, and always while its upload is running.
  const kept = keepSubmit
    && keepSubmit.dataset.taskId === String(task.id)
    && (keepSubmit.dataset.sending === 'true'
      || (item.canSubmit && item.attempts < MAX_SUBMISSIONS && keepSubmit.dataset.attempts === String(item.attempts)))
    ? keepSubmit : null;
  if (isStudent && kept) {
    nodes.push(kept);
  } else if (isStudent) {
    if (item.attempts >= MAX_SUBMISSIONS) {
      nodes.push(section('Submit your work', callout({ tone: 'neutral', icon: 'info', text: atCapText() })));
    } else if (item.canSubmit) {
      nodes.push(submitWorkSection(dctx, item, {
        onSubmitted: () => actions.submitted(found.studentId),
      }));
    }
  }

  // 4. Submission history
  let live = null;
  if (item.subs.length || flash) {
    live = flash ? h('div', { class: 'asg-live', role: 'status', tabindex: '-1' }) : null;
    nodes.push(historySection(item, { staff, isStudent, now, live }));
  } else if (!isStudent) {
    nodes.push(section('Submissions', h('p', { class: 'asg-muted' }, 'Nothing submitted yet.')));
  }

  return { status: statusNodes, actions: actionNodes, nodes, live };
}

// Kind, title, waiting line and the facts list (due, student, assigned)
function headBlock(dctx, found, { now, showStudent, student }) {
  const { task, item } = found;
  const family = dctx.audience !== 'staff';
  const parent = dctx.role === 'parent';

  let waiting = null;
  if (family && task.kind !== 'task' && item.bucket === 'in-review') {
    waiting = h('p', { class: 'note asg-waiting' }, icon('hourglass-medium'),
      h('span', {}, parent ? 'Waiting for the tutor to review it.' : 'Waiting for your tutor to review it.'));
  }

  const facts = h('dl', { class: 'asg-facts' });
  const fact = (label, ...value) => facts.append(h('div', { class: 'asg-fact' }, h('dt', {}, label), h('dd', {}, ...value)));

  if (task.due_at) {
    const due = dueLabel(task.due_at, now);
    const open = item.dueState !== 'done';
    const tone = open ? due.tone : null;
    fact('Due',
      tone ? h('span', { class: `asg-due-rel is-${tone}` }, tone === 'danger' ? icon('warning-circle') : icon('clock'), h('span', {}, due.text)) : null,
      h('span', { class: 'asg-due-full' }, due.full.replace(/^Due /, '')));
  } else {
    fact('Due', h('span', { class: 'asg-muted' }, 'No due date'));
  }
  if (task.kind !== 'task' && task.extended_from) fact('Originally due', shortDate(task.extended_from, now));
  const position = seriesPosition(found.data?.tasks, task);
  if (position) fact('Repeats', seriesText(position));
  if (showStudent && student) fact('Student', displayName(student));
  if (task.kind === 'task' && task.completed_at) fact('Done', timeEl(task.completed_at, now));
  if (task.created_at) {
    const assigned = timeEl(task.created_at, now);
    assigned.textContent = shortDate(task.created_at, now);
    fact('Assigned', assigned);
  }

  return h('div', { class: 'asg-head' },
    h('p', { class: 'drawer-kind' }, task.kind === 'task' ? 'Task' : 'Assignment'),
    h('h2', { class: 'drawer-title', tabindex: '-1' }, task.title || 'Untitled'),
    waiting,
    facts);
}

// The grade well: the result, feedback, who graded it and when. A released
// Extended names its new due date.
function gradeSection({ sub, grade, previous }, { staff, names, now, task }) {
  const released = Boolean(grade.released_at);
  const by = grade.reviewed_by ? names?.get?.(grade.reviewed_by) : null;
  let foot;
  if (released) {
    const when = shortDate(grade.released_at, now);
    foot = by ? `Graded by ${firstName(by)} on ${when}` : `Graded ${when}`;
  } else {
    foot = 'Not released yet. Only staff can see this.';
  }

  const top = h('div', { class: 'asg-grade-top' });
  const result = resultOf(grade);
  if (released) {
    const shownResult = resultStatus(result, { audience: staff ? 'staff' : 'family' });
    if (result === 'extended' && !previous && task?.due_at) shownResult.label = `Extended to ${shortDate(task.due_at, now)}`;
    top.append(h('p', { class: 'asg-result' }, pill(shownResult)));
  } else if (staff) {
    const draft = draftChip(grade);
    if (draft) top.append(draft);
  }
  if (staff) top.append(pill(submissionStatus(sub, grade, { audience: 'staff' })));

  const well = h('div', { class: 'well asg-grade' },
    top.childElementCount ? top : null,
    grade.feedback
      ? h('p', { class: 'read is-pre asg-feedback' }, grade.feedback)
      : h('p', { class: 'asg-muted' }, 'No written feedback.'),
    h('div', { class: 'asg-grade-foot' },
      h('p', { class: 'asg-grade-by' }, foot),
      staff && !released
        ? button({ label: 'Open in review', size: 'sm', variant: 'secondary', iconEnd: 'caret-right', href: `#/review/${sub.id}` })
        : null));

  return section(previous ? 'Previous grade' : 'Grade', well);
}

// Staff: a new due date for work still waiting on the student. onExtend(day)
// resolves to an error message, or null once the store refresh is on its way.
function extendSection(task, { now, onExtend }) {
  const input = h('input', {
    type: 'date',
    class: 'input asg-date',
    name: 'extend',
    min: todayKey(now),
    dataset: { focusKey: 'asg-extend-date' },
  });
  // The button sits beside the date; the hint and any error go under both
  const submit = button({ label: 'Extend', type: 'submit', icon: 'clock', focusKey: 'asg-extend' });
  const dateField = field({
    label: 'New due date',
    hint: `Due at ${extensionTimeText(task.due_at)} Pacific time on this date. The student sees it as extended.`,
    control: h('div', { class: 'asg-extend-row' }, input, submit),
  });
  const form = h('form', { class: 'asg-extend', novalidate: true }, dateField);
  let working = false;
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === 'true') setFieldError(dateField, '');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (working) return;
    working = true;
    try {
      const problem = await busy(submit, 'Extending…', () => onExtend(input.value));
      if (problem && form.isConnected) {
        setFieldError(dateField, problem);
        input.focus();
      }
    } catch (error) {
      console.error(error);
      if (form.isConnected) setFieldError(dateField, 'Check your connection and try again.');
    } finally {
      working = false;
    }
  });
  return section('Extend', form);
}

// Submission history, newest first
function historySection(item, { staff, isStudent, now, live }) {
  const total = item.subs.length;
  const title = `${isStudent ? 'Your submissions' : 'Submissions'} (${total} of ${MAX_SUBMISSIONS})`;
  const audience = staff ? 'staff' : 'family';

  const entries = item.subs.map((sub, i) => {
    const n = total - i;
    const status = submissionStatus(sub, sub.grade, { audience });
    const kind = workLabel(sub);
    const draft = staff && sub.grade && !sub.grade.released_at ? draftChip(sub.grade) : null;

    const inner = [
      h('span', { class: 'asg-sub-icon', 'aria-hidden': 'true' }, icon(workIcon(sub))),
      h('span', { class: 'asg-sub-main' },
        h('span', { class: 'asg-sub-title' }, `Attempt ${n}`),
        h('span', { class: 'asg-sub-meta' }, `${kind}, `, timeEl(sub.created_at, now))),
      h('span', { class: 'asg-sub-status' }, draft, pill(status)),
    ];
    // Families read the typed answer here; staff open it on the review page
    const typed = !staff && typeof sub.body === 'string' && sub.body.trim()
      ? h('details', { class: 'asg-sub-answer' },
        h('summary', {}, isStudent ? 'Your answer' : 'Answer'),
        answerView(sub))
      : null;
    const extra = [
      typed,
      sub.note ? h('blockquote', { class: 'quote asg-sub-note' }, sub.note) : null,
      // Why grading failed is for staff only: families never hear about grading
      staff && sub.error && sub.status === 'failed'
        ? h('p', { class: 'asg-sub-error' }, icon('warning-circle'), h('span', {}, sub.error))
        : null,
    ].filter(Boolean);

    if (staff) {
      const caret = icon('caret-right');
      caret.classList.add('asg-sub-caret');
      // A short name: the note and any error stay readable but out of the label
      const label = [
        `Attempt ${n}`,
        kind,
        relativeTime(sub.created_at, now).text,
        draft ? draft.textContent : null,
        status.label,
      ].filter(Boolean).join(', ');
      return h('li', { class: 'asg-sub' },
        h('a', {
          class: 'asg-sub-link',
          href: `#/review/${sub.id}`,
          'aria-label': label,
          dataset: { focusKey: `sub-${sub.id}` },
        }, ...inner, caret, extra.length ? h('div', { class: 'asg-sub-extra' }, extra) : null));
    }
    return h('li', { class: 'asg-sub' },
      h('div', { class: 'asg-sub-row' }, ...inner, extra.length ? h('div', { class: 'asg-sub-extra' }, extra) : null));
  });

  return h('section', { class: 'drawer-section asg-history-section' },
    h('h3', {}, title),
    live,
    total ? h('ol', { class: 'asg-history', reversed: true }, entries) : null);
}
