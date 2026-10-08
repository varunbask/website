// UI helpers: every shared component the views build, as DOM elements.
// Markup and class names follow the COMPONENT CLASS API comment at the top of
// portal/css/app.css (spec sections 5.1 and 6). Text always goes through h(),
// which sets textContent, so database text can never become markup.
//
// Pure pieces (badgeText, initials, avatarSize, rowAside, rowMeta, drawerHref,
// buttonClass) are exported for tests; they never touch the DOM.

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { itemStatus } from './status.js';
import { resultOf, resultLabel } from './results.js';
import { dueLabel, relativeTime, shortDay } from './dates.js';
import { DRAWER_PARAMS } from './router.js';
import { MAX_SUBMISSIONS } from './buckets.js';

// ---------------------------------------------------------------------------
// Pure logic

const VARIANTS = new Set(['primary', 'secondary', 'ghost', 'danger-ghost', 'danger']);
const SIZES = new Set(['sm', 'lg']);

// 'btn btn-primary btn-sm btn-block'
export function buttonClass({ variant = 'secondary', size, block = false } = {}) {
  const parts = ['btn', `btn-${VARIANTS.has(variant) ? variant : 'secondary'}`];
  if (SIZES.has(size)) parts.push(`btn-${size}`);
  if (block) parts.push('btn-block');
  return parts.join(' ');
}

// Badge text: null at zero (a zero badge is never shown), "99+" above 99
export function badgeText(n) {
  const count = Number(n);
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
}

// Up to two initials: first and last word ("Maya Chen" -> "MC", "Maya" -> "M").
// An email falls back to its first letter. Empty input gives "?".
export function initials(name) {
  const clean = String(name ?? '').trim().replace(/@.*$/, '');
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return '?';
  const first = (w) => Array.from(w)[0].toLocaleUpperCase('en-US');
  if (words.length === 1) return first(words[0]);
  return first(words[0]) + first(words[words.length - 1]);
}

const AVATAR_SIZES = [24, 28, 32, 40];

// Snaps a requested size to one the stylesheet has (24, 28, 32, 40)
export function avatarSize(size = 32) {
  const n = Number(size) || 32;
  return AVATAR_SIZES.reduce((best, s) => (Math.abs(s - n) < Math.abs(best - n) ? s : best), 32);
}

// "Just now" -> "just now" after a verb; dates and "5 minutes ago" stay as they are
function afterVerb(text) {
  return text === 'Just now' || text === 'Yesterday' ? text.toLowerCase() : text;
}

function stamped(verb, iso, now) {
  const r = relativeTime(iso, now);
  return { text: `${verb} ${afterVerb(r.text)}`, full: `${verb} ${r.full}`, tone: null, iso };
}

// Graded work: "Graded Oct 5", the same words as the Overview (spec 5.5).
// Staff rows show the bare date beside the result; label keeps "Released
// Oct 5" for the row's accessible name.
function released(iso, now, audience) {
  const day = shortDay(iso, now);
  const verb = audience === 'staff' ? 'Released' : 'Graded';
  return {
    text: audience === 'staff' ? day : `${verb} ${day}`,
    label: `${verb} ${day}`,
    full: `${verb} ${relativeTime(iso, now).full}`,
    tone: null,
    iso,
  };
}

// The row's date column: { text, full, tone, iso, label? } or null (label,
// when set, replaces text in the row's accessible name).
// Open work shows its due label (tone only when soon or overdue); in-review work
// when it was submitted; graded work when it was released; missed work its due date.
export function rowAside(item, now = new Date(), { audience = 'family' } = {}) {
  const { task, latest, grade } = item;
  const due = task.due_at;
  const openDue = () => (due ? { ...dueLabel(due, now), iso: due } : null);

  if (task.kind === 'task') {
    if (item.dueState !== 'done') return openDue();
    return task.completed_at ? stamped('Done', task.completed_at, now) : null;
  }
  switch (item.bucket) {
    case 'in-review':
      return latest?.created_at ? stamped('Submitted', latest.created_at, now) : null;
    case 'graded':
      return grade?.released_at ? released(grade.released_at, now, audience) : null;
    case 'archived':
      if (item.archiveReason === 'graded') {
        return grade?.released_at ? released(grade.released_at, now, audience) : null;
      }
      if (!due) return null;
      // Missed work is always more than 30 days old, so relativeTime gives a date
      return { text: `Due ${relativeTime(due, now).text}`, full: dueLabel(due, now).full, tone: null, iso: due };
    default:
      return openDue();
  }
}

