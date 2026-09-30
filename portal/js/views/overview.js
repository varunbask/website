// Overview (#/overview), spec 5.2 to 5.4. Three variants, chosen by ctx.page:
//   student  greeting, Due next, Latest grade, This week, Tasks, From your tutor
//   parent   "Maya’s week", progress, Overdue, updates, Recently graded, Coming up;
//            with no linked child, a single welcome empty state
//   staff    the selected student: progress, Needs review, Coming up, updates
// Renders only inside ctx.host and checks ctx.alive() after every await.

import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import {
  button, pill, scoreChip, newPill, avatar, emptyState, errorCallout, itemRow, rowList, visuallyHidden,
} from '../ui.js';
import { itemStatus } from '../status.js';
import { dueLabel, dayKey, parseKey, todayKey, dayHeading } from '../dates.js';
import { buildHash, DRAWER_PARAMS } from '../router.js';
import { displayName, firstName } from '../format.js';
import { getSeen, isNewSince } from '../seen.js';
import { staffNames, updateItem, updateList } from '../updates-feed.js';
import { taskCheck } from '../task-check.js';
import { queueRow } from '../review-row.js';
import { progressPanel } from '../progress-panel.js';
import {
  greeting, studentLede, parentSummary, parentTitle, weekCounts, dueNext, overdueItems, comingUp,
  openTasks, gradedItems, weekStrip, stripLabel, chipStyle, shortDay, firstLine, lastUpdateLabel,
  reviewEntries,
} from '../overview-model.js';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STRIP_CHIPS = 2;
const ENTER_LIMIT = 8;

export function mount(ctx) {
  if (ctx.page === 'staff') return mountStaff(ctx);
  if (ctx.page === 'parent') return ctx.scope?.student ? mountParent(ctx) : mountWelcome(ctx);
  return mountStudent(ctx);
}

// ---------------------------------------------------------------------------
// Shared pieces

// The current hash with the drawer opened on a task (drawer params replaced)
function openHref(ctx, taskId, extra = {}) {
  const params = { ...(ctx.route?.params ?? {}) };
  for (const key of DRAWER_PARAMS) delete params[key];
  return buildHash({
    view: ctx.route?.view ?? 'overview',
    sub: ctx.route?.sub ?? null,
    id: ctx.route?.id ?? null,
    params: { ...params, ...extra, open: String(taskId) },
  });
}

// A lede paragraph that shows a skeleton bar until its text arrives
function pendingLede() {
  return h('p', { class: 'view-lede' },
    h('span', { class: 'skeleton ovw-sk-lede', 'aria-hidden': 'true' }));
}

// Loading layout shaped like the real grid; spans: list of span classes
function loadingGrid(spans) {
  return h('div', { class: 'grid-12 ovw-grid', 'aria-busy': 'true' },
    spans.map((span) => h('div', { class: `${span} ovw-sk-card`, 'aria-hidden': 'true' },
      h('span', { class: 'skeleton ovw-sk-title' }),
      h('span', { class: 'skeleton ovw-sk-line' }),
      h('span', { class: 'skeleton ovw-sk-line is-short' }))),
    visuallyHidden('Loading…'));
}

function loadError(ctx, studentId) {
  return errorCallout({
    title: 'We couldn’t load the overview.',
    text: 'Check your connection and try again.',
    onRetry: () => ctx.store.invalidate(studentId),
  });
}

// View entry: the first 8 blocks fade up, only when the view changes
function animate(ctx, nodes) {
  if (ctx.isRefresh) return;
  nodes.filter(Boolean).slice(0, ENTER_LIMIT).forEach((el, i) => {
    el.classList.add('enter');
    el.style.setProperty('--i', String(i));
  });
}

function cardHead(title, { id, meta, link, icon: iconName, tone } = {}) {
  return h('div', { class: 'card-head' },
    h('h2', { class: tone === 'danger' ? 'card-title ovw-title-danger' : 'card-title', id },
      iconName ? icon(iconName) : null,
      h('span', {}, title)),
    meta ?? null,
    link ? h('a', { class: 'link card-link', href: link.href }, link.label) : null);
}

