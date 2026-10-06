// Students (#/students, staff; spec 5.13). One row per student with review
// load, next tutoring session, next due work, last submission and the 30-day
// average, plus the student's tutors with their subjects under the name, all
// read from the staff workspace in the store, so the counts match the nav and
// switcher. Search filters by name and email in memory; it never goes into the
// URL. Quick filter chips (Needs review, Overdue work, No lesson booked), the
// admin's Tutor select and a Sort select sit beside the search; the chosen
// filter, tutor and sort are remembered per user in localStorage and survive a
// refresh, while the search text only survives a refresh. The rules for all of
// it live in students-filter-model.js.
//
// Pure helpers (nextDue, recentAverage, lastSubmissionAt, studentSummaries,
// countLabel) are exported for tests and never touch the DOM.

import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { avatar, emptyState, errorCallout, select, skeletonRows } from '../ui.js';
import { displayName, byDue, one } from '../format.js';
import { reviewCounts } from '../app-model.js';
import { deriveItems } from '../buckets.js';
import { dueLabel, relativeTime, todayKey } from '../dates.js';
import { overdueItems, scoreWindow } from '../overview-model.js';
import { staffNames } from '../updates-feed.js';
import { nextSessionOf, nextSessionParts, tutorEntries, tutorText } from '../schedule-summary.js';
import {
  ALL, QUICK_FILTERS, SORTS, SORT_LABELS, narrowing, clearedView, countLabel, emptyMessage, clearLabel,
  filterByTutor, filterChips, loadView, nextFilter, normalizeView, quickCounts, saveView, tutorOptions, visibleStudents,
} from '../students-filter-model.js';

export { countLabel };

export const AVERAGE_DAYS = 30;
const ENTER_LIMIT = 8;
const TUTOR_CHIPS = 3;   // more tutors than this collapse into "+N"

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));

// ---------------------------------------------------------------------------
// Pure logic

// The open item due soonest: overdue work first, undated work never.
// Open = a task not done, or an assignment still To do (a missed assignment
// that moved to Archived is no longer "next").
export function nextDue(items) {
  return (items ?? [])
    .filter((i) => i.task.due_at && i.dueState !== 'done' && (i.task.kind === 'task' || i.bucket === 'todo'))
    .sort((a, b) => byDue(a.task, b.task))[0] ?? null;
}

// Mean of the released scores from the last `days` days, rounded; null when none.
// One rule with the Overview's "Average score, last 30 days" (scoreWindow).
export function recentAverage(submissions, now = new Date(), { days = AVERAGE_DAYS } = {}) {
  const grades = (submissions ?? []).map((sub) => one(sub.grade)).filter(Boolean);
  return scoreWindow(grades, now, { days }).avg;
}

// ISO time of the newest submission, or null
export function lastSubmissionAt(submissions) {
  let best = null;
  for (const sub of submissions ?? []) {
    if (!sub.created_at || !Number.isFinite(ms(sub.created_at))) continue;
    if (best === null || ms(sub.created_at) > ms(best)) best = sub.created_at;
  }
  return best;
}

// One summary per student, in the workspace order (by name):
// { student, name, email, review, overdue, next, nextSession, tutors, lastAt, avg }
//   overdue      how many open assignments and tasks are past due (the Overdue work filter)
//   nextSession  the student's next upcoming session with any tutor, or null
//   tutors       [{ id, name, subject, tone }] by name, from ws.links; names is
//                the staffNames() Map that supplies each tutor's name
export function studentSummaries(ws, now = new Date(), { names = new Map() } = {}) {
  const tasksBy = new Map();
  const subsBy = new Map();
  const sessionsBy = new Map();
  const linksBy = new Map();
  const push = (map, key, v) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(v);
  };
  for (const t of ws?.tasks ?? []) push(tasksBy, t.student_id, t);
  for (const s of ws?.submissions ?? []) push(subsBy, s.student_id, s);
  for (const s of ws?.sessions ?? []) push(sessionsBy, s.student_id, s);
  for (const l of ws?.links ?? []) push(linksBy, l.student_id, l);
  const review = reviewCounts(ws?.submissions ?? []);

  return (ws?.students ?? []).map((student) => {
    const subs = subsBy.get(student.id) ?? [];
    const items = deriveItems(tasksBy.get(student.id) ?? [], subs, now, { audience: 'staff' });
    return {
      student,
      name: displayName(student),
      email: student.email ?? '',
      review: review.get(student.id) ?? 0,
      overdue: overdueItems(items, { tasks: true }).length,
      next: nextDue(items),
      nextSession: nextSessionOf(sessionsBy.get(student.id) ?? [], now),
      tutors: tutorEntries(linksBy.get(student.id) ?? [], names),
      lastAt: lastSubmissionAt(subs),
      avg: recentAverage(subs, now),
    };
  });
}

