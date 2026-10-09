// Overview (#/overview), spec 5.2 to 5.4. Three variants, chosen by ctx.page:
//   student  "Finish your profile" (until it is), greeting, Due next, Latest
//            grade, Upcoming sessions, Your tutors (photos and what each wrote),
//            This week, Tasks, From your tutor, Recent sessions, Progress
//   parent   "Help us get to know Maya" (until her profile is done), "Maya’s
//            week", Your children (two or more children only), Overdue,
//            Upcoming sessions, Maya’s tutors, updates, Recently graded,
//            Recent sessions, Coming up, Progress; with no linked child, a
//            single welcome empty state
//   staff    the selected student: Next session, progress, Needs review, Coming
//            up, updates
// Renders only inside ctx.host and checks ctx.alive() after every await. The
// sessions and tutors cards load on their own: if they fail, they show a quiet
// error with a retry and the rest of the page still renders.

import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import {
  button, pill, newPill, emptyState, errorCallout, itemRow, rowList, visuallyHidden, labelPart,
} from '../ui.js';
import { itemStatus, resultStatus } from '../status.js';
import { resultOf } from '../results.js';
import { dueLabel, dayKey, parseKey, todayKey, dayHeading } from '../dates.js';
import { sessionTitle, sessionState, tutorToneClass, upcomingSessions } from '../sessions-model.js';
import {
  changeNotes, canJoin, placeText, whenText, sessionRowLabel, tutorEntries, tutorsTitle,
} from '../schedule-summary.js';
import { buildHash, DRAWER_PARAMS } from '../router.js';
import { displayName, firstName } from '../format.js';
import { getSeen, isNewSince } from '../seen.js';
import { staffNames, updateItem, updateList } from '../updates-feed.js';
import { taskCheck } from '../task-check.js';
import { announceGoogleReturn, studentInviteControl } from '../google.js';
import { queueRow } from '../review-row.js';
import { progressPanel } from '../progress-panel.js';
import { loadStaffProfile } from '../student-profile-data.js';
import { staffProfileCards, familyAboutCard } from '../student-profile-card.js';
import { headerEmail } from '../student-profile-model.js';
import { personAvatar } from '../photos.js';
import { loadNudge, profileNudge } from '../profile-nudge.js';
import {
  recentRows, showChildrenRow, childHref, childSummary, childLines,
} from '../family-model.js';
import {
  greeting, studentLede, parentSummary, parentTitle, weekCounts, dueNext, overdueItems, comingUp,
  openTasks, gradedItems, weekStrip, stripLabel, chipStyle, shortDay, firstLine, lastUpdateLabel,
  reviewEntries,
} from '../overview-model.js';
import { detailsSummary, parseHomework, plainMath } from '../homework-doc.js';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STRIP_CHIPS = 2;
const ENTER_LIMIT = 8;
const CHANGE_NOTES = 3;   // moved or cancelled sessions listed above the rows

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
    'aria-label': label ?? [title, labelPart(metaText), status.label].filter(Boolean).join(', '),
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

// The student's data must load; updates, sessions and tutors fall back to null
// (their cards show an inline error) so one failure never blanks the page.
// Staff do not need the tutor list (their Next session names the tutor).
async function loadAll(ctx, studentId, { tutors: wantTutors = true } = {}) {
  const updates = ctx.store.getUpdates(studentId).catch(() => null);
  const sessions = ctx.store.getSessions(studentId).catch(() => null);
  const tutors = wantTutors ? ctx.store.getTutors(studentId).catch(() => null) : Promise.resolve(null);
  const names = staffNames().catch(() => new Map());
  const colors = ctx.store.getTutorColors();   // never rejects; lessons are in their tutor's color
  const data = await ctx.store.getStudentData(studentId);
  await colors;
  const tutorRows = await tutors;
  // What each tutor wrote about themselves (staff_profiles): a quiet extra, so
  // a failure only leaves the card without bios
  const cards = tutorRows?.length
    ? await ctx.store.getStaffCards(studentId, tutorRows.map((t) => t.tutor_id)).catch(() => new Map())
    : new Map();
  // staffNames may be empty (or not name this tutor): the tutor list has names too
  const known = new Map((await names) ?? []);
  for (const t of tutorRows ?? []) {
    if (t.full_name && !known.has(String(t.tutor_id))) known.set(String(t.tutor_id), t.full_name.trim());
  }
  return { data, updates: await updates, sessions: await sessions, tutors: tutorRows, names: known, cards };
}