// A card-head count: the bare number for the eye, spelled out for screen readers
function countMeta(n, spoken) {
  return h('span', { class: 'card-meta num' },
    h('span', { 'aria-hidden': 'true' }, String(n)),
    visuallyHidden(spoken));
}

// A quiet in-card empty line: icon square plus one sentence
function cardEmpty(text, iconName = 'check-circle') {
  return h('div', { class: 'ovw-card-empty' },
    h('span', { class: 'ovw-card-empty-icon' }, icon(iconName)),
    h('p', {}, text));
}

function toneClass(tone) {
  if (tone === 'danger') return 'is-danger';
  if (tone === 'warning') return 'is-warning';
  return null;
}

// A compact row for narrow cards: glyph, title over meta, then a pill or chip.
// Reuses a.row so the open drawer highlights it (drawer.js syncDrawerRow).
function miniRow(ctx, item, { meta, metaTone, status: statusNode, extra, label } = {}) {
  const status = itemStatus(item, { audience: ctx.audience });
  const glyph = status.glyph ?? { icon: status.icon, tone: status.tone };
  const due = item.task.due_at ? dueLabel(item.task.due_at, ctx.now) : null;
  const metaText = meta ?? due?.text ?? 'No due date';
  const tone = meta === undefined ? due?.tone : metaTone;
  const aside = statusNode ?? pill(status);
  const title = item.task.title || 'Untitled';
  return h('li', {}, h('a', {
    class: ['row', 'ovw-mini', status.struck ? 'is-done' : null].filter(Boolean).join(' '),
    href: openHref(ctx, item.task.id),
    'aria-label': label ?? [title, metaText, status.label].filter(Boolean).join(', '),
    title: meta === undefined && due ? due.full : undefined,
    dataset: { focusKey: `row-${item.task.id}`, taskId: String(item.task.id) },
  },
  h('span', { class: `ovw-mini-lead tone-${glyph.tone ?? 'neutral'}` }, icon(glyph.icon)),
  h('span', { class: 'ovw-mini-main' },
    h('span', { class: 'ovw-mini-title' }, title),
    h('span', { class: ['ovw-mini-meta', toneClass(tone)].filter(Boolean).join(' ') }, metaText)),
  h('span', { class: 'ovw-mini-aside' }, extra ?? null, aside),
  icon('caret-right')));
}

function miniList(rows, label) {
  return h('ul', { class: 'ovw-mini-list', 'aria-label': label }, rows);
}

// Day groups (Coming up): an h3 per day over rows.
// keyPrefix renames the rows' focus keys (e.g. 'week' gives week-<taskId>) so
// a second list of the same tasks never shadows the row-<taskId> the drawer
// and app look up to restore focus and mark the open row.
function dayGroups(ctx, groups, { mini = false, keyPrefix = null } = {}) {
  const rekey = (li, item) => {
    if (keyPrefix) li.firstElementChild.dataset.focusKey = `${keyPrefix}-${item.task.id}`;
    return li;
  };
  return groups.map((g) => h('div', { class: 'ovw-day-group' },
    h('h3', { class: 'ovw-dayhead' }, g.heading),
    mini
      ? miniList(g.items.map((item) => rekey(miniRow(ctx, item), item)))
      : rowList(g.items.map((item) => rekey(itemRow(item, { audience: ctx.audience, href: openHref(ctx, item.task.id), now: ctx.now }), item)))));
}

function updatesCard(ctx, { span, title, updates, names, limit, empty, showAudience = false, studentFirstName, meta = false, seen }) {
  const titleId = uid('ovw-upd');
  const card = h('section', { class: `card ${span} ovw-updates`, 'aria-labelledby': titleId });
  if (updates === null) {
    card.append(cardHead(title, { id: titleId }),
      errorCallout({
        title: 'We couldn’t load updates.',
        text: 'Check your connection and try again.',
        onRetry: () => ctx.store.invalidate(ctx.scope?.student?.id),
      }));
    return card;
  }
  const last = meta ? lastUpdateLabel(updates, ctx.now) : null;
  const metaEl = last
    ? h('span', { class: 'card-meta' }, h('time', { datetime: last.iso, title: last.full }, last.text))
    : null;
  card.append(cardHead(title, {
    id: titleId,
    meta: metaEl,
    link: updates.length ? { label: 'See all updates', href: '#/updates' } : null,
  }));
  card.append(updates.length
    ? updateList(updates.slice(0, limit).map((u) => updateItem(u, names, {
      compact: true,
      showAudience,
      studentFirstName,
      now: ctx.now,
      isNew: ctx.audience === 'family' && isNewSince(u.created_at, seen, ctx.now),
    })), { compact: true, label: title })
    : cardEmpty(empty, 'chat-circle-text'));
  return card;
}

