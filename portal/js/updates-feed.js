// Updates from tutors to a student's family (spec 5.12): the shared data
// helpers and the feed item, used by the Updates view and the Overviews.
// Markup and classes (upd-) are styled in portal/css/updates.css.
//
//   staffNames()                        Map of tutor and admin ids to names, loaded once
//   loadUpdates(studentId)              newest first; RLS decides what comes back
//   updateItem(update, names, opts)     one li.upd-item
//   updateList(items, { compact, label })  the ul.upd-feed around them
//
// Overviews: updateList(updates.slice(0, 2).map((u) => updateItem(u, names,
// { compact: true, now }))). Staff add showAudience and studentFirstName.

import { sb } from './supabase.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { avatar, timeEl, pill, newPill } from './ui.js';
import { menu } from './overlays.js';
import { relativeTime } from './dates.js';

// Names of tutors and admins by id, for "from" lines. Loaded once per page.
// Never rejects: a failed load gives an empty map and is tried again next time.
let namesPromise = null;
export function staffNames() {
  if (!namesPromise) {
    const promise = sb.rpc('staff_names')
      .then(({ data, error }) => {
        if (error) throw error;
        return new Map((data ?? []).map((row) => [String(row.id), row.full_name]));
      })
      .catch(() => {
        if (namesPromise === promise) namesPromise = null;
        return new Map();
      });
    namesPromise = promise;
  }
  return namesPromise;
}

// The database decides what comes back: staff and parents get every update, a student only shared ones
export async function loadUpdates(studentId) {
  const { data, error } = await sb.from('updates')
    .select('id, author_id, body, visible_to_student, created_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

function authorOf(update, names) {
  const name = names?.get?.(String(update.author_id));
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

// Staff only: who can read this update
function audienceStatus(update, studentFirstName) {
  if (update.visible_to_student) {
    return { tone: 'neutral', icon: 'eye', label: `Shared with ${studentFirstName || 'the student'}` };
  }
  return { tone: 'neutral', icon: 'eye-slash', label: 'Family only' };
}

// A 32px avatar (28 when compact) in the staff tint; an unknown author gets a
// chat glyph instead of made-up initials
function authorAvatar(name, size) {
  if (name) return avatar(name, { size, staff: true });
  return h('span', { class: `avatar avatar-${size} is-staff`, 'aria-hidden': 'true' }, icon('chat-circle-text'));
}

// One update. Options:
//   showAudience      staff: a "Family only" or "Shared with Maya" pill
//   studentFirstName  the name in that pill
//   onDelete          adds a dots-three menu with "Delete" (authors and admins)
//   compact           Overview cards: 28px avatar, body clamped to 3 lines
//   isNew             families: a "New" pill (seen.js decides)
//   now               the view's clock for relative times
//   staff             staff reader (defaults to showAudience): an unnamed author
//                     reads "A tutor" instead of the family's "Your tutor"
export function updateItem(update, names, {
  showAudience = false, onDelete = null, compact = false, studentFirstName = null, isNew = false, now = new Date(),
  staff = showAudience,
} = {}) {
  const author = authorOf(update, names);
  const size = compact ? 28 : 32;

  const time = timeEl(update.created_at, now);
  time?.classList.add('upd-time', 'num');

  const head = h('div', { class: 'upd-head' },
    h('span', { class: 'upd-author' }, author || (staff ? 'A tutor' : 'Your tutor')),
    time,
    showAudience || isNew
      ? h('span', { class: 'upd-tags' },
        showAudience ? pill(audienceStatus(update, studentFirstName)) : null,
        isNew ? newPill() : null)
      : null);

  let actions = null;
  if (typeof onDelete === 'function') {
    const when = update.created_at ? relativeTime(update.created_at, now).full : null;
    actions = menu({
      label: when ? `Actions for the update from ${when}` : 'Actions for this update',
      items: [{ label: 'Delete', icon: 'trash', tone: 'danger', onSelect: onDelete }],
    });
    actions.classList.add('upd-actions');
    const trigger = actions.querySelector('[aria-haspopup="menu"]');
    if (trigger) trigger.dataset.focusKey = `upd-${update.id}`;
  }

  return h('li', {
    class: compact ? 'upd-item is-compact' : 'upd-item',
    dataset: { updateId: String(update.id) },
  },
  authorAvatar(author, size),
  h('div', { class: 'upd-main' },
    h('div', { class: 'upd-top' }, head, actions),
    h('p', { class: 'upd-body' }, update.body ?? '')));
}

// The list around updateItem()s: hairlines between items, nothing around them
export function updateList(items, { compact = false, label } = {}) {
  return h('ul', { class: compact ? 'upd-feed is-compact' : 'upd-feed', 'aria-label': label }, items);
}