// ---------------------------------------------------------------------------
// Tutoring sessions and tutors (spec "Other surfaces")

// A quiet in-card error with a retry, for a card whose data did not load
function cardError(text, onRetry) {
  return h('div', { class: 'ovw-card-empty ovw-card-error', role: 'alert' },
    h('span', { class: 'ovw-card-empty-icon' }, icon('warning-circle')),
    h('p', {}, text),
    button({ label: 'Try again', size: 'sm', variant: 'ghost', icon: 'arrow-counter-clockwise', onClick: onRetry }));
}

// A plain click opens the drawer through ctx.openSession; a modified click
// (new tab) falls back to the link's own href
function opensSession(ctx, id) {
  return (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    ctx.openSession(id);
  };
}

// One upcoming session: date block in the tutor's colour, subject, when, who,
// and where. Opens the session. Online and starting within 15 minutes (or
// already under way) it gets a Join link under the row (a sibling of the row's
// link, so a link never holds a link); otherwise the row names the place.
function sessionItem(ctx, s, names) {
  const now = ctx.now;
  const { m, d } = parseKey(dayKey(s.starts_at));
  const who = names.get(String(s.tutor_id)) ?? null;
  const state = sessionState(s, now);
  const title = sessionTitle(s);
  const joinable = canJoin(s, now);
  const place = joinable ? '' : placeText(s);

  let flag = null;
  if (state.key === 'now') flag = pill({ label: 'Now', tone: 'accent' });
  else if (state.key === 'moved') flag = pill({ label: 'Moved', tone: 'warning' });

  const caret = icon('caret-right');
  caret.classList.add('ovw-sess-caret');
  const link = h('a', {
    class: `row ovw-sess ${tutorToneClass(s.tutor_id)}`,
    href: openHref(ctx, `s${s.id}`),
    'aria-label': sessionRowLabel(s, { who, now }),
    dataset: { focusKey: `row-s${s.id}`, sessionId: String(s.id) },
    onClick: opensSession(ctx, s.id),
  },
  h('span', { class: 'ovw-sess-date', 'aria-hidden': 'true' },
    h('span', { class: 'ovw-sess-month' }, MONTHS_SHORT[m - 1]),
    h('span', { class: 'ovw-sess-day' }, String(d))),
  h('span', { class: 'ovw-sess-main' },
    h('span', { class: 'ovw-sess-title' }, title),
    h('span', { class: 'ovw-sess-meta' },
      h('span', { class: 'ovw-sess-when num' }, whenText(s, todayKey(now))),
      who ? h('span', { class: 'ovw-sess-who' }, `with ${who}`) : null,
      place ? h('span', { class: 'ovw-sess-place' }, place) : null)),
  h('span', { class: 'ovw-sess-aside' }, flag),
  caret);

  let join = null;
  if (joinable) {
    join = button({
      label: 'Join',
      size: 'sm',
      icon: 'arrow-square-out',
      href: s.meeting_url,
      ariaLabel: `Join ${title}${who ? ` with ${who}` : ''} online, opens in a new tab`,
    });
    join.setAttribute('target', '_blank');
    join.setAttribute('rel', 'noopener noreferrer');
  }
  return h('li', { class: 'ovw-sess-item' }, link, join ? h('div', { class: 'ovw-sess-actions' }, join) : null);
}

// Moves and cancellations the family has not seen yet, as quiet notes. The
// calendar marks them seen; the Overview only reads.
function changeList(notes) {
  const shown = notes.slice(0, CHANGE_NOTES);
  const more = notes.length - shown.length;
  return h('ul', { class: 'ovw-changes', 'aria-label': 'Schedule changes' },
    shown.map((n) => h('li', { class: `ovw-change tone-${n.kind === 'cancelled' ? 'danger' : 'warning'}` },
      icon(n.kind === 'cancelled' ? 'x-circle' : 'clock'),
      h('span', {}, n.text))),
    more > 0
      ? h('li', { class: 'ovw-change tone-neutral' },
        icon('info'),
        h('span', {}, `And ${more} more ${more === 1 ? 'change' : 'changes'}. Open the calendar to see them.`))
      : null);
}

