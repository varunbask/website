// Calendar (spec 5.10): a week grid, a month grid with chips and a day panel,
// or an agenda list, showing the family's or the staff's due dates and the
// tutoring sessions together. One route serves families, staff with a selected
// student and staff looking at every student (scope=all). View, week, month,
// day and the tutor filter live in the hash and change with replaceState, so
// this view re-renders itself in place; switching between one student and all
// students pushes and remounts.
//
// All pure decisions (matrix, chips, keyboard, labels, agenda, week layout
// inputs, filters) live in calendar-model.js and sessions-model.js. Everything
// renders inside ctx.host.
//
// Google Calendar (google.js): a tutor with sync on sees a switch in the toolbar
// and, in the Week grid, their own Google events beside the sessions, read-only
// and drawn from nothing the portal stores. A student gets the invite button.
// If the status or the events cannot be had, the calendar is exactly as before.

import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { sb } from '../supabase.js';
import { choiceDialog } from '../overlays.js';
import { pointerDrag, hitAt } from '../calendar-drag.js';
import {
  canDragSession, canDragDue, dropStart, grabOffset, minutesToTime, movedTimes, moveProblem, moveUpdates, followingMove,
  moveSummary, moveToast, MOVE_PROBLEMS, dueMoveProblem, dueAtFor, dueToast, DUE_PAST, followingFits,
} from '../calendar-drag-model.js';
import { clashReport, mergeSessions, saveErrorText } from '../session-form-model.js';
import {
  itemRow, rowList, groupHeader, emptyState, errorCallout, skeletonRows,
  segmented, iconButton, button, select as selectControl, pill, initials, visuallyHidden, drawerHref,
} from '../ui.js';
import { deriveItems } from '../buckets.js';
import {
  todayKey, dayKey, monthTitle, dayHeading, addDays, longDate, viewerIsInBusinessZone,
} from '../dates.js';
import { displayName, canHaveSessions } from '../format.js';
import { markSeen } from '../seen.js';
import { staffNames } from '../updates-feed.js';
import {
  clockText, timeRange, sessionTitle, sessionState, sessionAria, sessionsByDay, isCancelled,
  toneClass, subjectLegend, hourRange, layoutDay, weekTitle, durationMinutes, followingInSeries, timeInput,
} from '../sessions-model.js';
import {
  announceGoogleReturn, tutorGoogleControl, studentInviteControl, syncNow, syncSoon, personalEvents, cachedPersonalEvents,
} from '../google.js';
import {
  personalBlocks, allDayOn, weekRange, personalLabel, personalWhen, googleDayUrl, personalClashes, mergePersonalClashes,
} from '../google-model.js';
import {
  AGENDA_DAYS, PANEL_DAYS,
  monthOf, monthMatrix, shiftMonth, weekdayHeaders, cellText,
  itemsByDay, moveKey, capacityForGrid, chipsFor, moreLabel, chipKind, chipTime,
  dayLabel, itemAria, dateWords, shortDay, agendaGroups, agendaWithSessions, needsNotes,
  resolveState, countInMonth, inGrid, dayEntries, dotsForDay,
  deriveWeek, monthOfWeek, weekDays, hourLabel, hourMarks, nowFraction, slotTime, sessionsInRange, viewRange,
  resolveSessionFilter, filterSessions, tutorOptions, sessionWho,
} from '../calendar-model.js';

const STORE_KEY = 'vb-cal-view';
const BREAKPOINTS = ['(min-width: 768px)', '(min-width: 1024px)', '(min-width: 1280px)'];
const ENTER_LIMIT = 8;
const NOW_TICK_MS = 60_000;

// Opening the calendar with sync on syncs once per page load, not on every
// refresh or visit
let syncedThisLoad = false;
const NO_PERSONAL = Object.freeze({ timed: [], byDay: new Map(), allDay: [] });

// A session's place: a link makes it online. The icon set has no camera or
// pin, so the link icon stands for "online" and the group for "in person".
const ONLINE_ICON = 'arrow-square-out';
const PLACE_ICON = 'users-three';
const STATE_ICONS = {
  cancelled: 'x-circle', now: 'clock', moved: 'clock', scheduled: null,
  attended: 'check-circle', late: 'clock', missed: 'minus-circle', finished: 'check',
};

// The list view's extended range per scope (a student id, or 'all'), so a
// store refresh keeps "Show the next 30 days" instead of shrinking the list.
// Read only on a refresh; a fresh visit starts at AGENDA_DAYS again.
const listRanges = new Map();

function readStoredView() {
  try {
    return globalThis.localStorage?.getItem(STORE_KEY) ?? null;
  } catch {
    return null;
  }
}

function storeView(view) {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, view);
  } catch {
    // storage blocked: the hash still carries the view
  }
}

const matches = (query) => (typeof matchMedia === 'function' ? matchMedia(query).matches : true);
const viewportWidth = () => (typeof window === 'undefined' ? 1280 : window.innerWidth);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const cssEscape = (s) => (globalThis.CSS?.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));
const currentHash = () => (typeof location === 'undefined' ? '' : location.hash);