async function loadAll(ctx, studentId) {
  const updates = ctx.store.getUpdates(studentId).catch(() => null);
  const names = staffNames().catch(() => new Map());
  const data = await ctx.store.getStudentData(studentId);
  return { data, updates: await updates, names: (await names) ?? new Map() };
}

// ---------------------------------------------------------------------------
// Student (spec 5.2)

function dateBlock(item, now) {
  const due = item.task.due_at;
  if (!due) {
    return h('div', { class: 'ovw-date is-undated', 'aria-hidden': 'true' },
      icon('calendar-blank', { size: 20 }),
      h('span', { class: 'ovw-date-month' }, 'No date'));
  }
  const { m, d } = parseKey(dayKey(due));
  const state = item.dueState;
  const cls = ['ovw-date', state === 'overdue' ? 'is-danger' : state === 'soon' ? 'is-warning' : null].filter(Boolean).join(' ');
  return h('div', { class: cls, 'aria-hidden': 'true' },
    h('span', { class: 'ovw-date-month' }, MONTHS_SHORT[m - 1]),
    h('span', { class: 'ovw-date-day' }, String(d)));
}

function dueNextSection(ctx, pick) {
  const titleId = uid('ovw-due');
  const section = h('section', { class: 'span-8 ovw-bezel', 'aria-labelledby': titleId },
    h('h2', { class: 'visually-hidden', id: titleId }, 'Due next'));
  const { next, after } = pick;
  if (!next) {
    section.classList.add('is-empty');
    section.append(h('div', { class: 'ovw-bezel-core ovw-bezel-rest' },
      h('span', { class: 'ovw-rest-icon' }, icon('check-circle', { size: 20 })),
      h('p', { class: 'ovw-rest-text' }, 'Nothing due. Enjoy the break.')));
    return section;
  }

  const { task } = next;
  const status = itemStatus(next, { audience: ctx.audience });
  const due = task.due_at ? dueLabel(task.due_at, ctx.now) : null;
  const details = firstLine(task.details) ? task.details.trim() : '';

  const actions = next.canSubmit
    ? [
      button({ label: 'Submit work', variant: 'primary', icon: 'upload-simple', href: openHref(ctx, task.id, { focus: 'submit' }), focusKey: `submit-${task.id}` }),
      button({ label: 'View details', variant: 'ghost', href: openHref(ctx, task.id) }),
    ]
    : [button({ label: 'Open assignment', variant: 'primary', href: openHref(ctx, task.id) })];

  section.append(h('div', { class: 'ovw-bezel-core' },
    dateBlock(next, ctx.now),
    h('div', { class: 'ovw-due-body' },
      h('div', { class: 'ovw-due-status' }, pill(status)),
      h('h3', { class: 'ovw-due-title' }, task.title || 'Untitled'),
      h('p', { class: ['ovw-due-when', toneClass(due?.tone)].filter(Boolean).join(' '), title: due?.full },
        due ? due.text : 'No due date'),
      details ? h('p', { class: 'ovw-due-details' }, details) : null,
      h('div', { class: 'ovw-due-actions' }, actions))));

  if (after.length) {
    section.append(h('div', { class: 'ovw-after' },
      h('h3', { class: 'ovw-after-title' }, 'After that'),
      h('ul', { class: 'ovw-after-list' }, after.map((item) => {
        const d = item.task.due_at ? dueLabel(item.task.due_at, ctx.now) : null;
        const title = item.task.title || 'Untitled';
        return h('li', {}, h('a', {
          class: 'ovw-after-row',
          href: openHref(ctx, item.task.id),
          'aria-label': [title, d?.text ?? 'No due date', itemStatus(item, { audience: ctx.audience }).label].join(', '),
          dataset: { focusKey: `row-${item.task.id}` },
        },
        h('span', { class: 'ovw-after-name' }, title),
        h('span', { class: ['ovw-after-due', toneClass(d?.tone)].filter(Boolean).join(' '), title: d?.full }, d ? d.text : 'No due date'),
        icon('caret-right')));
      }))));
  }
  return section;
}