// Families: the next 3 sessions, with notes on what moved or was cancelled
function sessionsCard(ctx, { span, sessions, names, seen, studentId }) {
  const titleId = uid('ovw-sess');
  const card = h('section', { class: `card is-list ${span} ovw-sessions`, 'aria-labelledby': titleId },
    cardHead('Upcoming sessions', { id: titleId, link: { label: 'Open calendar', href: '#/calendar' } }));
  if (sessions === null) {
    card.append(cardError('We couldn’t load sessions.', () => ctx.store.invalidate(studentId)));
    return card;
  }
  const notes = changeNotes(sessions, seen, ctx.now);
  const next = upcomingSessions(sessions, ctx.now, { limit: 3 });
  if (notes.length) card.append(changeList(notes));
  card.append(next.length
    ? h('ul', { class: 'ovw-sess-list', 'aria-label': 'Upcoming sessions' }, next.map((s) => sessionItem(ctx, s, names)))
    : cardEmpty('No sessions scheduled.', 'calendar-blank'));
  return card;
}

// Staff in a student's scope: one compact card for the next session, any tutor
function nextSessionCard(ctx, { sessions, names, studentId }) {
  const titleId = uid('ovw-next');
  const card = h('section', { class: 'card is-list span-12 ovw-nextsess', 'aria-labelledby': titleId },
    cardHead('Next session', { id: titleId, link: { label: 'Open calendar', href: '#/calendar' } }));
  if (sessions === null) {
    card.append(cardError('We couldn’t load sessions.', () => ctx.store.invalidate(studentId)));
    return card;
  }
  const next = upcomingSessions(sessions, ctx.now, { limit: 1 })[0];
  card.append(next
    ? h('ul', { class: 'ovw-sess-list', 'aria-label': 'Next session' }, sessionItem(ctx, next, names))
    : cardEmpty('No upcoming sessions.', 'calendar-blank'));
  return card;
}

// Each tutor once, with every subject they teach this student
function tutorPeople(entries) {
  const byId = new Map();
  for (const t of entries) {
    const id = String(t.id);
    if (!byId.has(id)) byId.set(id, { id: t.id, name: t.name, subjects: [] });
    if (t.subject) byId.get(id).subjects.push({ subject: t.subject, tone: t.tone });
  }
  return [...byId.values()];
}

const BIO_SHORT = 140;   // longer than this, the bio is clamped with a "More about" button

// One tutor: photo, name, subjects in the tutor's colour, then what they wrote
// about themselves (staff_profiles) when there is something
function tutorItem(ctx, t, card) {
  const clean = (v) => String(v ?? '').trim();
  const bio = clean(card?.bio);
  const teaches = clean(card?.subjects);
  const education = clean(card?.education);
  const interests = clean(card?.interests);
  const first = firstName(t.name);
  const extra = [
    education ? h('div', { class: 'prf-tutor-fact' }, h('dt', {}, 'School or university'), h('dd', {}, education)) : null,
    interests ? h('div', { class: 'prf-tutor-fact' }, h('dt', {}, 'Hobbies and interests'), h('dd', {}, interests)) : null,
  ].filter(Boolean);
  const more = extra.length ? h('dl', { class: 'prf-tutor-more', id: uid('prf-tutor-more') }, extra) : null;
  const bioEl = bio ? h('p', { class: 'prf-tutor-bio is-clamped' }, bio) : null;
  let toggle = null;
  if (more || (bio && bio.length > BIO_SHORT)) {
    if (more) more.hidden = true;
    toggle = button({ label: `More about ${first}`, variant: 'ghost', size: 'sm', className: 'prf-tutor-toggle', iconEnd: 'caret-down' });
    toggle.setAttribute('aria-expanded', 'false');
    if (more) toggle.setAttribute('aria-controls', more.id);
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.querySelector('.btn-label').textContent = open ? 'Show less' : `More about ${first}`;
      bioEl?.classList.toggle('is-clamped', !open);
      if (more) more.hidden = !open;
    });
  } else {
    bioEl?.classList.remove('is-clamped');
  }
  return h('li', { class: card ? 'ovw-tutor prf-tutor has-card' : 'ovw-tutor prf-tutor' },
    personAvatar(t.id, t.name, { size: 40, staff: true }),
    h('span', { class: 'ovw-tutor-main' },
      h('span', { class: 'ovw-tutor-name' }, t.name),
      t.subjects.length
        ? h('span', { class: 'prf-tutor-subjs' }, t.subjects.map((x) => h('span', { class: `ovw-subj ${x.tone}` }, x.subject)))
        : null,
      teaches ? h('span', { class: 'prf-tutor-teaches' }, `Teaches ${teaches}`) : null,
      bioEl,
      more,
      toggle));
}