// ---------------------------------------------------------------------------
// View

// The search text survives refresh re-renders (a write elsewhere, returning to
// the tab) but starts empty whenever the view is opened again. The filter,
// tutor and sort are kept the same way, and also in localStorage per user
// (loadView and saveView), so they are still there on the next visit.
let keptSearch = '';
let keptView = null;   // { userId, view }

// "Up next", not "Next due": the column leads with overdue work (nextDue).
// "Next session" is the tutoring schedule.
const COLUMNS = ['Student', 'To review', 'Next session', 'Up next', 'Last submission', '30-day average'];

export function mount(ctx) {
  const title = 'Students';
  ctx.setHeader({ title });
  if (!ctx.isRefresh) {
    keptSearch = '';
    keptView = null;
  }

  const body = h('div', { class: 'stu-body' });
  ctx.host.append(body);

  // When sessions fail to load, Next session reads "None" for everyone, so say why
  let sessionsFailed = false;
  // How many rows the table shows, for the announcement after a load
  let shownCount = 0;

  async function load() {
    body.replaceChildren(skeletonRows(5));
    body.setAttribute('aria-busy', 'true');
    let ws;
    let names;
    try {
      // staffNames never rejects: without it the tutor chips say "Tutor"
      [ws, names] = await Promise.all([ctx.store.getWorkspace(), staffNames()]);
    } catch (error) {
      if (!ctx.alive()) return;
      console.error(error);
      body.removeAttribute('aria-busy');
      body.replaceChildren(errorCallout({
        title: 'We couldn’t load students.',
        text: 'Check your connection and try again.',
        onRetry: load,
      }));
      ctx.announce('Students could not be loaded');
      return;
    }
    if (!ctx.alive()) return;
    body.removeAttribute('aria-busy');
    // The viewer is a tutor or admin, so their own name is always known
    const known = new Map(names ?? []);
    if (ctx.me?.id && !known.has(String(ctx.me.id))) known.set(String(ctx.me.id), displayName(ctx.me));
    const summaries = studentSummaries(ws, ctx.now, { names: known });
    sessionsFailed = Boolean(ws.sessionsError);
    render(summaries);
    ctx.announce(`Students, ${countLabel(shownCount, summaries.length)}`);
  }

  function render(summaries) {
    if (!summaries.length) {
      body.replaceChildren(ctx.role === 'admin'
        ? emptyState({
          icon: 'users-three',
          text: 'No students yet. Approve one on the People page.',
          action: { label: 'Open People', href: '/portal/people.html#/pending' },
        })
        : emptyState({ icon: 'users-three', text: 'No students are assigned to you yet.' }));
      return;
    }

    // The remembered view, checked against what exists now: a tutor who is gone
    // or a filter the page cannot offer (no schedule) falls back to All
    const admin = ctx.role === 'admin';
    const userId = ctx.me?.id ?? null;
    const tutors = admin ? tutorOptions(summaries) : [];
    const filters = sessionsFailed ? QUICK_FILTERS.filter((key) => key !== 'nolesson') : QUICK_FILTERS;
    const checked = (v) => normalizeView(v, { filters, tutorIds: tutors.map((t) => t.value) });
    if (!keptView || keptView.userId !== userId) keptView = { userId, view: loadView(userId) };
    let view = checked(keptView.view);

    const inputId = uid('stu-search');
    const input = h('input', {
      class: 'input',
      id: inputId,
      type: 'text',
      role: 'searchbox',
      inputmode: 'search',
      enterkeyhint: 'search',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'Find a student',
      dataset: { focusKey: 'stu-search' },
    });
    input.value = keptSearch;
    // The count is the polite live region: it changes with every filter, sort and search
    const count = h('p', { class: 'stu-count num', role: 'status' });
    const results = h('div', { class: 'stu-results' });
    const chips = h('div', { class: 'stu-chips', role: 'group', 'aria-label': 'Quick filters' });

    // A labelled select that keeps its focus key through re-renders
    const pick = ({ label, key, options, value, className, onChange }) => {
      const wrap = select({ options, value, onChange });
      const control = wrap.querySelector('select');
      control.id = uid(key);
      control.dataset.focusKey = key;
      return {
        control,
        el: h('div', { class: className ? `stu-pick ${className}` : 'stu-pick' },
          h('label', { class: 'stu-pick-label', for: control.id }, label),
          wrap),
      };
    };

    const sortPick = pick({
      label: 'Sort by',
      key: 'stu-sort',
      className: 'is-sort',
      options: SORTS.map((value) => ({ value, label: SORT_LABELS[value] })),
      value: view.sort,
      onChange: (value) => change({ ...view, sort: value }),
    });
    const tutorPick = admin && tutors.length
      ? pick({
        label: 'Tutor',
        key: 'stu-tutor',
        options: [{ value: ALL, label: 'All tutors' }, ...tutors],
        value: view.tutor,
        onChange: (value) => change({ ...view, tutor: value }),
      })
      : null;

    // Stays on the same control (by its focus key) when a re-render replaces it
    const keepFocus = (fn) => {
      const active = document.activeElement;
      const key = active && body.contains(active) ? active.dataset?.focusKey ?? null : null;
      fn();
      if (key && !active.isConnected) {
        [...body.querySelectorAll('[data-focus-key]')].find((el) => el.dataset.focusKey === key)?.focus({ preventScroll: true });
      }
    };

    const focusKey = (key) => {
      [...body.querySelectorAll('[data-focus-key]')].find((el) => el.dataset.focusKey === key)?.focus({ preventScroll: true });
    };

    // Counts follow the tutor chosen, not the search text, so the chips hold
    // still while someone types
    const drawChips = () => {
      const counts = quickCounts(filterByTutor(summaries, view.tutor), ctx.now);
      chips.replaceChildren(...filterChips(counts, view, { filters }).map((chip) => h('button', {
        type: 'button',
        class: 'stu-filter',
        'aria-pressed': chip.pressed ? 'true' : 'false',
        'aria-label': `${chip.label}, ${chip.count}`,
        dataset: { focusKey: `stu-filter-${chip.key}` },
        onClick: () => change({ ...view, filter: nextFilter(view.filter, chip.key) }),
      }, h('span', { class: 'stu-filter-label' }, chip.label),
      h('span', { class: 'stu-filter-count num', 'aria-hidden': 'true' }, String(chip.count)))));
    };

    const clear = () => {
      const cause = narrowing(view, input.value);
      view = checked(clearedView(view));
      remember();
      if (tutorPick) tutorPick.control.value = view.tutor;
      if (cause.search) {
        input.value = '';
        keptSearch = '';
      }
      drawChips();
      fill(false);
      focusKey(cause.filter || cause.tutor ? 'stu-filter-all' : 'stu-search');
    };

    const fill = (animate) => {
      const shown = visibleStudents(summaries, view, { now: ctx.now, term: input.value });
      shownCount = shown.length;
      count.textContent = countLabel(shown.length, summaries.length);
      if (shown.length) {
        results.replaceChildren(table(shown, { animate }));
        return;
      }
      const cause = narrowing(view, input.value);
      results.replaceChildren(emptyState({
        icon: 'magnifying-glass',
        text: emptyMessage(cause),
        action: cause.any ? { label: clearLabel(cause), onClick: clear, focusKey: 'stu-clear' } : null,
      }));
    };

    const remember = () => {
      keptView = { userId, view };
      saveView(userId, view);
    };

    // A chip, the Tutor select or the Sort select changed
    function change(next) {
      view = checked(next);
      remember();
      keepFocus(() => {
        drawChips();
        fill(false);
      });
    }

    input.addEventListener('input', () => {
      keptSearch = input.value;
      fill(false);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        e.preventDefault();
        input.value = '';
        keptSearch = '';
        fill(false);
      }
    });

    body.replaceChildren(
      sessionsFailed
        ? errorCallout({ title: 'We couldn’t load sessions.', text: 'The Next session column may be empty. Try again in a moment.', onRetry: () => ctx.store.invalidate(null) })
        : '',
      h('div', { class: 'stu-toolbar' },
        h('div', { class: 'stu-controls' },
          h('div', { class: 'stu-search' },
            h('label', { class: 'visually-hidden', for: inputId }, 'Find a student'),
            h('span', { class: 'input-icon' }, icon('magnifying-glass'), input)),
          h('div', { class: 'stu-picks' }, tutorPick?.el ?? null, sortPick.el)),
        h('div', { class: 'stu-filterbar' }, chips, count)),
      results);
    drawChips();
    fill(!ctx.isRefresh);
  }

  function table(rows, { animate }) {
    const head = h('div', { class: 'stu-head', 'aria-hidden': 'true' },
      COLUMNS.map((label, i) => h('span', { class: `stu-col stu-col-${i + 1}` }, label)),
      h('span', { class: 'stu-col stu-col-7' }));
    const list = h('ul', { class: 'stu-list', 'aria-label': 'Students' },
      rows.map((s, i) => {
        const li = h('li', {}, row(s));
        if (animate && i < ENTER_LIMIT) {
          li.classList.add('enter');
          li.style.setProperty('--i', String(i));
        }
        return li;
      }));
    return h('div', { class: 'stu-table' }, h('div', { class: 'stu-scroll' }, head, list));
  }

  function cell(kind, label, ...content) {
    return h('span', { class: `stu-cell stu-${kind}` },
      h('span', { class: 'stu-label' }, label),
      h('span', { class: 'stu-value' }, content));
  }

  // The student's tutors as small chips in their subject's colour
  function tutorChips(tutors) {
    if (!tutors.length) return null;
    const shown = tutors.slice(0, TUTOR_CHIPS);
    const more = tutors.length - shown.length;
    return h('span', { class: 'stu-tutors' },
      shown.map((t) => h('span', { class: `stu-chip ${t.tone}` }, tutorText(t))),
      more > 0 ? h('span', { class: 'stu-chip is-more' }, `+${more}`) : null);
  }

  function row(s) {
    const { student, next, nextSession, tutors } = s;
    const said = [s.name];
    if (s.email && s.email !== s.name) said.push(s.email);
    if (tutors.length) said.push(`tutors ${tutors.map(tutorText).join(', ')}`);
    if (s.review > 0) said.push(`${s.review} to review`);

    let sessionContent;
    if (nextSession) {
      const parts = nextSessionParts(nextSession, todayKey(ctx.now));
      said.push(`next session ${parts.text}`);
      sessionContent = [
        h('span', { class: 'stu-next-title num' }, parts.day),
        h('span', { class: 'stu-next-due num' }, parts.time),
      ];
    } else {
      sessionContent = h('span', { class: 'stu-none' }, 'None');
      said.push('no upcoming session');
    }

    let nextContent;
    if (next) {
      const due = dueLabel(next.task.due_at, ctx.now);
      said.push(`up next ${next.task.title || 'Untitled'}, ${due.text}`);
      const tone = due.tone === 'danger' ? ' is-danger' : due.tone === 'warning' ? ' is-warning' : '';
      nextContent = [
        h('span', { class: 'stu-next-title' }, next.task.title || 'Untitled'),
        h('span', { class: `stu-next-due num${tone}`, title: due.full }, due.text),
      ];
    } else {
      nextContent = h('span', { class: 'stu-none' }, 'Nothing due');
      said.push('nothing due');
    }

    let lastContent;
    if (s.lastAt) {
      const r = relativeTime(s.lastAt, ctx.now);
      lastContent = h('time', { class: 'num', datetime: s.lastAt, title: r.full }, r.text);
      said.push(`last submission ${r.text}`);
    } else {
      lastContent = h('span', { class: 'stu-none' }, 'No work yet');
      said.push('no work yet');
    }
    said.push(s.avg === null ? '30-day average none' : `30-day average ${s.avg}`);

    const avgContent = s.avg === null
      ? h('span', { class: 'stu-none' }, 'None')
      : h('span', { class: 'stu-avg-value mono' }, String(s.avg));

    const reviewCell = s.review > 0
      ? h('span', { class: 'stu-cell stu-review' },
        h('span', { class: 'stu-review-badge num' }, `${s.review} to review`))
      : h('span', { class: 'stu-cell stu-review is-empty' });

    const caret = icon('caret-right');
    caret.classList.add('stu-caret');

    return h('a', {
      class: 'stu-row',
      href: `?student=${encodeURIComponent(student.id)}#/overview`,
      'aria-label': said.join(', '),
      dataset: { focusKey: `stu-${student.id}` },
    },
    h('span', { class: 'stu-who' },
      avatar(s.name, { size: 32 }),
      h('span', { class: 'stu-id' },
        h('span', { class: 'stu-name' }, s.name),
        s.email && s.email !== s.name ? h('span', { class: 'stu-email' }, s.email) : null,
        tutorChips(tutors))),
    reviewCell,
    cell('session', 'Next session', sessionContent),
    cell('next', 'Up next', nextContent),
    cell('last', 'Last submission', lastContent),
    cell('avg', '30-day average', avgContent),
    caret);
  }

  return load();
}
