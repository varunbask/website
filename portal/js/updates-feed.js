import { sb } from './supabase.js';
import { h } from './dom.js';
import { formatDateTime } from './format.js';

// Names of tutors and admins by id, for "from" lines. Loaded once per page.
let namesPromise = null;
export function staffNames() {
  namesPromise ??= sb.rpc('staff_names')
    .then(({ data }) => new Map((data ?? []).map((row) => [row.id, row.full_name])));
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

export function updateItem(update, names, { showAudience = false, onDelete = null } = {}) {
  const meta = [formatDateTime(update.created_at), `from ${names.get(update.author_id) || 'your tutor'}`];
  if (showAudience) meta.push(update.visible_to_student ? 'shared with the student' : 'parents only');
  return h('li', {},
    h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('span', { class: 'meta' }, meta.join(' · ')),
        h('p', { class: 'details' }, update.body)),
      onDelete
        ? h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'link-button', onclick: onDelete }, 'Delete'))
        : null));
}