// The student's tutors: photo, name and subjects (in the tutor's colour), and
// what each tutor wrote about themselves on their own Profile page
// invite: a student's "Get Google Calendar invites" control in the card's footer
function tutorsCard(ctx, { span, title, tutors, names, studentId, invite = false, cards = new Map() }) {
  const titleId = uid('ovw-tutors');
  const card = h('section', { class: `card is-list ${span} ovw-tutors`, 'aria-labelledby': titleId },
    cardHead(title, { id: titleId }));
  if (tutors === null) {
    card.append(cardError('We couldn’t load tutors.', () => ctx.store.invalidate(studentId)));
    return card;
  }
  const people = tutorPeople(tutorEntries(tutors, names));
  card.append(people.length
    ? h('ul', { class: 'ovw-tutor-list', 'aria-label': title }, people.map((t) => tutorItem(ctx, t, cards?.get?.(String(t.id)))))
    : cardEmpty('No tutors linked yet.', 'users-three'));
  if (invite) card.append(h('div', { class: 'card-foot ovw-tutors-foot' }, studentInviteControl({ toast: ctx.toast })));
  return card;
}

// Families: what the tutor wrote after the last few sessions. A row shows the
// day, subject, tutor, attendance and the start of the recap, and opens the
// session in the drawer. Placed beside the tutor notes.
function recentItem(ctx, r) {
  const recapId = uid('ovw-rcp-recap');
  const caret = icon('caret-right');
  caret.classList.add('ovw-rcp-caret');
  return h('li', { class: 'ovw-rcp-item' }, h('a', {
    class: `row ovw-rcp ${r.tone}`,
    href: openHref(ctx, `s${r.id}`),
    'aria-label': r.label,
    'aria-describedby': r.recap ? recapId : undefined,
    dataset: { focusKey: `row-s${r.id}`, sessionId: String(r.id) },
    onClick: opensSession(ctx, r.id),
  },
  h('span', { class: 'ovw-sess-date', 'aria-hidden': 'true' },
    h('span', { class: 'ovw-sess-month' }, MONTHS_SHORT[r.month - 1]),
    h('span', { class: 'ovw-sess-day' }, String(r.day))),
  h('span', { class: 'ovw-rcp-main' },
    h('span', { class: 'ovw-sess-title' }, r.title),
    h('span', { class: 'ovw-sess-meta' },
      h('span', { class: 'ovw-sess-when num' }, r.when),
      r.who ? h('span', { class: 'ovw-sess-who' }, `with ${r.who}`) : null)),
  h('span', { class: r.recap ? 'ovw-rcp-recap' : 'ovw-rcp-recap is-empty', id: recapId }, r.recap ?? 'No notes yet'),
  h('span', { class: 'ovw-rcp-aside' }, r.attendance ? pill(r.attendance) : null),
  caret));
}

function recentSessionsCard(ctx, { span = 'span-12', sessions, names, studentId }) {
  const titleId = uid('ovw-rcp');
  const card = h('section', { class: `card is-list ${span} ovw-rcps`, 'aria-labelledby': titleId },
    cardHead('Recent sessions', { id: titleId, link: { label: 'See all in Calendar', href: '#/calendar' } }));
  if (sessions === null) {
    card.append(cardError('We couldn’t load sessions.', () => ctx.store.invalidate(studentId)));
    return card;
  }
  const rows = recentRows(sessions, names, ctx.now);
  card.append(rows.length
    ? h('ul', { class: 'ovw-rcp-list', 'aria-label': 'Recent sessions' }, rows.map((r) => recentItem(ctx, r)))
    : cardEmpty('No past sessions yet. Notes from each session show up here.', 'calendar-blank'));
  return card;
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
  // A structured problem set shows its objective; typed text shows as typed (math as TeX)
  const details = firstLine(task.details)
    ? (parseHomework(task.details).structured ? detailsSummary(task.details) : plainMath(task.details.trim()))
    : '';

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
    h('p', { class: 'ovw-result' }, pill(resultStatus(resultOf(grade)))),
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
  // A student who connected Google from this page lands back here
  announceGoogleReturn(ctx);
  const body = loadingGrid(['span-8', 'span-4', 'span-8', 'span-4', 'span-12']);
  ctx.host.append(body);

  // "Finish your profile" loads beside the page (never rejects), so the card is
  // in place on the first render and nothing moves under the reader
  const nudgeLoad = loadNudge(ctx, { kind: 'student', person: student });
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
  const nudgeStatus = await nudgeLoad;
  if (!ctx.alive()) return;

  const { data, updates, sessions, tutors, names, cards } = loaded;
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
    profileNudge(ctx, { kind: 'student', person: student, status: nudgeStatus }),
    dueNextSection(ctx, dueNext(items)),
    latestGradeCard(ctx, latest, latestNew),
    sessionsCard(ctx, { span: 'span-8', sessions, names, seen: getSeen('schedule', ctx.me.id, student.id), studentId: student.id }),
    tutorsCard(ctx, { span: 'span-4', title: 'Your tutors', tutors, names, studentId: student.id, invite: ctx.me.role === 'student', cards }),
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
    recentSessionsCard(ctx, { sessions, names, studentId: student.id }),
    // Below their due work. Released results only: RLS gives a student a null
    // grade for anything not released.
    h('div', { class: 'span-12' }, progressPanel({ items, tasks: data.tasks, submissions: data.submissions, now })),
    familyAboutCard(ctx, student),
  ].filter(Boolean);
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

