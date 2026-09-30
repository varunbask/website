// Calendar (spec 5.10): a month grid with chips and a day panel, or an agenda
// list. One route serves families, staff with a selected student and staff
// looking at every student (scope=all). View, month and day live in the hash
// and change with replaceState, so this view re-renders itself in place;
// switching between one student and all students pushes and remounts.
//
// All pure decisions (matrix, chips, keyboard, labels, agenda) live in
// calendar-model.js. Everything renders inside ctx.host.

import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import {
  itemRow, rowList, groupHeader, emptyState, errorCallout, skeletonRows,
  segmented, iconButton, button, initials,
} from '../ui.js';
import { deriveItems } from '../buckets.js';
import { todayKey, monthTitle, dayHeading } from '../dates.js';
import { displayName } from '../format.js';
import {
  AGENDA_DAYS, PANEL_DAYS,
  monthOf, monthMatrix, shiftMonth, weekdayHeaders, cellText,
  itemsByDay, moveKey, capacityFor, chipsFor, moreLabel, chipKind, dotsFor,
  dayLabel, dateWords, shortDay, agendaGroups, resolveState, countInMonth, inGrid,
} from '../calendar-model.js';

const STORE_KEY = 'vb-cal-view';
const BREAKPOINTS = ['(min-width: 768px)', '(min-width: 1024px)', '(min-width: 1280px)'];
const ENTER_LIMIT = 8;

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

  const state = {
    ...resolveState(ctx.route.params ?? {}, { today, wide: matches('(min-width: 768px)'), stored: readStoredView() }),
    focus: null,          // roving day in the month grid (keyboard), may differ from selected
    range: listRanges.get(rangeKey) ?? AGENDA_DAYS, // list view days, extended 30 at a time
    status: 'loading',    // 'loading' | 'ready' | 'error'
    items: [],
    byDay: new Map(),
    capacity: capacityFor(viewportWidth()),
  };

  ctx.setHeader({
    title: 'Calendar',
    lede: allScope ? 'Every student’s due dates in one place.' : null,
  });

  // -------------------------------------------------------------------------
  // Toolbar: month title, previous / next / Today, scope and layout controls

  const titleId = uid('cal-title');
  const title = h('h2', { class: 'cal-title', id: titleId, 'aria-live': 'polite' });

  const prevBtn = iconButton({ icon: 'caret-left', label: 'Previous month', focusKey: 'cal-prev', onClick: () => goMonth(-1) });
  const nextBtn = iconButton({ icon: 'caret-right', label: 'Next month', focusKey: 'cal-next', onClick: () => goMonth(1) });
  const todayBtn = button({ label: 'Today', size: 'sm', className: 'cal-today', focusKey: 'cal-today', onClick: goToday });
  const navGroup = h('div', { class: 'cal-nav' }, todayBtn, h('div', { class: 'cal-steps' }, prevBtn, nextBtn));

  const viewSeg = segmented({
    label: 'Calendar layout',
    options: [{ value: 'month', label: 'Month' }, { value: 'list', label: 'List' }],
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
      onChange: (v) => ctx.setParams({ scope: v === 'all' ? 'all' : null }),
      className: 'cal-seg',
    });
    keyButtons(scopeSeg, 'cal-scope');
  }

  const toolbar = h('div', { class: 'cal-toolbar' },
    h('div', { class: 'cal-toolbar-main' }, title, navGroup),
    h('div', { class: 'cal-toolbar-controls' }, scopeSeg, viewSeg));

  const body = h('div', { class: 'cal-body' });
  host.append(toolbar, body);

  // -------------------------------------------------------------------------
  // State changes

  function setParams(params) {
    ctx.setParams(params, { replace: true });
  }

  function setView(view) {
    state.view = view;
    storeView(view);
    setParams({ view });
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
    state.selected = today;
    state.focus = today;
    setParams({ m: state.month, d: today });
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

  // -------------------------------------------------------------------------
  // Rendering

  function render() {
    // Only a real change reaches the live region (a new text node re-announces)
    const heading = state.view === 'month' ? monthTitle(state.month) : `Next ${state.range} days`;
    if (title.textContent !== heading) title.textContent = heading;
    navGroup.hidden = state.view !== 'month';
    const prevLabel = `Previous month, ${monthTitle(shiftMonth(state.month, -1))}`;
    const nextLabel = `Next month, ${monthTitle(shiftMonth(state.month, 1))}`;
    relabel(prevBtn, prevLabel);
    relabel(nextBtn, nextLabel);
    host.classList.toggle('cal-is-list', state.view === 'list');

    body.setAttribute('aria-busy', state.status === 'loading' ? 'true' : 'false');
    if (state.status === 'error') {
      body.replaceChildren(errorCallout({
        title: 'We couldn’t load the calendar.',
        text: 'Check your connection and try again.',
        onRetry: () => ctx.store.invalidate(allScope ? null : student?.id ?? null),
      }));
      return;
    }
    body.replaceChildren(state.view === 'month' ? monthLayout() : listLayout());
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
    const isToday = key === today;
    const selected = key === state.selected;

    let label;
    if (loading) label = isToday ? `${dateWords(key, today)}, today` : dateWords(key, today);
    else label = dayLabel(key, dayItems, today, audience);

    const btn = h('button', {
      type: 'button',
      class: 'cal-day',
      tabindex: key === roving ? '0' : '-1',
      'aria-label': label,
      'aria-pressed': selected ? 'true' : 'false',
      'aria-current': isToday ? 'date' : undefined,
      dataset: { date: key, focusKey: `day-${key}` },
    }, numLabel(cell));

    if (!loading && dayItems.length) btn.append(cap > 0 ? chipStack(dayItems, cap) : dotRow(dayItems));

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

  function chipStack(dayItems, cap) {
    const { shown, more } = chipsFor(dayItems, cap);
    return h('span', { class: 'cal-chips', 'aria-hidden': 'true' },
      shown.map(chip),
      more ? h('span', { class: 'cal-more num' }, moreLabel(more, cap)) : null);
  }

  function chip(item) {
    const { kind, icon: iconName } = chipKind(item, audience);
    const name = item.task.title || 'Untitled';
    const score = item.grade?.score;
    const showScore = staff && kind === 'graded' && score !== null && score !== undefined;
    return h('span', {
      class: `cal-chip is-${kind}`,
      title: item.studentName ? `${name}, ${item.studentName}` : name,
      dataset: { taskId: String(item.task.id) },
    },
    item.studentName ? h('span', { class: 'cal-chip-who' }, initials(item.studentName)) : null,
    icon(iconName, { size: 12 }),
    h('span', { class: 'cal-chip-title' }, name),
    showScore ? h('span', { class: 'cal-chip-score' }, String(score)) : null);
  }

  function dotRow(dayItems) {
    return h('span', { class: 'cal-dots', 'aria-hidden': 'true' },
      dotsFor(dayItems, audience).map((kind) => h('span', { class: `cal-dot is-${kind}` })));
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
      ctx.open(chipEl.dataset.taskId);
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

  function row(item) {
    return itemRow(item, {
      audience,
      now: ctx.now,
      variant: 'mixed',
      showStudent: Boolean(item.studentName),
      studentName: item.studentName ?? '',
    });
  }

  function dayPanel() {
    const headId = uid('cal-panel');
    const panel = h('section', { class: 'cal-panel', 'aria-labelledby': headId });
    const loading = state.status === 'loading';

    if (state.selected) {
      const key = state.selected;
      const dayItems = state.byDay.get(key) ?? [];
      panel.append(h('div', { class: 'cal-panel-head' },
        h('h3', { class: 'cal-panel-title', id: headId }, dateWords(key, today)),
        key === today ? h('span', { class: 'cal-panel-tag' }, 'Today') : null,
        !loading && dayItems.length ? h('span', { class: 'cal-panel-meta num' }, plural(dayItems.length, 'item')) : null,
        button({
          label: `Show next ${PANEL_DAYS} days`,
          variant: 'ghost',
          size: 'sm',
          className: 'cal-panel-back',
          focusKey: 'cal-panel-back',
          onClick: clearSelection,
        })));
      if (loading) panel.append(skeletonRows(2));
      else if (dayItems.length) panel.append(rowList(dayItems.map(row), { label: dateWords(key, today) }));
      else {
        panel.append(h('div', { class: 'cal-panel-empty' },
          h('p', {}, 'Nothing due this day.'),
          canCreate ? button({
            label: `New assignment due ${shortDay(key, today)}`,
            icon: 'plus',
            size: 'sm',
            onClick: () => ctx.openNew({ kind: 'assignment', due: key }),
          }) : null));
      }
      return panel;
    }

    panel.append(h('div', { class: 'cal-panel-head' },
      h('h3', { class: 'cal-panel-title', id: headId }, `Next ${PANEL_DAYS} days`)));
    if (loading) {
      panel.append(skeletonRows(3));
      return panel;
    }
    const g = agendaGroups(state.items, today, { days: PANEL_DAYS, audience });
    if (!g.overdue.length && !g.days.length) {
      panel.append(h('div', { class: 'cal-panel-empty' }, h('p', {}, `Nothing due in the next ${PANEL_DAYS} days.`)));
      return panel;
    }
    if (g.overdue.length) {
      panel.append(
        h('h4', { class: 'cal-panel-day is-danger' }, icon('warning-circle'), h('span', {}, 'Overdue'),
          h('span', { class: 'cal-panel-count num' }, String(g.overdue.length))),
        rowList(g.overdue.map(row), { label: 'Overdue' }));
    }
    for (const d of g.days) {
      const heading = dayHeading(d.key, today);
      panel.append(
        h('h4', { class: 'cal-panel-day' }, h('span', {}, heading),
          h('span', { class: 'cal-panel-count num' }, String(d.items.length))),
        rowList(d.items.map(row), { label: heading }));
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
    const g = agendaGroups(state.items, today, { days: state.range, audience });

    if (g.overdue.length) {
      wrap.append(
        groupHeader({ label: 'Overdue', count: g.overdue.length, tone: 'danger' }),
        rowList(g.overdue.map(row), { label: 'Overdue' }));
    }
    for (const d of g.days) {
      const heading = dayHeading(d.key, today);
      const list = rowList(d.items.map(row), { label: heading });
      list.dataset.day = d.key;
      wrap.append(groupHeader({ label: heading, count: d.items.length }), list);
    }
    if (!g.overdue.length && !g.days.length) {
      wrap.append(emptyState({ icon: 'calendar-blank', text: `Nothing due in the next ${state.range} days.` }));
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
  // Width changes move the chip capacity (and the phone dot grid)

  for (const query of BREAKPOINTS) {
    if (typeof matchMedia !== 'function') break;
    matchMedia(query).addEventListener('change', () => {
      const cap = capacityFor(viewportWidth());
      if (cap === state.capacity) return;
      state.capacity = cap;
      if (state.view !== 'month' || state.status === 'error') return;
      const focused = body.contains(document.activeElement) ? document.activeElement.dataset?.focusKey : null;
      render();
      if (focused) body.querySelector(`[data-focus-key="${cssEscape(focused)}"]`)?.focus();
    }, { signal: ctx.signal });
  }

  // -------------------------------------------------------------------------
  // Data

  async function load() {
    if (allScope) {
      const ws = await ctx.store.getWorkspace();
      const names = new Map((ws.students ?? []).map((s) => [String(s.id), displayName(s)]));
      return deriveItems(ws.tasks, ws.submissions, ctx.now, { audience: 'staff' })
        .map((item) => ({ ...item, studentName: names.get(String(item.task.student_id)) ?? 'Unknown student' }));
    }
    const data = await ctx.store.getStudentData(student.id);
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
    state.status = 'ready';
    render();
    if (state.view === 'list') animateEntry();

    if (state.view === 'month') {
      const n = countInMonth(state.byDay, state.month);
      ctx.announce(`Calendar, ${monthTitle(state.month)}, ${plural(n, 'item')}`);
    } else {
      const g = agendaGroups(state.items, today, { days: state.range, audience });
      const n = g.overdue.length + g.days.reduce((sum, d) => sum + d.items.length, 0);
      ctx.announce(`Calendar, ${plural(n, 'item')} in the next ${state.range} days`);
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