export function mount(ctx) {
  const { host } = ctx;
  const staff = ctx.audience === 'staff';
  const student = ctx.scope?.student ?? null;
  const allScope = staff && ctx.route.params?.scope === 'all';
  const audience = allScope ? 'staff' : ctx.audience;
  // On the all-students view the create drawer shows the Student select (it
  // reads scope=all from the route), so creating is offered there too
  const canCreate = staff && !ctx.readOnly;
  const today = todayKey(ctx.now);
  const rangeKey = allScope ? 'all' : String(student?.id ?? '');
  if (!ctx.isRefresh) listRanges.delete(rangeKey);

  // ctx.now is fixed for a render; the now line keeps time from it
  const mountedAt = Date.now();
  const clock = () => new Date(new Date(ctx.now).getTime() + (Date.now() - mountedAt));

  const state = {
    ...resolveState(ctx.route.params ?? {}, { today, wide: matches('(min-width: 768px)'), stored: readStoredView() }),
    filter: allScope ? resolveSessionFilter(ctx.route.params ?? {}, ctx.me.role) : { who: 'all', tutor: null },
    focus: null,          // roving day in the month grid (keyboard), may differ from selected
    range: listRanges.get(rangeKey) ?? AGENDA_DAYS, // list view days, extended 30 at a time
    status: 'loading',    // 'loading' | 'ready' | 'error'
    items: [],
    byDay: new Map(),
    sessions: [],         // every session loaded, before the tutor filter
    shown: [],            // the sessions the filter lets through
    sessionDays: new Map(), // shown sessions by Pacific day
    tutorNames: new Map(),
    studentNames: new Map(),
    links: [],
    hours: null,          // the week grid's { start, end } hours, for the now line
    google: null,         // a tutor's Google status once read
    personal: new Map(),  // week start key -> the tutor's Google events for that week, ready to draw
    capacity: capacityForGrid(0, viewportWidth()),
    wide: matches('(min-width: 768px)'),
  };

  let lede = null;
  if (allScope) lede = 'Every student’s sessions and due dates in one place.';
  else if (!staff) lede = 'Your sessions and due dates.';
  ctx.setHeader({ title: 'Calendar', lede });

  // Back from Google's consent screen: say how it went, then tidy the address. A fresh
  // connection is pushed by the server already, so this load does not ask for a sync too.
  if (announceGoogleReturn(ctx) === 'connected') syncedThisLoad = true;

  // The name after "with": the tutor on one student's calendar, the student
  // (and for an admin the tutor) on the all-students one
  const whoOptions = () => ({
    allScope,
    tutorNames: state.tutorNames,
    studentNames: state.studentNames,
    role: ctx.me.role,
    viewerId: ctx.me.id,
  });
  const spokenWho = (s) => sessionWho(s, whoOptions());
  const shortWho = (s) => sessionWho(s, { ...whoOptions(), short: true });

  // -------------------------------------------------------------------------
  // Toolbar: title, previous / next / Today, scope, tutor filter, layout and
  // "New session", then the subject legend

  const titleId = uid('cal-title');
  const title = h('h2', { class: 'cal-title', id: titleId, 'aria-live': 'polite' });

  const prevBtn = iconButton({ icon: 'caret-left', label: 'Previous month', focusKey: 'cal-prev', onClick: () => step(-1) });
  const nextBtn = iconButton({ icon: 'caret-right', label: 'Next month', focusKey: 'cal-next', onClick: () => step(1) });
  const todayBtn = button({ label: 'Today', size: 'sm', className: 'cal-today', focusKey: 'cal-today', onClick: goToday });
  const navGroup = h('div', { class: 'cal-nav' }, todayBtn, h('div', { class: 'cal-steps' }, prevBtn, nextBtn));

  const viewSeg = segmented({
    label: 'Calendar layout',
    options: [{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'list', label: 'List' }],
    value: state.view,
    onChange: setView,
    className: 'cal-seg',
  });
  keyButtons(viewSeg, 'cal-view');

  let scopeSeg = null;
  if (staff && student) {
    scopeSeg = segmented({
      label: 'Whose calendar',
      options: [{ value: 'one', label: 'This student' }, { value: 'all', label: 'All students' }],
      value: allScope ? 'all' : 'one',
      onChange: (v) => ctx.setParams(v === 'all' ? { scope: 'all' } : { scope: null, who: null, tutor: null }),
      className: 'cal-seg',
    });
    keyButtons(scopeSeg, 'cal-scope');
  }

  // Tutors: "My sessions / All". Admins: a select of tutors, built once the
  // tutor names are known
  const filterSlot = h('div', { class: 'cal-filter' });

  const newBtn = canCreate
    ? button({
      label: 'New session',
      icon: 'plus',
      size: 'sm',
      className: 'cal-new',
      focusKey: 'cal-new-session',
      onClick: () => ctx.openNewSession({ due: newSessionDay() }),
    })
    : null;

  // Google Calendar: the sync switch for a tutor or an admin (for the sessions
  // they teach), a student's invite button, nothing for parents
  let googleEl = null;
  if (canHaveSessions(ctx.me.role)) {
    googleEl = tutorGoogleControl({ toast: ctx.toast, store: ctx.store, signal: ctx.signal, onStatus: onGoogleStatus });
  } else if (ctx.me.role === 'student') {
    googleEl = studentInviteControl({ toast: ctx.toast });
  }

  const legendEl = h('ul', { class: 'cal-legend', 'aria-label': 'Subjects', hidden: true });

  const toolbar = h('div', { class: 'cal-toolbar' },
    h('div', { class: 'cal-toolbar-main' }, title, navGroup),
    h('div', { class: 'cal-toolbar-controls' }, scopeSeg, filterSlot, viewSeg, googleEl, newBtn),
    legendEl);

  const body = h('div', { class: 'cal-body' });
  // A sessions load that failed: due dates still show, with this above them
  const notice = h('div', { class: 'cal-notice' });
  host.append(toolbar, notice, body);

  if (allScope && ctx.me.role === 'tutor') buildFilter();

  // -------------------------------------------------------------------------
  // State changes

  function setParams(params) {
    ctx.setParams(params, { replace: true });
  }

  // The day a toolbar "New session" starts on: the selected day in Month,
  // today (or the first day of another week) in Week, otherwise today
  function newSessionDay() {
    if (state.view === 'month' && state.selected) return state.selected;
    if (state.view === 'week') return weekDays(state.week, today).some((d) => d.isToday) ? today : state.week;
    return today;
  }

  function setView(view) {
    const from = state.view;
    state.view = view;
    storeView(view);
    if (view === 'week') {
      // Coming from Month the week follows the selected day (or the month);
      // from List it is the week last shown
      if (from === 'month') state.week = deriveWeek({ selected: state.selected, month: state.month, today });
      setParams({ view, w: state.week, m: state.month });
    } else if (view === 'month') {
      setParams({ view, w: null, m: state.month });
    } else {
      setParams({ view });
    }
    render();
    if (view === 'month') syncLayout();
  }

  function step(n) {
    if (state.view === 'week') goWeek(addDays(state.week, 7 * n));
    else goMonth(n);
  }

  // Moves the week grid. A selected day outside the new week is cleared.
  function goWeek(week) {
    state.week = week;
    state.month = monthOfWeek(week);
    if (state.selected && !weekDays(week, today).some((d) => d.key === state.selected)) state.selected = null;
    setParams({ w: week, m: state.month, d: state.selected });
    render();
  }

  // Moves the grid to a month. A selected day the new grid does not show is
  // cleared, so the panel falls back to the next 7 days.
  function showMonth(month) {
    state.month = month;
    if (state.selected && !inGrid(month, state.selected)) state.selected = null;
    setParams({ m: month, d: state.selected });
  }

  function goMonth(n) {
    showMonth(shiftMonth(state.month, n));
    state.focus = null;
    render();
  }

  function goToday() {
    state.month = monthOf(today);
    if (state.view === 'week') {
      state.week = deriveWeek({ month: state.month, today });
      state.selected = null;
      setParams({ w: state.week, m: state.month, d: null });
    } else {
      state.selected = today;
      state.focus = today;
      setParams({ m: state.month, d: today });
    }
    render();
  }

  // Selecting never toggles: a second click, Enter or "+N more" keeps the day
  // open. The panel's "Show next 7 days" button is the way back.
  function select(key) {
    state.selected = key;
    state.focus = key;
    setParams({ m: state.month, d: key });
    const hadFocus = body.contains(document.activeElement);
    render();
    if (hadFocus) focusDay(key);
  }

  function clearSelection() {
    const key = state.selected;
    state.selected = null;
    state.focus = key;
    setParams({ d: null });
    render();
    if (key) focusDay(key);
  }

  function focusDay(key) {
    body.querySelector(`button.cal-day[data-date="${cssEscape(key)}"]`)?.focus();
  }

  // ---- Whose sessions -----------------------------------------------------

  function applyFilter() {
    state.shown = allScope ? filterSessions(state.sessions, state.filter, ctx.me) : state.sessions;
    state.sessionDays = sessionsByDay(state.shown);
  }

  function setWho(who) {
    state.filter = { who, tutor: null };
    setParams({ who: who === 'all' ? 'all' : null });
    applyFilter();
    render();
  }

  function setTutor(id) {
    state.filter = { who: 'all', tutor: id || null };
    setParams({ tutor: id || null });
    applyFilter();
    render();
  }

  function buildFilter() {
    filterSlot.replaceChildren();
    if (ctx.me.role === 'tutor') {
      const seg = segmented({
        label: 'Which sessions',
        options: [{ value: 'mine', label: 'My sessions' }, { value: 'all', label: 'All' }],
        value: state.filter.who,
        onChange: setWho,
        className: 'cal-seg',
      });
      keyButtons(seg, 'cal-who');
      filterSlot.append(seg);
    } else if (ctx.me.role === 'admin') {
      const options = tutorOptions({ links: state.links ?? [], sessions: state.sessions, names: state.tutorNames, meId: ctx.me.id });
      // A tutor in the hash that nobody has any more is dropped
      if (state.filter.tutor && !options.some((o) => o.value === state.filter.tutor)) {
        state.filter = { who: 'all', tutor: null };
        setParams({ tutor: null });
        applyFilter();
      }
      filterSlot.append(selectControl({
        label: 'Filter by tutor',
        options: [{ value: '', label: 'All tutors' }, ...options],
        value: state.filter.tutor ?? '',
        size: 'sm',
        onChange: setTutor,
      }));
      const sel = filterSlot.querySelector('select');
      if (sel) sel.dataset.focusKey = 'cal-tutor';
    }
  }

  // ---- Google Calendar ----------------------------------------------------

  // Personal events are the viewer's own, and only while sync is on and usable
  const personalOn = () => canHaveSessions(ctx.me.role)
    && Boolean(state.google?.connected && state.google.sync_enabled && state.google.last_error !== 'reconnect');

  // Hears the switch's status each time it is read or changed. Turning sync on makes the
  // server push and pull, so that load needs no sync of its own.
  function onGoogleStatus(status, { serverSynced = false } = {}) {
    const before = personalOn();
    state.google = status;
    if (!ctx.alive()) return;
    if (serverSynced) syncedThisLoad = true;
    if (personalOn()) syncOnce();
    if (before !== personalOn()) {
      state.personal.clear();
      if (state.status === 'ready') rerender();
    }
  }

  // Once per page load: push and pull now, then refresh what the pull changed.
  // A failure is quiet; the status the switch shows is read again.
  function syncOnce() {
    if (syncedThisLoad) return;
    syncedThisLoad = true;
    syncNow().then(
      () => ctx.store.invalidateAll(), // a pull can change any student's sessions
      (error) => {
        console.error(error);
        googleEl?.refresh?.();
      },
    );
  }

  const prepared = (events) => {
    const { timed, allDay } = personalBlocks(events);
    return { timed, byDay: sessionsByDay(timed), allDay };
  };

  // Makes sure this week's events are on the way (or already here). Called
  // before every render of the Week grid; a failure leaves the week without them.
  const personalPending = new Set();
  function ensurePersonal() {
    if (state.view !== 'week' || !state.wide || !personalOn()) return;
    const week = state.week;
    if (state.personal.has(week) || personalPending.has(week)) return;
    const { from, to } = weekRange(week);
    const cached = cachedPersonalEvents(from, to);
    if (cached) {
      state.personal.set(week, prepared(cached));
      return;
    }
    personalPending.add(week);
    personalEvents(from, to)
      .then((events) => state.personal.set(week, prepared(events)), (error) => {
        console.error(error);
        state.personal.set(week, NO_PERSONAL);
      })
      .finally(() => {
        personalPending.delete(week);
        if (ctx.alive() && state.status === 'ready' && state.view === 'week' && state.week === week) rerender();
      });
  }

  // The events to draw in the week on show, or null
  const personalWeek = () => (state.view === 'week' && state.wide && state.status === 'ready' && personalOn()
    ? state.personal.get(state.week) ?? null
    : null);

  // Draws again and puts keyboard focus back where it was
  function rerender() {
    const focused = body.contains(document.activeElement) ? document.activeElement.dataset?.focusKey : null;
    render();
    if (focused) body.querySelector(`[data-focus-key="${cssEscape(focused)}"]`)?.focus();
  }

  // One small dialog for every personal event: title, time and a link to the
  // day in Google Calendar. Modal, so Escape and a click outside close it.
  let popover = null;
  let popoverOpener = null;
  function personalPopover() {
    if (popover) return popover;
    const dialog = h('dialog', { class: 'popover cal-pop' });
    document.body.append(dialog);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => {
      const opener = popoverOpener;
      popoverOpener = null;
      if (opener?.isConnected) opener.focus();
    });
    ctx.signal?.addEventListener('abort', () => {
      dialog.close();
      dialog.remove();
      popover = null;
    }, { once: true });
    popover = dialog;
    return dialog;
  }

  function openPersonal(item, trigger) {
    const dialog = personalPopover();
    const titleId = uid('cal-pop');
    const link = button({
      label: 'Open in Google Calendar',
      iconEnd: 'arrow-square-out',
      size: 'sm',
      href: googleDayUrl(item.first ?? dayKey(item.starts_at)),
      ariaLabel: 'Open in Google Calendar, opens in a new tab',
      className: 'cal-pop-link',
    });
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    link.addEventListener('click', () => setTimeout(() => dialog.close(), 0));
    dialog.replaceChildren(h('div', { class: 'popover-inner cal-pop-inner' },
      h('p', { class: 'cal-pop-kind' }, 'Personal (Google Calendar)'),
      h('h2', { class: 'cal-pop-title', id: titleId }, item.title),
      h('p', { class: 'cal-pop-when num' }, personalWhen(item, { today })),
      link));
    dialog.setAttribute('aria-labelledby', titleId);
    popoverOpener = trigger;
    if (dialog.open) dialog.close();
    dialog.showModal();
    // From 768px it sits beside what opened it; phones get the sheet the CSS makes
    if (matches('(min-width: 768px)')) {
      const r = trigger.getBoundingClientRect();
      const w = dialog.offsetWidth;
      const hgt = dialog.offsetHeight;
      let left = r.right + 8;
      if (left + w > window.innerWidth - 8) left = r.left - w - 8;
      const top = Math.min(Math.max(8, r.top), window.innerHeight - hgt - 8);
      dialog.style.setProperty('left', `${Math.round(Math.max(8, left))}px`);
      dialog.style.setProperty('top', `${Math.round(Math.max(8, top))}px`);
    }
  }

  // -------------------------------------------------------------------------
  // Rendering

  function heading() {
    if (state.view === 'week') return weekTitle(state.week);
    if (state.view === 'month') return monthTitle(state.month);
    return `Next ${state.range} days`;
  }

  function renderNotice() {
    notice.replaceChildren(...(state.status === 'ready' && state.sessionsFailed
      ? [errorCallout({
        title: 'We couldn’t load sessions.',
        text: 'Due dates still show. Try again in a moment.',
        onRetry: () => ctx.store.invalidate(allScope ? null : student?.id ?? null),
      })]
      : []));
  }

  function render() {
    renderNotice();
    // Only a real change reaches the live region (a new text node re-announces)
    const text = heading();
    if (title.textContent !== text) title.textContent = text;
    navGroup.hidden = state.view === 'list';
    if (state.view === 'week') {
      relabel(prevBtn, `Previous week, ${weekTitle(addDays(state.week, -7))}`);
      relabel(nextBtn, `Next week, ${weekTitle(addDays(state.week, 7))}`);
    } else {
      relabel(prevBtn, `Previous month, ${monthTitle(shiftMonth(state.month, -1))}`);
      relabel(nextBtn, `Next month, ${monthTitle(shiftMonth(state.month, 1))}`);
    }
    host.classList.toggle('cal-is-list', state.view === 'list');
    ensurePersonal();
    renderLegend();

    body.setAttribute('aria-busy', state.status === 'loading' ? 'true' : 'false');
    if (state.status === 'error') {
      body.replaceChildren(errorCallout({
        title: 'We couldn’t load the calendar.',
        text: 'Check your connection and try again.',
        onRetry: () => ctx.store.invalidate(allScope ? null : student?.id ?? null),
      }));
      return;
    }
    if (state.view === 'week') body.replaceChildren(state.wide ? weekGrid() : weekList());
    else body.replaceChildren(state.view === 'month' ? monthLayout() : listLayout());
  }

  // The subjects of the sessions in view, as swatch and name; one subject
  // needs no legend
  function renderLegend() {
    let entries = [];
    if (state.status === 'ready') {
      const range = viewRange(state.view, state, today);
      entries = subjectLegend(sessionsInRange(state.shown, range.start, range.end));
    }
    const subjects = entries.length < 2 ? [] : entries;
    // The Personal item shows when the week on screen has Google events in it
    const personal = personalWeek();
    const hasPersonal = Boolean(personal && (personal.timed.length || personal.allDay.length));
    legendEl.hidden = !subjects.length && !hasPersonal;
    legendEl.setAttribute('aria-label', hasPersonal ? 'Key' : 'Subjects');
    const items = subjects.map((e) => h('li', { class: `cal-legend-item ${e.tone}` },
      h('span', { class: 'cal-swatch', 'aria-hidden': 'true' }),
      h('span', {}, e.subject)));
    if (hasPersonal) {
      items.push(h('li', { class: 'cal-legend-item is-personal' },
        h('span', { class: 'cal-swatch', 'aria-hidden': 'true' }),
        h('span', {}, 'Personal (Google)')));
    }
    legendEl.replaceChildren(...items);
  }

  // ---- Shared rows ----------------------------------------------------------

  function row(item) {
    return itemRow(item, {
      audience,
      now: ctx.now,
      variant: 'mixed',
      showStudent: Boolean(item.studentName),
      studentName: item.studentName ?? '',
    });
  }

  // One session as a row: a subject swatch, the subject, who and where, then
  // the time and the state pill. The link carries row-s<id> for focus return.
  function sessionRow(s) {
    const st = sessionState(s, ctx.now);
    const who = spokenWho(s);
    const place = s.meeting_url ? 'Online' : (s.location || null);
    const meta = [who ? `with ${who}` : null, place].filter(Boolean).join(', ');
    const link = h('a', {
      class: ['row', isCancelled(s) ? 'is-done' : null].filter(Boolean).join(' '),
      'aria-label': sessionAria(s, { who, now: ctx.now }),
      href: drawerHref(currentHash(), `s${s.id}`),
      dataset: { focusKey: `row-s${s.id}`, sessionId: String(s.id) },
    },
    h('span', { class: `row-lead cal-lead ${toneClass(s.subject)}` }, h('span', { class: 'cal-swatch' })),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, sessionTitle(s)),
      meta ? h('span', { class: 'row-meta' }, meta) : null),
    h('span', { class: 'row-aside' },
      h('span', { class: 'row-due num' }, timeRange(s)),
      // A plain upcoming session needs no pill; changes and outcomes get one
      st.key === 'scheduled' ? null : h('span', { class: 'row-status' }, pill({ ...st, icon: STATE_ICONS[st.key] }))),
    icon('caret-right'));
    link.lastChild.classList.add('row-caret');
    return h('li', {}, link);
  }

  // A day's rows: its sessions by time, then its due items
  const dayRows = (d) => [...d.sessions.map(sessionRow), ...d.items.map(row)];

  // ---- Week ---------------------------------------------------------------

  const dayWords = (day) => `${dateWords(day.key, today)}${day.isToday ? ', today' : ''}`;

  function weekGrid() {
    const days = weekDays(state.week, today);
    const weekSessions = sessionsInRange(state.shown, state.week, addDays(state.week, 6));
    // The tutor's Google events: the ones that start in this week widen the hours too
    const personal = personalWeek();
    const inWeek = new Set(days.map((d) => d.key));
    const personalTimed = personal ? personal.timed.filter((e) => inWeek.has(dayKey(e.starts_at))) : [];
    const range = hourRange([...weekSessions, ...personalTimed]);
    state.hours = range;
    const hours = hourMarks(range);
    const span = (range.end - range.start) * 60;
    const loading = state.status === 'loading';
    const dueOf = (key) => (loading ? [] : state.byDay.get(key) ?? []);
    const allDayOf = (key) => (personal ? allDayOn(personal.allDay, key) : []);
    const hasDue = days.some((d) => dueOf(d.key).length || allDayOf(d.key).length);
    const cellClass = (day, base) => [base, day.isToday ? 'is-today' : null, day.isWeekend ? 'is-weekend' : null].filter(Boolean).join(' ');

    // Times are Pacific; a viewer in another zone is told once, in the corner
    const zone = viewerIsInBusinessZone(ctx.now)
      ? null
      : h('span', { class: 'cal-week-zone' }, h('span', { 'aria-hidden': 'true' }, 'PT'), visuallyHidden('Times are shown in Pacific time'));

    const head = h('div', { class: 'cal-week-row cal-week-head' },
      h('div', { class: 'cal-week-corner' }, zone),
      days.map((day) => h('div', { class: cellClass(day, 'cal-week-dayhead') },
        h('span', { class: 'cal-week-daylabel', 'aria-hidden': 'true' },
          h('span', { class: 'cal-week-dow' }, day.short),
          h('span', { class: 'cal-num num' }, String(day.num))),
        canCreate
          ? iconButton({
            icon: 'plus',
            label: `New session on ${longDate(day.key)}`,
            tip: false,
            className: 'cal-week-add',
            focusKey: `cal-add-${day.key}`,
            onClick: () => ctx.openNewSession({ due: day.key, at: '16:00' }),
          })
          : null)));

    const dues = hasDue
      ? h('div', { class: 'cal-week-row cal-week-dues' },
        h('div', { class: 'cal-week-duelabel' }, 'Due'),
        days.map((day) => {
          const list = dueOf(day.key);
          const allDay = allDayOf(day.key);
          const cell = h('div', { class: cellClass(day, 'cal-week-due cal-chips'), dataset: { date: day.key } },
            list.map((item) => dueChip(item, { link: true })),
            allDay.map(personalChip));
          if (list.length || allDay.length) {
            cell.setAttribute('role', 'group');
            // "Due on ...", or the all-day events that share the row
            const what = list.length ? (allDay.length ? 'Due and all-day personal events' : 'Due') : 'All-day personal events';
            cell.setAttribute('aria-label', `${what} on ${dayWords(day)}`);
          }
          return cell;
        }))
      : null;

    const gutter = h('div', { class: 'cal-week-hours', 'aria-hidden': 'true' },
      hours.map((hour, i) => {
        const label = h('span', { class: 'cal-week-hour num' }, hourLabel(hour));
        label.style.setProperty('--i', String(i));
        return label;
      }));

    const tracks = days.map((day) => {
      const track = h('div', { class: cellClass(day, 'cal-week-track'), dataset: { date: day.key } });
      const daySessions = state.sessionDays.get(day.key) ?? [];
      const dayPersonal = personal?.byDay.get(day.key) ?? [];
      const blocks = layoutDay([...daySessions, ...dayPersonal], { startHour: range.start, endHour: range.end });
      for (const layout of blocks) track.append(layout.session.personal ? personalBlock(layout, span) : sessionBlock(layout, span));
      if (blocks.length) {
        track.setAttribute('role', 'group');
        const what = !dayPersonal.length ? 'Sessions' : daySessions.length ? 'Sessions and personal events' : 'Personal events';
        track.setAttribute('aria-label', `${what} on ${dayWords(day)}`);
      }
      if (day.isToday) {
        const fraction = nowFraction(clock(), range);
        if (fraction !== null) {
          const line = h('div', { class: 'cal-now', 'aria-hidden': 'true' });
          line.style.setProperty('--top', String(fraction));
          track.append(line);
        }
      }
      // Mouse only: an empty spot starts a session at that hour. The keyboard
      // reaches the same thing through the "New session" button in each header.
      if (canCreate) track.addEventListener('click', onTrackClick);
      return track;
    });

    const grid = h('div', {
      class: ['cal-week', canCreate ? 'can-create' : null].filter(Boolean).join(' '),
      role: 'group',
      'aria-labelledby': titleId,
    }, head, dues, h('div', { class: 'cal-week-row cal-week-body' }, gutter, tracks));
    grid.style.setProperty('--hours', String(hours.length));
    return h('div', { class: 'cal-week-wrap' }, grid);
  }

  // A session block: time, subject and who, with an online or in-person icon.
  // Its box comes from the layout's fractions through custom properties.
  function sessionBlock(layout, span) {
    const s = layout.session;
    const st = sessionState(s, ctx.now);
    const cancelled = isCancelled(s);
    const moved = Boolean(s.moved_from) && !cancelled && Date.parse(s.ends_at) > new Date(ctx.now).getTime();
    const minutes = Math.round(layout.height * span);
    // Lines that fit: one under 43 minutes, two under an hour, else three
    const size = minutes < 43 ? 'is-tiny' : minutes < 60 ? 'is-short' : null;
    const who = allScope ? shortWho(s) : spokenWho(s);
    const placeIcon = s.meeting_url ? ONLINE_ICON : s.location ? PLACE_ICON : null;

    const el = h('button', {
      type: 'button',
      class: [
        'cal-block', toneClass(s.subject), size,
        cancelled ? 'is-cancelled' : null,
        moved ? 'is-moved' : null,
        st.key === 'now' ? 'is-now' : null,
      ].filter(Boolean).join(' '),
      'aria-label': sessionAria(s, { who: spokenWho(s), now: ctx.now }),
      dataset: { focusKey: `row-s${s.id}`, sessionId: String(s.id) },
      onClick: () => ctx.openSession(s.id),
    },
    h('span', { class: 'cal-block-head' },
      h('span', { class: 'cal-block-time num' }, clockText(s.starts_at)),
      placeIcon ? h('span', { class: 'cal-block-place' }, icon(placeIcon, { size: 12 })) : null),
    h('span', { class: 'cal-block-title' }, sessionTitle(s)),
    who || moved
      ? h('span', { class: 'cal-block-foot' },
        who ? h('span', { class: 'cal-block-who' }, allScope ? who : `with ${who}`) : null,
        moved ? h('span', { class: 'cal-block-tag' }, 'Moved') : null)
      : null);
    el.style.setProperty('--top', String(layout.top));
    el.style.setProperty('--height', String(layout.height));
    el.style.setProperty('--col', String(layout.col));
    el.style.setProperty('--cols', String(layout.cols));
    if (mayDragSession(s)) dragBlock(el, s);
    return el;
  }

  // One of the tutor's own Google events: a grey hatched block laid out in the
  // same columns as the sessions. It is a div (not a link) that opens the popover.
  function personalBlock(layout, span) {
    const item = layout.session;
    const minutes = Math.round(layout.height * span);
    const size = minutes < 43 ? 'is-tiny' : minutes < 60 ? 'is-short' : null;
    const el = h('div', {
      class: ['cal-block', 'cal-personal', size].filter(Boolean).join(' '),
      role: 'button',
      tabindex: '0',
      'aria-haspopup': 'dialog',
      'aria-label': personalLabel(item),
      dataset: { focusKey: `personal-${item.id}`, personalId: item.id },
    },
    h('span', { class: 'cal-block-head' }, h('span', { class: 'cal-block-time num' }, clockText(item.starts_at))),
    h('span', { class: 'cal-block-title' }, item.title));
    el.style.setProperty('--top', String(layout.top));
    el.style.setProperty('--height', String(layout.height));
    el.style.setProperty('--col', String(layout.col));
    el.style.setProperty('--cols', String(layout.cols));
    el.addEventListener('click', () => openPersonal(item, el));
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openPersonal(item, el);
    });
    return el;
  }

  // An all-day Google event in the Due row, as a grey chip that opens the same popover
  function personalChip(item) {
    const el = h('button', {
      type: 'button',
      class: 'cal-chip cal-chip-personal',
      'aria-haspopup': 'dialog',
      'aria-label': personalLabel(item),
      dataset: { focusKey: `personal-${item.id}`, personalId: item.id },
    }, h('span', { class: 'cal-chip-title' }, item.title));
    el.addEventListener('click', () => openPersonal(item, el));
    return el;
  }

  function onTrackClick(e) {
    const track = e.currentTarget;
    if (e.target !== track || !state.hours) return;
    const rect = track.getBoundingClientRect();
    if (!(rect.height > 0)) return;
    ctx.openNewSession({ due: track.dataset.date, at: slotTime((e.clientY - rect.top) / rect.height, state.hours) });
  }

  // The now line moves once a minute without a re-render
  function updateNow() {
    const line = body.querySelector('.cal-now');
    if (!line || !state.hours) return;
    const fraction = nowFraction(clock(), state.hours);
    line.hidden = fraction === null;
    if (fraction !== null) line.style.setProperty('--top', String(fraction));
  }

  // -------------------------------------------------------------------------
  // Drag to move (mouse or pen; see calendar-drag.js)

  // Links are known on the all-students calendar; on one student's they are not
  // loaded, and the database has the last word
  const dragLinks = () => (state.links?.length ? state.links : null);
  const mayDragSession = (s) => staff && canDragSession(s, ctx.me, { links: dragLinks(), now: clock(), readOnly: ctx.readOnly });
  const mayDragDue = (item) => canDragDue(item, { staff, readOnly: ctx.readOnly });

  // A session block in the week grid: a copy follows the pointer across the
  // day columns, snapped to 15 minutes, with the new time on it
  function dragBlock(el, s) {
    el.classList.add('is-draggable');
    pointerDrag(el, {
      start: (down) => {
        const track = el.closest('.cal-week-track');
        const rect = track?.getBoundingClientRect();
        if (!track || !state.hours || !(rect.height > 0)) return null;
        const grab = grabOffset({ fraction: (down.clientY - rect.top) / rect.height, hours: state.hours, session: s });
        const time = h('span', { class: 'cal-block-time num' });
        const minutes = durationMinutes(s);
        const size = minutes < 43 ? 'is-tiny' : minutes < 60 ? 'is-short' : null;
        const ghost = h('div', { class: ['cal-block', 'cal-drag-ghost', toneClass(s.subject), size].filter(Boolean).join(' '), 'aria-hidden': 'true' },
          h('span', { class: 'cal-block-head' }, time),
          h('span', { class: 'cal-block-title' }, sessionTitle(s)));
        el.classList.add('is-drag-source');
        return { ghost, time, grab, duration: durationMinutes(s), track: null, date: null, start: null };
      },
      move: (e, d) => {
        const hit = hitAt(e.clientX, e.clientY, '.cal-week-track');
        const track = hit && body.contains(hit) ? hit : null;
        // Off the day columns (the toolbar, the hours, outside): no drop there
        if (!track || !state.hours) {
          d.ghost.remove();
          d.track = null;
          d.date = null;
          return;
        }
        const rect = track.getBoundingClientRect();
        const minutes = dropStart({ fraction: (e.clientY - rect.top) / rect.height, hours: state.hours, duration: d.duration, grabMinutes: d.grab });
        d.track = track;
        d.date = track.dataset.date;
        d.start = minutesToTime(minutes);
        if (d.ghost.parentNode !== track) track.append(d.ghost);
        const span = (state.hours.end - state.hours.start) * 60;
        d.ghost.style.setProperty('--top', String((minutes - state.hours.start * 60) / span));
        d.ghost.style.setProperty('--height', String(d.duration / span));
        d.ghost.style.setProperty('--col', '0');
        d.ghost.style.setProperty('--cols', '1');
        const times = movedTimes(s, { date: d.date, start: d.start });
        d.time.textContent = times ? timeRange(times) : '';
        d.ghost.classList.toggle('is-invalid', ['past', 'overnight'].includes(moveProblem(s, { date: d.date, start: d.start }, clock())));
      },
      drop: (e, d) => {
        if (d.date) moveSession(s, { date: d.date, start: d.start });
      },
      end: (d) => {
        d?.ghost.remove();
        el.classList.remove('is-drag-source');
      },
    }, { signal: ctx.signal });
  }

  // A chip dragged to another day: a small copy follows the pointer and the
  // day under it is outlined (dashed when it cannot take the drop)
  function dragToDay(el, { cellSelector, label, valid, onDrop }) {
    el.classList.add('is-draggable');
    const clear = (cell) => cell?.classList.remove('is-drop-target', 'is-drop-invalid');
    pointerDrag(el, {
      start: () => {
        const ghost = h('div', { class: 'cal-drag-float', 'aria-hidden': 'true' }, label);
        document.body.append(ghost);
        el.classList.add('is-drag-source');
        return { ghost, cell: null, date: null };
      },
      move: (e, d) => {
        d.ghost.style.setProperty('--x', `${e.clientX + 12}px`);
        d.ghost.style.setProperty('--y', `${e.clientY + 12}px`);
        const hit = hitAt(e.clientX, e.clientY, cellSelector);
        const cell = hit && body.contains(hit) ? hit : null;
        if (cell === d.cell) return;
        clear(d.cell);
        d.cell = cell;
        d.date = cell?.dataset.date ?? null;
        if (cell) cell.classList.add(valid(d.date) ? 'is-drop-target' : 'is-drop-invalid');
      },
      drop: (e, d) => {
        if (d.date) onDrop(d.date);
      },
      end: (d) => {
        d?.ghost.remove();
        clear(d?.cell);
        el.classList.remove('is-drag-source');
      },
    }, { signal: ctx.signal });
  }

  // A dropped session: say where it goes (and what it clashes with), ask
  // about the rest of a series, then save the new times like the edit form
  // does. Families see it as moved, and Google gets it on the next sync (now,
  // for the viewer's own sessions).
  function moveSession(s, where) {
    moveSessionNow(s, where).catch((error) => {
      console.error(error);
      ctx.toast({ text: 'We couldn’t move that session. Refresh the page and try again.' });
    });
  }

  // The view may be redrawn while this runs (the store refreshes); nothing
  // here needs it, so it carries on
  async function moveSessionNow(s, { date, start }) {
    const problem = moveProblem(s, { date, start }, clock());
    if (problem === 'same') return;
    if (problem) {
      ctx.toast({ text: MOVE_PROBLEMS[problem] });
      return;
    }
    const times = movedTimes(s, { date, start });
    // The student's sessions (the series and their clashes) and the tutor's
    // (their other students); either failing only makes the clash check know less
    const [siblings, ws] = await Promise.all([
      Promise.resolve(ctx.store.getSessions(s.student_id)).catch((error) => { console.error(error); return []; }),
      Promise.resolve(ctx.store.getWorkspace()).catch((error) => { console.error(error); return null; }),
    ]);
    const rows = s.series_id ? followingInSeries(mergeSessions(siblings, [s]), s) : [s];
    const series = rows.length > 1;
    const fits = series && followingFits({ session: s, rows, date, start });
    const tutorsOwn = (list) => (list ?? []).filter((x) => String(x.tutor_id) === String(s.tutor_id));

    let report = clashReport({
      planned: [{ id: s.id, ...times }],
      studentId: s.student_id,
      tutorId: s.tutor_id,
      list: mergeSessions(siblings ?? [], tutorsOwn(ws?.sessions), tutorsOwn(state.sessions)),
      ignoreIds: [s.id],
      tutorNames: state.tutorNames,
      studentNames: state.studentNames,
    });
    if (String(s.tutor_id) === String(ctx.me.id) && personalOn()) {
      report = mergePersonalClashes(report, personalClashes(times, personalWeek()?.byDay.get(date) ?? []));
    }

    const summary = moveSummary(s, times, { who: shortWho(s) });
    const later = rows.length - 1;
    const laterText = later === 1 ? 'the later session' : `the ${later} later sessions`;
    let body = summary;
    if (series && fits) body = `${summary} This and following moves ${laterText} in the series by the same amount.`;
    else if (series) body = `${summary} Only this session can move: moving ${laterText} too would run one past midnight.`;
    const choice = await choiceDialog({
      title: 'Move this session?',
      body,
      warning: report?.title ? { title: report.title, lines: report.lines } : null,
      choices: series && fits
        ? [{ value: 'following', label: 'This and following' }, { value: 'this', label: 'This session', primary: true }]
        : [{ value: 'this', label: 'Move', primary: true }],
    });
    if (!choice) return;
    // The dialog may have stayed open while the new time went by
    const late = moveProblem(s, { date, start }, clock());
    if (late === 'past') {
      ctx.toast({ text: MOVE_PROBLEMS.past });
      return;
    }

    // This and following: one call moves the rest of the series and its rule, all or nothing
    if (choice === 'following') {
      const change = followingMove({ session: s, date, start });
      if (!change) return;
      const result = await sb.rpc('edit_following_sessions', change);
      if (result.error) {
        console.error(result.error);
        ctx.toast({ text: `We couldn’t move those sessions. ${saveErrorText(result.error)}` });
        return;
      }
      ctx.store.invalidate(s.student_id);
      if (String(s.tutor_id) === String(ctx.me.id)) syncSoon();
      ctx.toast({ text: moveToast(Number(result.data) || 1) });
      return;
    }

    const updates = moveUpdates({ session: s, rows, apply: choice, date, start });
    let done = 0;
    let failure = null;
    for (const u of updates) {
      const result = await sb.from('sessions').update(u.fields).eq('id', u.id).select('id');
      if (result.error) {
        console.error(result.error);
        failure = saveErrorText(result.error);
        break;
      }
      if (!result.data?.length) {
        failure = 'It was changed or removed. Refresh the page and try again.';
        break;
      }
      done += 1;
    }
    if (done > 0) {
      ctx.store.invalidate(s.student_id);
      if (String(s.tutor_id) === String(ctx.me.id)) syncSoon();
    }
    if (failure) {
      ctx.toast({ text: done > 0 ? `${done} of ${updates.length} sessions moved. ${failure}` : `We couldn’t move that session. ${failure}` });
      return;
    }
    if (done) ctx.toast({ text: moveToast(done) });
  }

  // A dropped due date saves at once (nothing is announced to families), with Undo
  function moveDue(item, date) {
    moveDueNow(item, date).catch((error) => {
      console.error(error);
      ctx.toast({ text: 'We couldn’t move that due date. Refresh the page and try again.' });
    });
  }

  async function moveDueNow(item, date) {
    const problem = dueMoveProblem(item, date, todayKey(clock()));
    if (problem === 'same') return;
    if (problem) {
      ctx.toast({ text: DUE_PAST });
      return;
    }
    const before = item.task.due_at ?? null;
    const after = dueAtFor(date);
    if (!(await setDue(item, after))) return;
    ctx.toast({
      text: dueToast(date),
      action: {
        label: 'Undo',
        // Only while it is still the date this drop set: a later move wins
        run: async () => {
          if (await setDue(item, before, { from: after })) ctx.toast({ text: 'Due date put back' });
        },
      },
    });
  }

  // from: the due_at the row must still hold (Undo); a row that has moved on
  // since is left alone
  async function setDue(item, dueAt, { from } = {}) {
    let query = sb.from('tasks').update({ due_at: dueAt }).eq('id', item.task.id);
    if (from !== undefined) query = query.eq('due_at', from);
    const result = await query.select('id');
    if (result.error || !result.data?.length) {
      if (result.error) console.error(result.error);
      ctx.toast({ text: from !== undefined && !result.error
        ? 'That due date has changed since, so it was left as it is.'
        : 'We couldn’t move that due date. Refresh the page and try again.' });
      return false;
    }
    ctx.store.invalidate(item.task.student_id);
    return true;
  }

  // Below 768px the week is a list of its days instead of a grid
  function weekList() {
    const wrap = h('div', { class: 'cal-agenda cal-week-list' });
    if (state.status === 'loading') {
      wrap.append(skeletonRows(4));
      return wrap;
    }
    let any = false;
    for (const day of weekDays(state.week, today)) {
      const d = { key: day.key, sessions: state.sessionDays.get(day.key) ?? [], items: state.byDay.get(day.key) ?? [] };
      if (!d.sessions.length && !d.items.length) continue;
      any = true;
      const heading = dayHeading(day.key, today);
      const list = rowList(dayRows(d), { label: heading });
      list.dataset.day = day.key;
      wrap.append(groupHeader({ label: heading, count: d.sessions.length + d.items.length }), list);
    }
    if (!any) wrap.append(emptyState({ icon: 'calendar-blank', text: 'Nothing scheduled or due this week.' }));
    return wrap;
  }

  // ---- Month --------------------------------------------------------------

  function monthLayout() {
    return h('div', { class: 'cal-layout' },
      h('div', { class: 'cal-grid-wrap' }, monthTable()),
      dayPanel());
  }

  // The day that holds the roving tabindex: any of the 42 cells, so an
  // adjacent-month day that was clicked keeps it
  function tabKey() {
    for (const key of [state.focus, state.selected, today]) {
      if (key && inGrid(state.month, key)) return key;
    }
    return `${state.month}-01`;
  }

  // Whatever day gets focus (a click, or a refresh restoring focus) takes the
  // roving tabindex, so Tab out and Shift+Tab back return to it
  function onGridFocus(e) {
    const day = e.target.closest?.('.cal-day');
    if (!day || day.tabIndex === 0) return;
    state.focus = day.dataset.date;
    for (const btn of body.querySelectorAll('button.cal-day[tabindex="0"]')) btn.tabIndex = -1;
    day.tabIndex = 0;
  }

  function monthTable() {
    const cap = state.capacity;
    const loading = state.status === 'loading';
    const cells = monthMatrix(state.month);
    const roving = tabKey();

    const rows = [];
    for (let r = 0; r < 6; r += 1) {
      rows.push(h('tr', {}, cells.slice(r * 7, r * 7 + 7).map((cell) => dayCell(cell, { cap, loading, roving }))));
    }

    const table = h('table', { class: `cal-month cap-${cap}`, 'aria-labelledby': titleId },
      h('thead', {}, h('tr', {}, weekdayHeaders().map((d) => h('th', { scope: 'col', abbr: d.long }, d.short)))),
      h('tbody', {}, rows));

    table.addEventListener('click', onGridClick);
    table.addEventListener('keydown', onGridKey);
    table.addEventListener('focusin', onGridFocus);
    return table;
  }

  function dayCell(cell, { cap, loading, roving }) {
    const { key } = cell;
    const dayItems = state.byDay.get(key) ?? [];
    const daySessions = state.sessionDays.get(key) ?? [];
    const isToday = key === today;
    const selected = key === state.selected;

    let label;
    if (loading) label = isToday ? `${dateWords(key, today)}, today` : dateWords(key, today);
    else label = dayLabel(key, dayItems, today, audience, { sessions: daySessions, whoFor: spokenWho, now: ctx.now });

    const btn = h('button', {
      type: 'button',
      class: 'cal-day',
      tabindex: key === roving ? '0' : '-1',
      'aria-label': label,
      'aria-pressed': selected ? 'true' : 'false',
      'aria-current': isToday ? 'date' : undefined,
      dataset: { date: key, focusKey: `day-${key}` },
    }, numLabel(cell));

    if (!loading && (dayItems.length || daySessions.length)) {
      btn.append(cap > 0 ? chipStack(dayEntries(daySessions, dayItems), cap) : dotRow(daySessions, dayItems));
    }

    const cls = [
      cell.inMonth ? null : 'is-outside',
      cell.isWeekend ? 'is-weekend' : null,
      isToday ? 'is-today' : null,
      cell.inMonth && key < today ? 'is-past' : null,
      selected ? 'is-selected' : null,
    ].filter(Boolean).join(' ');
    return h('td', { class: cls || undefined }, btn);
  }

  // The day number; "Nov 1" gets .is-label so only it widens past the circle
  function numLabel(cell) {
    const text = cellText(cell);
    return h('span', { class: text.includes(' ') ? 'cal-num num is-label' : 'cal-num num' }, text);
  }

  // Sessions first, then due items; both count against the capacity
  function chipStack(entries, cap) {
    const { shown, more } = chipsFor(entries, cap);
    return h('span', { class: 'cal-chips', 'aria-hidden': 'true' },
      shown.map((entry) => (entry.type === 'session' ? sessionChip(entry.session) : dueChip(entry.item))),
      more ? h('span', { class: 'cal-more num' }, moreLabel(more, cap)) : null);
  }

  // A due item. In the month it is a span inside the day button; in the week
  // grid it is a link that opens the drawer.
  function dueChip(item, { link = false } = {}) {
    const { kind, icon: iconName } = chipKind(item, audience);
    const name = item.task.title || 'Untitled';
    const score = item.grade?.score;
    const showScore = staff && kind === 'graded' && score !== null && score !== undefined;
    const props = { class: `cal-chip is-${kind}`, dataset: { taskId: String(item.task.id) } };
    if (link) {
      props.href = drawerHref(currentHash(), item.task.id);
      props['aria-label'] = itemAria(item, audience);
      props.dataset.focusKey = `row-${item.task.id}`;
    } else {
      props.title = item.studentName ? `${name}, ${item.studentName}` : name;
    }
    // The score (floated right), initials and icon sit inline in the title,
    // so a wrapped title's later lines get the chip's full width
    const el = h(link ? 'a' : 'span', props,
      h('span', { class: 'cal-chip-title' },
        showScore ? h('span', { class: 'cal-chip-score' }, String(score)) : null,
        item.studentName ? h('span', { class: 'cal-chip-who' }, initials(item.studentName)) : null,
        icon(iconName, { size: 12 }),
        name));
    if (mayDragDue(item)) {
      dragToDay(el, {
        cellSelector: link ? '.cal-week-due' : '.cal-day',
        label: name,
        valid: (date) => dueMoveProblem(item, date, todayKey(clock())) !== 'past',
        onDrop: (date) => moveDue(item, date),
      });
    }
    return el;
  }

  // A session on a month cell: start time and subject in the subject's tone,
  // struck through when cancelled
  function sessionChip(s) {
    const el = h('span', {
      class: ['cal-chip', 'cal-chip-session', toneClass(s.subject), isCancelled(s) ? 'is-cancelled' : null].filter(Boolean).join(' '),
      title: sessionAria(s, { who: spokenWho(s), now: ctx.now }),
      dataset: { sessionId: String(s.id) },
    },
    h('span', { class: 'cal-chip-title' },
      h('span', { class: 'cal-chip-time num' }, chipTime(s.starts_at)),
      sessionTitle(s)));
    if (mayDragSession(s)) {
      // A day in the month keeps the session's time
      const start = timeInput(s.starts_at);
      dragToDay(el, {
        cellSelector: '.cal-day',
        label: `${chipTime(s.starts_at)} ${sessionTitle(s)}`,
        valid: (date) => !['past', 'overnight'].includes(moveProblem(s, { date, start }, clock())),
        onDrop: (date) => moveSession(s, { date, start }),
      });
    }
    return el;
  }

  function dotRow(daySessions, dayItems) {
    return h('span', { class: 'cal-dots', 'aria-hidden': 'true' },
      dotsForDay(daySessions, dayItems, audience).map((dot) => h('span', {
        class: dot.kind === 'session' ? `cal-dot is-session ${toneClass(dot.session.subject)}` : `cal-dot is-${dot.kind}`,
      })));
  }

  // One listener for the whole grid: a chip opens its drawer (and selects its
  // day, so closing the drawer can return focus to that row); "+N more" and
  // anything else in a cell select the day (never deselect it).
  function onGridClick(e) {
    const day = e.target.closest('.cal-day');
    if (!day) return;
    const key = day.dataset.date;
    const chipEl = e.target.closest('.cal-chip');
    if (chipEl) {
      if (state.selected !== key) select(key);
      if (chipEl.dataset.sessionId) ctx.openSession(chipEl.dataset.sessionId);
      else ctx.open(chipEl.dataset.taskId);
      return;
    }
    select(key);
  }

  function onGridKey(e) {
    const day = e.target.closest('.cal-day');
    if (!day || e.altKey || e.ctrlKey || e.metaKey) return;
    const next = moveKey(day.dataset.date, e.key, { shift: e.shiftKey });
    if (!next) return;
    e.preventDefault();
    state.focus = next;
    if (monthOf(next) !== state.month) {
      showMonth(monthOf(next));
      render();
      focusDay(next);
      return;
    }
    for (const btn of body.querySelectorAll('button.cal-day[tabindex="0"]')) btn.tabIndex = -1;
    const target = body.querySelector(`button.cal-day[data-date="${cssEscape(next)}"]`);
    if (target) {
      target.tabIndex = 0;
      target.focus();
    }
  }

  // ---- Day panel ----------------------------------------------------------

  function panelHeading(label, count) {
    return h('h4', { class: 'cal-panel-day' }, h('span', {}, label),
      h('span', { class: 'cal-panel-count num' }, String(count)));
  }

  function dayPanel() {
    const headId = uid('cal-panel');
    const panel = h('section', { class: 'cal-panel', 'aria-labelledby': headId });
    const loading = state.status === 'loading';

    if (state.selected) {
      const key = state.selected;
      const dayItems = state.byDay.get(key) ?? [];
      const daySessions = state.sessionDays.get(key) ?? [];
      const meta = [
        daySessions.length ? plural(daySessions.length, 'session') : null,
        dayItems.length ? `${dayItems.length} due` : null,
      ].filter(Boolean).join(', ');
      panel.append(h('div', { class: 'cal-panel-head' },
        h('h3', { class: 'cal-panel-title', id: headId }, dateWords(key, today)),
        key === today ? h('span', { class: 'cal-panel-tag' }, 'Today') : null,
        !loading && meta ? h('span', { class: 'cal-panel-meta num' }, meta) : null,
        button({
          label: `Show next ${PANEL_DAYS} days`,
          variant: 'ghost',
          size: 'sm',
          className: 'cal-panel-back',
          focusKey: 'cal-panel-back',
          onClick: clearSelection,
        })));
      if (loading) panel.append(skeletonRows(2));
      else if (daySessions.length || dayItems.length) {
        if (daySessions.length) {
          panel.append(panelHeading('Sessions', daySessions.length), rowList(daySessions.map(sessionRow), { label: 'Sessions' }));
        }
        if (dayItems.length) {
          if (daySessions.length) panel.append(panelHeading('Due', dayItems.length));
          panel.append(rowList(dayItems.map(row), { label: daySessions.length ? 'Due' : dateWords(key, today) }));
        }
      } else {
        panel.append(h('div', { class: 'cal-panel-empty' },
          h('p', {}, 'Nothing scheduled or due this day.'),
          canCreate
            ? h('div', { class: 'cal-panel-actions' },
              button({
                label: 'New session',
                icon: 'plus',
                size: 'sm',
                onClick: () => ctx.openNewSession({ due: key }),
              }),
              button({
                label: `New assignment due ${shortDay(key, today)}`,
                icon: 'plus',
                size: 'sm',
                onClick: () => ctx.openNew({ kind: 'assignment', due: key }),
              }))
            : null));
      }
      return panel;
    }

    panel.append(h('div', { class: 'cal-panel-head' },
      h('h3', { class: 'cal-panel-title', id: headId }, `Next ${PANEL_DAYS} days`)));
    if (loading) {
      panel.append(skeletonRows(3));
      return panel;
    }
    const g = agendaWithSessions(
      agendaGroups(state.items, today, { days: PANEL_DAYS, audience }),
      state.shown, today, { days: PANEL_DAYS });
    if (!g.overdue.length && !g.days.length) {
      panel.append(h('div', { class: 'cal-panel-empty' }, h('p', {}, `Nothing scheduled or due in the next ${PANEL_DAYS} days.`)));
      return panel;
    }
    if (g.overdue.length) {
      panel.append(
        h('h4', { class: 'cal-panel-day is-danger' }, icon('warning-circle'), h('span', {}, 'Overdue'),
          h('span', { class: 'cal-panel-count num' }, String(g.overdue.length))),
        rowList(g.overdue.map(row), { label: 'Overdue' }));
    }
    for (const d of g.days) {
      const dayTitle = dayHeading(d.key, today);
      panel.append(panelHeading(dayTitle, d.sessions.length + d.items.length), rowList(dayRows(d), { label: dayTitle }));
    }
    return panel;
  }

  // ---- List ---------------------------------------------------------------

  function listLayout() {
    const wrap = h('div', { class: 'cal-agenda' });
    if (state.status === 'loading') {
      wrap.append(skeletonRows(5));
      return wrap;
    }
    const g = agendaWithSessions(
      agendaGroups(state.items, today, { days: state.range, audience }),
      state.shown, today, { days: state.range });
    const notes = needsNotes(state.shown, ctx.now, ctx.me, { links: state.links ?? null });
    // A session in "Needs session notes" is not listed again under its day
    const noted = new Set(notes.map((s) => s.id));
    const days = g.days
      .map((d) => ({ ...d, sessions: d.sessions.filter((s) => !noted.has(s.id)) }))
      .filter((d) => d.sessions.length || d.items.length);

    if (g.overdue.length) {
      wrap.append(
        groupHeader({ label: 'Overdue', count: g.overdue.length, tone: 'danger' }),
        rowList(g.overdue.map(row), { label: 'Overdue' }));
    }
    // Finished sessions the tutor has not written up yet; Today links here
    if (notes.length) {
      wrap.append(
        groupHeader({ label: 'Needs session notes', count: notes.length, icon: 'note-pencil' }),
        rowList(notes.map(sessionRow), { label: 'Needs session notes' }));
    }
    for (const d of days) {
      const dayTitle = dayHeading(d.key, today);
      const list = rowList(dayRows(d), { label: dayTitle });
      list.dataset.day = d.key;
      wrap.append(groupHeader({ label: dayTitle, count: d.sessions.length + d.items.length }), list);
    }
    if (!g.overdue.length && !days.length && !notes.length) {
      wrap.append(emptyState({ icon: 'calendar-blank', text: `Nothing scheduled or due in the next ${state.range} days.` }));
    }
    if (g.later) {
      wrap.append(h('div', { class: 'cal-agenda-more' }, button({
        label: 'Show the next 30 days',
        icon: 'caret-down',
        focusKey: 'cal-more-days',
        onClick: () => extendRange(g.end),
      })));
    }
    if (g.undated.length) {
      const details = groupHeader({ label: 'No due date', count: g.undated.length, collapsible: true });
      details.classList.add('cal-undated');
      details.append(rowList(g.undated.map(row), { label: 'No due date' }));
      wrap.append(details);
    }
    return wrap;
  }

  // Extends the list in place and moves focus to the first newly shown row
  function extendRange(oldEnd) {
    state.range += AGENDA_DAYS;
    listRanges.set(rangeKey, state.range);
    render();
    const fresh = [...body.querySelectorAll('ul.row-list[data-day]')].find((ul) => ul.dataset.day > oldEnd);
    const target = fresh?.querySelector('a.row') ?? body.querySelector('[data-focus-key="cal-more-days"]');
    target?.focus();
  }

  // Fades the first rows in, only on a view change (never on a refresh)
  function animateEntry() {
    if (ctx.isRefresh) return;
    const rows = [...body.querySelectorAll('.row-list > li')].slice(0, ENTER_LIMIT);
    rows.forEach((li, i) => {
      li.classList.add('enter');
      li.style.setProperty('--i', String(i));
    });
  }

  // -------------------------------------------------------------------------
  // Width changes move the chip capacity (and the phone dot grid), and the week
  // swaps between its grid and its phone list at 768px. The capacity follows
  // the grid's own width, which also moves with the sidebar and the day panel,
  // so the view watches its body as well as the viewport.

  function syncLayout() {
    const wide = matches('(min-width: 768px)');
    const wrap = body.querySelector('.cal-grid-wrap');
    const cap = capacityForGrid(wrap ? wrap.clientWidth : 0, viewportWidth());
    const changed = state.view === 'month' ? cap !== state.capacity
      : state.view === 'week' ? wide !== state.wide : false;
    state.capacity = cap;
    state.wide = wide;
    if (!changed || state.status === 'error') return;
    const focused = body.contains(document.activeElement) ? document.activeElement.dataset?.focusKey : null;
    render();
    if (focused) body.querySelector(`[data-focus-key="${cssEscape(focused)}"]`)?.focus();
  }

  for (const query of BREAKPOINTS) {
    if (typeof matchMedia !== 'function') break;
    matchMedia(query).addEventListener('change', syncLayout, { signal: ctx.signal });
  }
  if (typeof ResizeObserver === 'function') {
    // Runs after layout and before paint, so a corrected capacity never flashes
    const observer = new ResizeObserver(() => syncLayout());
    observer.observe(body);
    ctx.signal?.addEventListener('abort', () => observer.disconnect(), { once: true });
  }

  const nowTimer = setInterval(updateNow, NOW_TICK_MS);
  ctx.signal?.addEventListener('abort', () => clearInterval(nowTimer), { once: true });

  // -------------------------------------------------------------------------
  // Data

  async function load() {
    if (allScope) {
      const [ws, names] = await Promise.all([ctx.store.getWorkspace(), staffNames()]);
      const studentNames = new Map((ws.students ?? []).map((s) => [String(s.id), displayName(s)]));
      state.tutorNames = names;
      state.studentNames = studentNames;
      state.sessions = (ws.sessions ?? []).map((s) => ({ ...s, studentName: studentNames.get(String(s.student_id)) ?? 'Unknown student' }));
      state.links = ws.links ?? null;
      state.sessionsFailed = Boolean(ws.sessionsError);
      return deriveItems(ws.tasks, ws.submissions, ctx.now, { audience: 'staff' })
        .map((item) => ({ ...item, studentName: studentNames.get(String(item.task.student_id)) ?? 'Unknown student' }));
    }
    const [data, sessions, names] = await Promise.all([
      ctx.store.getStudentData(student.id),
      // Sessions failing must not hide the due dates: show them with a notice
      ctx.store.getSessions(student.id).catch((error) => {
        console.error(error);
        state.sessionsFailed = true;
        return [];
      }),
      staffNames(),
    ]);
    state.tutorNames = names;
    state.sessions = sessions;
    return ctx.store.itemsFor(data, { now: ctx.now, audience, viewerId: ctx.me.id });
  }

  render();

  if (!allScope && !student) {
    body.setAttribute('aria-busy', 'false');
    body.replaceChildren(emptyState({ icon: 'calendar-blank', text: 'Choose a student to see their calendar.' }));
    return Promise.resolve();
  }

  return (async () => {
    try {
      state.items = await load();
    } catch (error) {
      if (!ctx.alive()) return;
      console.error(error);
      state.status = 'error';
      render();
      return;
    }
    if (!ctx.alive()) return;
    state.byDay = itemsByDay(state.items, audience).byDay;
    applyFilter();
    state.status = 'ready';
    if (allScope && ctx.me.role === 'admin') buildFilter();
    render();
    if (state.view === 'list' || (state.view === 'week' && !state.wide)) animateEntry();

    // A family that has looked at the calendar has seen every change to it
    if (!staff && student && markSeen('schedule', ctx.me.id, student.id, ctx.now)) ctx.refreshNav?.();

    if (state.view === 'list') {
      const g = agendaWithSessions(
        agendaGroups(state.items, today, { days: state.range, audience }),
        state.shown, today, { days: state.range });
      const items = g.overdue.length + g.days.reduce((sum, d) => sum + d.items.length, 0);
      const sessions = g.days.reduce((sum, d) => sum + d.sessions.length, 0);
      ctx.announce(`Calendar, ${plural(sessions, 'session')} and ${plural(items, 'item')} in the next ${state.range} days`);
    } else {
      const range = viewRange(state.view, state, today);
      const sessions = sessionsInRange(state.shown, range.start, range.end).length;
      const items = state.view === 'month'
        ? countInMonth(state.byDay, state.month)
        : weekDays(state.week, today).reduce((sum, d) => sum + (state.byDay.get(d.key)?.length ?? 0), 0);
      ctx.announce(`Calendar, ${heading()}, ${plural(sessions, 'session')}, ${plural(items, 'item')}`);
    }
  })();
}

// Gives each segmented button a data-focus-key, so a refresh restores focus
function keyButtons(group, prefix) {
  for (const btn of group.querySelectorAll('button[data-value]')) btn.dataset.focusKey = `${prefix}-${btn.dataset.value}`;
}

// An icon button's accessible name and its tooltip move together
function relabel(btn, text) {
  btn.setAttribute('aria-label', text);
  const tip = btn.querySelector('.tip');
  if (tip) tip.textContent = text;
}