// Parent with two or more children: one compact item per child, linking to
// that child's Overview. Each child loads on its own, so one failure leaves a
// small note on that item and the rest of the page is untouched.
async function loadChildSummaries(ctx, children, currentId) {
  return Promise.all(children.map(async (child) => {
    try {
      // The page keeps the student on screen fresh itself. A sibling read from
      // a cache older than the app's refresh window (a tab left open overnight)
      // is dropped quietly, with no change event, and loaded again.
      if (String(child.id) !== String(currentId)) ctx.store.dropIfStale(child.id);
      const [data, sessions] = await Promise.all([
        ctx.store.getStudentData(child.id).catch(() => null),
        ctx.store.getSessions(child.id).catch(() => null),
      ]);
      const items = data ? ctx.store.itemsFor(data, { now: ctx.now, audience: ctx.audience, viewerId: ctx.me.id }) : null;
      return childSummary({ child, items, sessions, now: ctx.now });
    } catch (error) {
      console.error(error);
      return childSummary({ child, now: ctx.now });
    }
  }));
}

function kidLine(iconName, part) {
  return h('span', { class: part.tone ? `ovw-kid-line is-${part.tone}` : 'ovw-kid-line' },
    icon(iconName, { size: 14 }),
    h('span', {}, part.text));
}

function kidItem(ctx, summary, currentId) {
  const lines = childLines(summary);
  const current = summary.id === String(currentId);
  return h('li', {}, h('a', {
    class: 'ovw-kid',
    href: childHref(summary.id),
    'aria-label': lines.label,
    'aria-current': current ? 'true' : undefined,
    dataset: { focusKey: `child-${summary.id}` },
  },
  h('span', { class: 'ovw-kid-head' },
    personAvatar(summary.id, summary.name, { size: 32 }),
    h('span', { class: 'ovw-kid-name' }, summary.name),
    current ? pill({ label: 'Viewing', tone: 'neutral' }) : null),
  lines.next ? kidLine('calendar-blank', lines.next) : kidLine('info', { text: 'Schedule unavailable', tone: 'quiet' }),
  lines.overdue
    ? kidLine(summary.overdue > 0 ? 'warning-circle' : 'check-circle', lines.overdue)
    : kidLine('info', { text: 'Work unavailable', tone: 'quiet' }),
  lines.grade ? kidLine('chart-line-up', lines.grade) : null));
}