function latestGradeCard(ctx, item, isNew) {
  const titleId = uid('ovw-grade');
  const card = h('section', { class: 'card span-4 ovw-grade', 'aria-labelledby': titleId },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title', id: titleId }, 'Latest grade'),
      item && isNew ? newPill() : null));
  if (!item) {
    card.append(cardEmpty('No grades yet. Grades appear here after your tutor reviews your work.', 'check-circle'));
    return card;
  }
  const { task, grade } = item;
  const feedback = String(grade.feedback ?? '').trim();
  card.append(
    h('p', { class: 'ovw-score' },
      h('span', { class: 'ovw-score-value' }, String(grade.score)),
      h('span', { class: 'ovw-score-max', 'aria-hidden': 'true' }, '/100'),
      visuallyHidden(' out of 100')),
    h('p', { class: 'ovw-grade-title' }, task.title || 'Untitled'),
    h('p', { class: 'ovw-grade-date' }, `Graded ${shortDay(grade.released_at, ctx.now)}`),
    feedback ? h('p', { class: 'ovw-grade-feedback' }, feedback) : null,
    h('a', {
      class: 'link ovw-grade-link',
      href: openHref(ctx, task.id),
      dataset: { focusKey: `grade-${task.id}` },
    }, 'Read feedback', visuallyHidden(` for ${task.title || 'this assignment'}`)));
  return card;
}

function stripChip(ctx, item) {
  const { variant, icon: iconName } = chipStyle(item, { audience: ctx.audience });
  return h('span', { class: `ovw-chip is-${variant}` },
    icon(iconName, { size: 12 }),
    h('span', { class: 'ovw-chip-text' }, item.task.title || 'Untitled'));
}

function weekCard(ctx, days, today) {
  const titleId = uid('ovw-week');
  const strip = h('ol', { class: 'ovw-strip' }, days.map((day) => {
    const shown = day.items.slice(0, STRIP_CHIPS);
    const more = day.items.length - shown.length;
    return h('li', {}, h('a', {
      class: ['ovw-day', day.isToday ? 'is-today' : null, day.items.length ? null : 'is-empty'].filter(Boolean).join(' '),
      href: buildHash({ view: 'calendar', params: { view: 'month', m: day.ym, d: day.key } }),
      'aria-label': stripLabel(day, { audience: ctx.audience }),
      'aria-current': day.isToday ? 'date' : undefined,
    },
    h('span', { class: 'ovw-day-head', 'aria-hidden': 'true' },
      h('span', { class: 'ovw-day-name' }, day.weekday),
      h('span', { class: 'ovw-day-num' }, String(day.day))),
    h('span', { class: 'ovw-day-chips', 'aria-hidden': 'true' },
      shown.map((item) => stripChip(ctx, item)),
      more > 0 ? h('span', { class: 'ovw-day-more' }, `+${more}`) : null)));
  }));

  // Phones: only the days that have items, as agenda rows
  const withItems = days.filter((d) => d.items.length);
  const list = h('div', { class: 'ovw-next7' },
    withItems.length
      ? dayGroups(ctx, withItems.map((d) => ({ key: d.key, heading: dayHeading(d.key, today), items: d.items })), { keyPrefix: 'week' })
      : cardEmpty('Nothing due in the next 7 days.', 'calendar-blank'));

  return h('section', { class: 'card span-12 ovw-week', 'aria-labelledby': titleId },
    h('div', { class: 'card-head' },
      h('h2', { class: 'card-title', id: titleId },
        h('span', { class: 'ovw-wide-only' }, 'This week'),
        h('span', { class: 'ovw-phone-only' }, 'Next 7 days')),
      h('a', { class: 'link card-link', href: '#/calendar' }, 'Open calendar')),
    strip,
    list);
}