// The row's meta line as a list of parts (joined with ", " by itemRow)
export function rowMeta(item, { showStudent = false, studentName = '', variant } = {}) {
  const parts = [];
  if (showStudent && studentName) parts.push(studentName);
  if (variant === 'mixed') parts.push(item.task.kind === 'task' ? 'Task' : 'Assignment');
  if (item.task.kind !== 'task' && item.bucket === 'in-review') {
    if (item.attempts > 1) parts.push(`Attempt ${item.attempts} of ${MAX_SUBMISSIONS}`);
    if (resultLabel(item.previousResult)) parts.push(`Previous result ${resultLabel(item.previousResult)}`);
  }
  return parts;
}

// The current hash with the drawer opened on a task: '#/assignments/todo?open=12'.
// Other drawer params are dropped; the rest are kept and sorted.
export function drawerHref(hash, taskId) {
  const raw = String(hash ?? '').replace(/^#/, '');
  const q = raw.indexOf('?');
  const path = (q === -1 ? raw : raw.slice(0, q)) || '/';
  const params = new URLSearchParams(q === -1 ? '' : raw.slice(q + 1));
  for (const key of DRAWER_PARAMS) params.delete(key);
  params.set('open', String(taskId));
  params.sort();
  return `#${path}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Small pieces

const isNode = (v) => typeof Node !== 'undefined' && v instanceof Node;

export function visuallyHidden(text) {
  return h('span', { class: 'visually-hidden' }, text);
}

// button({ label, variant, size, icon, type, href, onClick, ariaLabel, focusKey })
// variant: primary | secondary (default) | ghost | danger-ghost | danger
// size: 'sm' (28) | default (36) | 'lg' (44). With href it is an <a>.
export function button({
  label, variant = 'secondary', size, icon: iconName, iconEnd, type = 'button', href, onClick,
  ariaLabel, focusKey, block = false, disabled = false, id, className,
} = {}) {
  const cls = [buttonClass({ variant, size, block }), className].filter(Boolean).join(' ');
  const content = [
    iconName ? icon(iconName) : null,
    h('span', { class: 'btn-label' }, label),
    iconEnd ? icon(iconEnd) : null,
  ];
  const props = {
    class: cls,
    id,
    'aria-label': ariaLabel,
    dataset: focusKey ? { focusKey } : undefined,
    onClick,
  };
  if (href) {
    return h('a', { ...props, href, 'aria-disabled': disabled ? 'true' : undefined }, content);
  }
  return h('button', { ...props, type, disabled }, content);
}

// A 32px icon-only button with an aria-label and a matching tooltip.
// tip: 'bottom' (default) | 'top' | 'right' | 'left' | 'end' | false
export function iconButton({ icon: iconName, label, onClick, tip = 'bottom', id, className, focusKey, type = 'button' } = {}) {
  const el = h('button', {
    type,
    id,
    class: ['icon-btn', tip ? 'has-tip' : null, className].filter(Boolean).join(' '),
    'aria-label': label,
    dataset: focusKey ? { focusKey } : undefined,
    onClick,
  }, icon(iconName));
  if (tip) el.append(tipSpan(label, tip));
  return el;
}

function tipSpan(text, placement = 'bottom') {
  const cls = placement && placement !== 'bottom' ? `tip tip-${placement}` : 'tip';
  return h('span', { class: cls, 'aria-hidden': 'true' }, text);
}

// Runs an async action with the button busy: only the label span changes, the
// width is held so the button does not jump, and everything is restored after.
export async function busy(button, label, action) {
  const target = button.querySelector('.btn-label') ?? button;
  const before = target.textContent;
  const wasDisabled = button.disabled;
  const minWidth = button.style.minWidth;
  const hadFocus = document.activeElement === button;
  const width = button.getBoundingClientRect().width;
  if (width) button.style.minWidth = `${Math.ceil(width)}px`;
  button.setAttribute('aria-busy', 'true');
  if ('disabled' in button) button.disabled = true;
  else button.setAttribute('aria-disabled', 'true');
  if (label) target.textContent = label;
  try {
    return await action();
  } finally {
    target.textContent = before;
    button.removeAttribute('aria-busy');
    if ('disabled' in button) button.disabled = wasDisabled;
    else button.removeAttribute('aria-disabled');
    button.style.minWidth = minWidth;
    if (hadFocus && button.isConnected && (!document.activeElement || document.activeElement === document.body)) {
      button.focus();
    }
  }
}

// A status pill from itemStatus()/submissionStatus(): tone, icon and words
export function pill(status) {
  const cls = ['pill', `tone-${status.tone ?? 'neutral'}`, status.dashed ? 'is-dashed' : null].filter(Boolean).join(' ');
  return h('span', { class: cls }, status.icon ? icon(status.icon, { size: 14 }) : null, h('span', {}, status.label));
}

// "Draft: Completed", the result an unreleased grade holds (staff only);
// null when the draft has no result yet
export function draftChip(grade) {
  const label = resultLabel(resultOf(grade));
  return label ? h('span', { class: 'draft-chip' }, `Draft: ${label}`) : null;
}

// A count badge with hidden context ("4 to do, 1 overdue"); null at zero.
// Also takes a nav-model badge ({ n, text, tone, context }).
export function badge({ n, tone = 'neutral', context } = {}) {
  const text = badgeText(n);
  if (!text) return null;
  return h('span', { class: tone === 'danger' ? 'badge is-danger' : 'badge' },
    h('span', { 'aria-hidden': 'true' }, text),
    visuallyHidden(context || String(n)));
}

export function newPill() {
  return h('span', { class: 'new-pill' }, 'New');
}

// Initials in a rounded square; decorative (the name is always shown beside it)
export function avatar(name, { size = 32, staff = false } = {}) {
  const s = avatarSize(size);
  return h('span', {
    class: ['avatar', `avatar-${s}`, staff ? 'is-staff' : null].filter(Boolean).join(' '),
    'aria-hidden': 'true',
  }, initials(name));
}

// <time datetime title>5 minutes ago</time>
export function timeEl(iso, now = new Date()) {
  if (!iso) return null;
  const value = iso instanceof Date ? iso.toISOString() : String(iso);
  const { text, full } = relativeTime(value, now);
  return h('time', { datetime: value, title: full }, text);
}

// ---------------------------------------------------------------------------
// Rows and groups (spec 5.1)

// One item row: a full-row link to the drawer, wrapped in the <li> a
// ul.row-list expects (rowList() builds the list). Returns the <li>; the link
// is li.firstElementChild and carries data-focus-key="row-<taskId>".
// options:
//   audience     'family' | 'staff' (labels and draft chips)
//   href         link target; default opens the drawer over the current hash
//   showStudent  prefix the meta line with studentName (all-students lists)
//   variant      'mixed' adds "Assignment" or "Task" to the meta line
//   meta         string, array of strings or a Node; replaces the default meta
//   now          the view's clock (default: new Date())
export function itemRow(item, { audience = 'family', href, showStudent = false, studentName = '', variant, meta, now = new Date() } = {}) {
  const { task } = item;
  const status = itemStatus(item, { audience, now });
  const glyph = status.glyph ?? { icon: status.icon, tone: status.tone };
  const aside = rowAside(item, now, { audience });

  let metaContent;
  if (isNode(meta)) metaContent = meta;
  else if (meta !== undefined && meta !== null) metaContent = [].concat(meta).filter(Boolean).join(', ');
  else metaContent = rowMeta(item, { showStudent, studentName, variant }).join(', ');

  const draft = audience === 'staff' && item.bucket === 'in-review' && item.grade && !item.grade.released_at
    ? draftChip(item.grade) : null;

  const metaEl = metaContent || draft
    ? h('span', { class: 'row-meta' }, metaContent || null, draft)
    : null;

  let dueEl = null;
  if (aside) {
    const toneClass = aside.tone === 'danger' ? 'is-danger' : aside.tone === 'warning' ? 'is-warning' : null;
    dueEl = h('span', { class: ['row-due', 'num', toneClass].filter(Boolean).join(' '), title: aside.full }, aside.text);
  }

  // Spell the row out for screen readers: the cells would otherwise run together.
  // A meta line that is a sentence loses its final period so the parts join
  // cleanly ("number line, Due Friday", not "number line., Due Friday").
  const metaText = isNode(metaContent) ? metaContent.textContent : metaContent;
  const label = [
    task.title || 'Untitled',
    labelPart(metaText),
    draft ? draft.textContent : null,
    aside ? (aside.label ?? aside.text) : null,
    status.label,
  ].filter(Boolean).join(', ');

  const link = h('a', {
    class: ['row', status.struck ? 'is-done' : null].filter(Boolean).join(' '),
    'aria-label': label,
    href: href ?? drawerHref(typeof location === 'undefined' ? '' : location.hash, task.id),
    dataset: { focusKey: `row-${task.id}`, taskId: String(task.id) },
  },
  h('span', { class: `row-lead tone-${glyph.tone ?? 'neutral'}` }, icon(glyph.icon)),
  h('span', { class: 'row-main' },
    h('span', { class: 'row-title' }, task.title || 'Untitled'),
    metaEl),
  h('span', { class: 'row-aside' },
    dueEl,
    h('span', { class: 'row-status' }, pill(status))),
  icon('caret-right'));
  link.lastChild.classList.add('row-caret');
  return h('li', {}, link);
}

// One part of a row's accessible name: trimmed, without a closing period
export function labelPart(text) {
  return String(text ?? '').trim().replace(/\.+$/, '').trim();
}

// ul.row-list around <li> rows (itemRow output or any li > a.row).
// lead: 24 or 32 when the leading cell is an avatar.
export function rowList(rows, { lead, label } = {}) {
  const cls = ['row-list', lead === 24 || lead === 32 ? `lead-${lead}` : null].filter(Boolean).join(' ');
  return h('ul', { class: cls, 'aria-label': label }, rows);
}

// A sticky group header. Returns div.group-header, or with collapsible a
// closed details.group whose summary is the header: append the list to it.
// tone 'danger' gives danger text and a warning-circle icon (the Overdue group).
export function groupHeader({ label, count, tone, icon: iconName, collapsible = false, open = false, level = 2 } = {}) {
  const glyphName = iconName ?? (tone === 'danger' ? 'warning-circle' : null);
  const cls = ['group-header', tone === 'danger' ? 'is-danger' : null].filter(Boolean).join(' ');
  const countEl = count === undefined || count === null ? null : h('span', { class: 'group-count num' }, String(count));
  if (collapsible) {
    const caret = icon('caret-right');
    caret.classList.add('group-caret');
    return h('details', { class: 'group', open },
      h('summary', { class: cls }, caret, glyphName ? icon(glyphName) : null,
        h('span', { class: 'group-title' }, label), countEl));
  }
  return h('div', { class: cls },
    glyphName ? icon(glyphName) : null,
    h(`h${Math.min(Math.max(level, 2), 6)}`, { class: 'group-title' }, label),
    countEl);
}

// ---------------------------------------------------------------------------
// States (spec 5.1)

function actionNode(action) {
  if (!action) return null;
  if (isNode(action)) return action;
  return button({ variant: 'secondary', ...action });
}

// Dashed box, icon square, one sentence, one optional action
// (a Node, or button() options such as { label, href } or { label, onClick }).
export function emptyState({ icon: iconName = 'info', text, action } = {}) {
  return h('div', { class: 'empty-state' },
    h('span', { class: 'empty-icon' }, icon(iconName, { size: 20 })),
    h('p', { class: 'empty-text' }, text),
    actionNode(action));
}

// role="alert" callout with a "Try again" button
export function errorCallout({ title = 'We couldn’t load this.', text = 'Check your connection and try again.', onRetry, retryLabel = 'Try again' } = {}) {
  const callIcon = icon('warning-circle', { size: 20 });
  callIcon.classList.add('callout-icon');
  return h('div', { class: 'callout tone-danger', role: 'alert' },
    callIcon,
    h('div', { class: 'callout-body' },
      h('p', { class: 'callout-title' }, title),
      text ? h('p', { class: 'callout-text' }, text) : null,
      onRetry
        ? h('div', { class: 'callout-actions' }, button({ label: retryLabel, size: 'sm', icon: 'arrow-counter-clockwise', onClick: onRetry }))
        : null));
}

// Skeleton rows shaped like item rows, with a hidden "Loading…"
export function skeletonRows(n = 4) {
  const rows = Array.from({ length: Math.max(1, n) }, () => h('div', { class: 'skeleton-row', 'aria-hidden': 'true' },
    h('span', { class: 'skeleton sk-glyph' }),
    h('span', { class: 'sk-lines' },
      h('span', { class: 'skeleton sk-line' }),
      h('span', { class: 'skeleton sk-line is-short' })),
    h('span', { class: 'skeleton sk-pill' })));
  return h('div', { class: 'skeleton-rows', 'aria-busy': 'true' }, rows, visuallyHidden('Loading…'));
}

// ---------------------------------------------------------------------------
// Controls

// Segmented control for views of the same data. options: [{ value, label, icon }].
// onChange(value) fires only when the choice changes. setSegmented(el, value)
// moves the selection without firing.
export function segmented({ label, options = [], value, onChange, block = false, className } = {}) {
  const group = h('div', {
    class: ['segmented', block ? 'is-block' : null, className].filter(Boolean).join(' '),
    role: 'group',
    'aria-label': label,
  });
  for (const opt of options) {
    const btn = h('button', {
      type: 'button',
      'aria-pressed': String(opt.value) === String(value) ? 'true' : 'false',
      dataset: { value: String(opt.value) },
      onClick: () => {
        if (btn.getAttribute('aria-pressed') === 'true') return;
        setSegmented(group, opt.value);
        onChange?.(opt.value);
      },
    }, opt.icon ? icon(opt.icon) : null, h('span', {}, opt.label));
    group.append(btn);
  }
  return group;
}

export function setSegmented(group, value) {
  for (const btn of group.querySelectorAll(':scope > button[data-value]')) {
    btn.setAttribute('aria-pressed', btn.dataset.value === String(value) ? 'true' : 'false');
  }
}

// Link tabs (spec 3.8). items: [{ label, href, current, count, context }].
// subnav: the Assignments sub-tabs, hidden while the sidebar shows the sub-items.
export function linkTabs(items, { label = 'Sections', subnav = false } = {}) {
  return h('nav', { class: subnav ? 'tabs is-subnav' : 'tabs', 'aria-label': label },
    items.map((it) => {
      const count = badgeText(it.count);
      return h('a', { class: 'tab', href: it.href, 'aria-current': it.current ? 'page' : undefined },
        it.label,
        count ? h('span', { class: 'tab-count num', 'aria-hidden': it.context ? 'true' : undefined }, count) : null,
        count && it.context ? visuallyHidden(it.context) : null);
    }));
}

// A native select in the .select wrapper with a caret. options: strings or
// [{ value, label, disabled }]. `label` becomes aria-label for a select used
// without field(); inside field() leave it out.
export function select({ label, options = [], value, name, id, size, onChange, required = false, disabled = false } = {}) {
  const sel = h('select', { id, name, 'aria-label': label, required, disabled, onChange: onChange ? (e) => onChange(e.target.value, e) : undefined },
    options.map((o) => {
      const opt = typeof o === 'object' && o !== null ? o : { value: o, label: String(o) };
      return h('option', { value: String(opt.value), disabled: opt.disabled }, opt.label);
    }));
  if (value !== undefined && value !== null) sel.value = String(value);
  return h('span', { class: size === 'sm' ? 'select is-sm' : 'select' }, sel, icon('caret-down'));
}

function controlOf(control) {
  if (control.matches?.('input, select, textarea')) return control;
  return control.querySelector?.('input, select, textarea') ?? control;
}

// Label above, optional hint, error linked by aria-describedby.
// control: an input, textarea, select() wrapper or .input-icon wrapper.
export function field({ label, hint, optional = false, control, error } = {}) {
  const target = controlOf(control);
  if (!target.id) target.id = uid('field');
  const hintEl = hint ? h('p', { class: 'field-hint', id: `${target.id}-hint` }, hint) : null;
  const wrap = h('div', { class: 'field' },
    h('label', { class: 'field-label', for: target.id }, label, optional ? h('span', { class: 'field-optional' }, 'Optional') : null),
    control,
    hintEl);
  describe(target);
  if (error) setFieldError(wrap, error);
  return wrap;
}

function describe(target) {
  const wrap = target.closest('.field');
  const ids = [`${target.id}-hint`, `${target.id}-error`].filter((x) => wrap?.querySelector(`[id="${x}"]`));
  if (ids.length) target.setAttribute('aria-describedby', ids.join(' '));
  else target.removeAttribute('aria-describedby');
}

// Shows or clears (empty text) a field's error message
export function setFieldError(fieldEl, text) {
  const target = controlOf(fieldEl.querySelector('input, select, textarea') ?? fieldEl);
  fieldEl.querySelector(':scope > .field-error')?.remove();
  if (text) {
    fieldEl.append(h('p', { class: 'field-error', id: `${target.id}-error`, role: 'alert' }, icon('warning-circle'), h('span', {}, text)));
    target.setAttribute('aria-invalid', 'true');
  } else {
    target.removeAttribute('aria-invalid');
  }
  describe(target);
}