// The card shows quiet placeholders until fill() gets the summaries
function childrenCard(ctx, children, currentId) {
  const titleId = uid('ovw-kids');
  const list = h('ul', { class: 'ovw-kids-list', 'aria-label': 'Your children' },
    children.map(() => h('li', { class: 'ovw-kid-sk', 'aria-hidden': 'true' },
      h('span', { class: 'skeleton ovw-sk-title' }),
      h('span', { class: 'skeleton ovw-sk-line' }),
      h('span', { class: 'skeleton ovw-sk-line is-short' }))));
  const card = h('section', { class: 'card is-list span-12 ovw-kids', 'aria-labelledby': titleId, 'aria-busy': 'true' },
    cardHead('Your children', { id: titleId }),
    list);
  return {
    card,
    fill(summaries) {
      list.replaceChildren(...summaries.map((sm) => kidItem(ctx, sm, currentId)));
      card.removeAttribute('aria-busy');
    },
  };
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
    const result = resultStatus(resultOf(grade), { audience: ctx.audience });
    return miniRow(ctx, item, {
      meta,
      status: pill(result),
      extra: isNew ? newPill() : null,
      label: [task.title || 'Untitled', result.label, when, isNew ? 'New' : null, meta !== when ? labelPart(meta) : null]
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
  const body = loadingGrid(['span-8', 'span-4', 'span-7', 'span-5', 'span-12']);
  ctx.host.append(body);

  // The children load beside the page's own data (both are cached by the
  // store). Failing to list them just means no "Your children" row.
  const kidsLoad = ctx.store.getChildren(ctx.me.id).then((kids) => kids ?? [], () => []);
  const summariesLoad = kidsLoad.then((kids) => (showChildrenRow(kids) ? loadChildSummaries(ctx, kids, student.id) : null));
  const nudgeLoad = loadNudge(ctx, { kind: 'student', person: student });

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
  const kids = await kidsLoad;
  const nudgeStatus = await nudgeLoad;
  if (!ctx.alive()) return;

  const { data, updates, sessions, tutors, names, cards } = loaded;
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
  const family = showChildrenRow(kids) ? childrenCard(ctx, kids, student.id) : null;

  // Work and the tutor's notes first; Progress is a summary, so it comes last
  const blocks = [
    profileNudge(ctx, { kind: 'student', person: student, status: nudgeStatus, parent: true }),
    family?.card,
    calm
      ? h('div', { class: 'span-12' }, emptyState({ icon: 'check-circle', text: `All caught up. ${first} has nothing due this week.` }))
      : null,
    !calm && overdue.length ? overdueCard(ctx, overdue) : null,
    sessionsCard(ctx, { span: 'span-8', sessions, names, seen: getSeen('schedule', ctx.me.id, student.id), studentId: student.id }),
    tutorsCard(ctx, { span: 'span-4', title: tutorsTitle(first), tutors, names, studentId: student.id, cards }),
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
    recentSessionsCard(ctx, { sessions, names, studentId: student.id }),
    calm ? null : comingUpCard(ctx, coming),
    h('div', { class: 'span-12' }, progressPanel({ items, tasks: data.tasks, submissions: data.submissions, now })),
    familyAboutCard(ctx, student),
  ].filter(Boolean);
  animate(ctx, blocks);
  body.replaceWith(h('div', { class: 'grid-12 ovw-grid' }, blocks));
  ctx.announce(`${parentTitle(first)}. ${ledeText}`);

  if (family) {
    const fill = (summaries) => { if (ctx.alive()) family.fill(summaries); };
    summariesLoad.then(
      (summaries) => fill(summaries ?? kids.map((child) => childSummary({ child, now }))),
      () => fill(kids.map((child) => childSummary({ child, now }))),
    );
  }
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
  const email = headerEmail(student, name);   // never a placeholder address
  const header = ctx.setHeader({
    title: name,
    lead: personAvatar(student.id, name, { size: 40 }),
    lede: email ? h('p', { class: 'view-lede ovw-email' }, email) : null,
    actions: [
      button({ label: 'New assignment', variant: 'primary', icon: 'plus', onClick: () => ctx.openNew({ kind: 'assignment' }) }),
      button({ label: 'Post update', variant: 'secondary', icon: 'chat-circle-text', href: '#/updates?compose=1' }),
    ],
  });
  header?.classList.add('ovw-staff-head');
  const body = loadingGrid(['span-12', 'span-12', 'span-8', 'span-4']);
  ctx.host.append(body);

  const profileLoad = loadStaffProfile(ctx.store, student.id);   // never rejects
  let loaded;
  try {
    loaded = await loadAll(ctx, student.id, { tutors: false });
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    body.replaceWith(loadError(ctx, student.id));
    return;
  }
  const profile = await profileLoad;
  if (!ctx.alive()) return;

  const { data, updates, sessions, names } = loaded;
  const now = ctx.now;
  const items = ctx.store.itemsFor(data, { now, audience: ctx.audience, viewerId: ctx.me.id });
  const entries = reviewEntries(data.submissions);

  const blocks = [
    nextSessionCard(ctx, { sessions, names, studentId: student.id }),
    ...staffProfileCards(ctx, student, profile),
    h('div', { class: 'span-12' }, progressPanel({ items, tasks: data.tasks, submissions: data.submissions, now })),
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