function tasksCard(ctx, tasks) {
  const titleId = uid('ovw-tasks');
  const card = h('section', { class: 'card is-list span-7 ovw-tasks', 'aria-labelledby': titleId },
    cardHead('Tasks', { id: titleId, link: { label: 'See all tasks', href: '#/tasks' } }));
  if (!tasks.length) {
    card.append(cardEmpty('No open tasks.', 'check-square'));
    return card;
  }
  card.append(h('ul', { class: 'ovw-task-list' }, tasks.map((item) => {
    const due = item.task.due_at ? dueLabel(item.task.due_at, ctx.now) : null;
    const title = item.task.title || 'Untitled';
    return h('li', { class: 'ovw-task' },
      h('span', { class: 'ovw-task-check' }, taskCheck(item, ctx, { size: 'md' })),
      h('a', {
        class: 'ovw-task-link',
        href: openHref(ctx, item.task.id),
        dataset: { focusKey: `row-${item.task.id}` },
      },
      h('span', { class: 'ovw-task-title' }, title),
      h('span', { class: ['ovw-task-due', toneClass(due?.tone)].filter(Boolean).join(' '), title: due?.full },
        due ? due.text : 'No due date')));
  })));
  return card;
}

async function mountStudent(ctx) {
  const student = ctx.scope?.student ?? ctx.me;
  const first = firstName(student.full_name);
  const lede = pendingLede();
  ctx.setHeader({ title: greeting(ctx.now, first), display: true, lede });
  const body = loadingGrid(['span-8', 'span-4', 'span-12']);
  ctx.host.append(body);

  let loaded;
  try {
    loaded = await loadAll(ctx, student.id);
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    lede.remove();
    body.replaceWith(loadError(ctx, student.id));
    return;
  }
  if (!ctx.alive()) return;

  const { data, updates, names } = loaded;
  const now = ctx.now;
  const items = ctx.store.itemsFor(data, { now, audience: ctx.audience, viewerId: ctx.me.id });
  const seen = getSeen('graded', ctx.me.id, student.id);
  const graded = items.filter((i) => i.bucket === 'graded');
  const newGrades = graded.filter((i) => isNewSince(i.grade?.released_at, seen, now)).length;
  const counts = weekCounts(items, now);
  const ledeText = studentLede({ ...counts, newGrades });
  lede.textContent = ledeText;

  const latest = gradedItems(items)[0] ?? null;
  const latestNew = Boolean(latest && latest.bucket === 'graded' && isNewSince(latest.grade.released_at, seen, now));
  const today = todayKey(now);

  const blocks = [
    dueNextSection(ctx, dueNext(items)),
    latestGradeCard(ctx, latest, latestNew),
    weekCard(ctx, weekStrip(items, today), today),
    tasksCard(ctx, openTasks(items, 5)),
    updatesCard(ctx, {
      span: 'span-5',
      title: 'From your tutor',
      updates,
      names,
      limit: 2,
      empty: 'No notes from your tutor yet.',
      studentFirstName: first,
      seen: getSeen('updates', ctx.me.id, student.id),
    }),
  ];
  animate(ctx, blocks);
  body.replaceWith(h('div', { class: 'grid-12 ovw-grid' }, blocks));
  ctx.announce(`Overview. ${ledeText}`);
}

// ---------------------------------------------------------------------------
// Parent (spec 5.3)

function mountWelcome(ctx) {
  ctx.setHeader({ title: greeting(ctx.now, firstName(ctx.me.full_name)), display: true });
  ctx.host.append(emptyState({
    icon: 'envelope-simple',
    text: 'Your account is ready. Once we link your child’s account, their work shows up here.',
  }));
  ctx.announce('Overview. Your account is ready.');
}

function overdueCard(ctx, list) {
  const titleId = uid('ovw-overdue');
  return h('section', { class: 'card is-list span-12 ovw-overdue', 'aria-labelledby': titleId },
    cardHead('Overdue', {
      id: titleId,
      icon: 'warning-circle',
      tone: 'danger',
      meta: countMeta(list.length, `${list.length} overdue`),
    }),
    rowList(list.map((item) => itemRow(item, { audience: ctx.audience, href: openHref(ctx, item.task.id), now: ctx.now }))));
}

function recentlyGradedCard(ctx, list, seen) {
  const titleId = uid('ovw-recent');
  const card = h('section', { class: 'card is-list span-5 ovw-recent', 'aria-labelledby': titleId },
    cardHead('Recently graded', { id: titleId, link: list.length ? { label: 'See graded work', href: '#/assignments/graded' } : null }));
  if (!list.length) {
    card.append(cardEmpty('No graded work yet.', 'check-circle'));
    return card;
  }
  card.append(miniList(list.map((item) => {
    const { grade, task } = item;
    const isNew = ctx.audience === 'family' && item.bucket === 'graded' && isNewSince(grade.released_at, seen, ctx.now);
    const when = `Graded ${shortDay(grade.released_at, ctx.now)}`;
    const meta = firstLine(grade.feedback) || when;
    return miniRow(ctx, item, {
      meta,
      status: scoreChip(grade.score),
      extra: isNew ? newPill() : null,
      label: [task.title || 'Untitled', `Score ${grade.score} out of 100`, when, isNew ? 'New' : null, meta !== when ? meta : null]
        .filter(Boolean).join(', '),
    });
  })));
  return card;
}

function comingUpCard(ctx, groups, { span = 'span-12', mini = false, overdue = [] } = {}) {
  const titleId = uid('ovw-coming');
  const card = h('section', { class: `card is-list ${span} ovw-coming`, 'aria-labelledby': titleId },
    cardHead('Coming up', { id: titleId, link: { label: 'Open calendar', href: '#/calendar' } }));
  if (!groups.length && !overdue.length) {
    card.append(cardEmpty('Nothing due in the next 7 days.', 'calendar-blank'));
    return card;
  }
  if (overdue.length) {
    card.append(h('div', { class: 'ovw-day-group' },
      h('h3', { class: 'ovw-dayhead is-danger' }, icon('warning-circle'), h('span', {}, 'Overdue'),
        h('span', { class: 'ovw-dayhead-count num' }, String(overdue.length))),
      mini
        ? miniList(overdue.map((item) => miniRow(ctx, item)))
        : rowList(overdue.map((item) => itemRow(item, { audience: ctx.audience, href: openHref(ctx, item.task.id), now: ctx.now })))));
  }
  card.append(...dayGroups(ctx, groups, { mini }));
  return card;
}

async function mountParent(ctx) {
  const student = ctx.scope.student;
  const first = firstName(displayName(student));
  const lede = pendingLede();
  ctx.setHeader({ title: parentTitle(first), display: true, lede });
  const body = loadingGrid(['span-12', 'span-7', 'span-5']);
  ctx.host.append(body);

  let loaded;
  try {
    loaded = await loadAll(ctx, student.id);
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    lede.remove();
    body.replaceWith(loadError(ctx, student.id));
    return;
  }
  if (!ctx.alive()) return;

  const { data, updates, names } = loaded;
  const now = ctx.now;
  const items = ctx.store.itemsFor(data, { now, audience: ctx.audience, viewerId: ctx.me.id });
  const counts = weekCounts(items, now);
  const ledeText = parentSummary(first, counts);
  lede.textContent = ledeText;

  const seenGraded = getSeen('graded', ctx.me.id, student.id);
  const seenUpdates = getSeen('updates', ctx.me.id, student.id);
  const anyNew = items.some((i) => i.bucket === 'graded' && isNewSince(i.grade?.released_at, seenGraded, now))
    || (updates ?? []).some((u) => isNewSince(u.created_at, seenUpdates, now));
  // Overdue tasks count too: an overdue task is in neither Coming up nor the
  // lede, so leaving it out here would hide it behind "All caught up"
  const overdue = overdueItems(items, { tasks: true });
  const coming = comingUp(items, now);
  const calm = !overdue.length && !coming.length && !anyNew;

  const blocks = [
    h('div', { class: 'span-12' }, progressPanel({ items, tasks: data.tasks, grades: data.submissions.map((s) => s.grade).filter(Boolean), name: first, now })),
    calm
      ? h('div', { class: 'span-12' }, emptyState({ icon: 'check-circle', text: `All caught up. ${first} has nothing due this week.` }))
      : null,
    !calm && overdue.length ? overdueCard(ctx, overdue) : null,
    updatesCard(ctx, {
      span: 'span-7',
      title: 'From your tutor',
      updates,
      names,
      limit: 3,
      meta: true,
      empty: 'No updates yet. Notes from your tutor will appear here.',
      studentFirstName: first,
      seen: seenUpdates,
    }),
    recentlyGradedCard(ctx, gradedItems(items).slice(0, 3), seenGraded),
    calm ? null : comingUpCard(ctx, coming),
  ].filter(Boolean);
  animate(ctx, blocks);
  body.replaceWith(h('div', { class: 'grid-12 ovw-grid' }, blocks));
  ctx.announce(`${parentTitle(first)}. ${ledeText}`);
}

// ---------------------------------------------------------------------------
// Staff student Overview (spec 5.4)

function needsReviewCard(ctx, entries, tasks, studentName) {
  const titleId = uid('ovw-review');
  const byId = new Map(tasks.map((t) => [String(t.id), t]));
  const card = h('section', { class: 'card is-list span-8 ovw-review', 'aria-labelledby': titleId },
    cardHead('Needs review', {
      id: titleId,
      meta: entries.length
        ? countMeta(entries.length, `${entries.length} ${entries.length === 1 ? 'submission' : 'submissions'} to review`)
        : null,
      link: { label: 'Open review queue', href: '#/review' },
    }));
  if (!entries.length) {
    card.append(cardEmpty('Nothing waiting for review.', 'tray'));
    return card;
  }
  card.append(rowList(entries.map((e) => queueRow(e.sub, {
    studentName,
    taskTitle: byId.get(String(e.sub.task_id))?.title || 'Untitled',
    attempt: e.attempt,
    total: e.total,
    newer: e.newer,
    now: ctx.now,
    showStudent: false,
  })), { label: 'Submissions to review' }));
  return card;
}

async function mountStaff(ctx) {
  const student = ctx.scope?.student;
  const name = displayName(student);
  const first = firstName(name);
  const header = ctx.setHeader({
    title: name,
    lead: avatar(name, { size: 40 }),
    lede: student?.email && student.email !== name ? h('p', { class: 'view-lede ovw-email' }, student.email) : null,
    actions: [
      button({ label: 'New assignment', variant: 'primary', icon: 'plus', onClick: () => ctx.openNew({ kind: 'assignment' }) }),
      button({ label: 'Post update', variant: 'secondary', icon: 'chat-circle-text', href: '#/updates?compose=1' }),
    ],
  });
  header?.classList.add('ovw-staff-head');
  const body = loadingGrid(['span-12', 'span-8', 'span-4']);
  ctx.host.append(body);

  let loaded;
  try {
    loaded = await loadAll(ctx, student.id);
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    body.replaceWith(loadError(ctx, student.id));
    return;
  }
  if (!ctx.alive()) return;

  const { data, updates, names } = loaded;
  const now = ctx.now;
  const items = ctx.store.itemsFor(data, { now, audience: ctx.audience, viewerId: ctx.me.id });
  const entries = reviewEntries(data.submissions);

  const blocks = [
    h('div', { class: 'span-12' }, progressPanel({ items, tasks: data.tasks, grades: data.submissions.map((s) => s.grade).filter(Boolean), name: first, now })),
    needsReviewCard(ctx, entries, data.tasks, name),
    comingUpCard(ctx, comingUp(items, now), { span: 'span-4', mini: true, overdue: overdueItems(items, { tasks: true }) }),
    updatesCard(ctx, {
      span: 'span-12',
      title: 'Latest updates',
      updates,
      names,
      limit: 3,
      showAudience: true,
      empty: 'No updates yet. Post one to keep the family in the loop.',
      studentFirstName: first,
    }),
  ];
  animate(ctx, blocks);
  body.replaceWith(h('div', { class: 'grid-12 ovw-grid' }, blocks));
  const n = entries.length;
  ctx.announce(`Overview for ${name}. ${n ? `${n} ${n === 1 ? 'submission needs' : 'submissions need'} review.` : 'Nothing needs review.'}`);
}
