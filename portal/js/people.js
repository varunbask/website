import { sb } from './supabase.js';
import { requireRole, mountHeader } from './session.js';
import { h, clear, showMessage, section } from './dom.js';
import { formatDate, displayName } from './format.js';

const ROLE_LABELS = { pending: 'Waiting', student: 'Student', parent: 'Parent', tutor: 'Tutor', admin: 'Admin' };
const lower = (role) => ROLE_LABELS[role].toLowerCase();

const me = await requireRole(['admin']);
mountHeader(me);

const root = document.getElementById('people');
const message = document.getElementById('people-message');
const byName = (a, b) => displayName(a).localeCompare(displayName(b));
const byCreated = (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at);

async function load() {
  const [people, tutorLinks, parentLinks] = await Promise.all([
    sb.from('profiles').select('id, email, full_name, role, requested_role, signup_note, created_at'),
    sb.from('tutor_students').select('tutor_id, student_id'),
    sb.from('parent_students').select('parent_id, student_id'),
  ]);
  for (const result of [people, tutorLinks, parentLinks]) if (result.error) throw result.error;
  return {
    people: people.data,
    byId: new Map(people.data.map((p) => [p.id, p])),
    tutorLinks: tutorLinks.data,
    parentLinks: parentLinks.data,
  };
}

// Runs a write, reports the result, and redraws the page
async function act(request, successText) {
  const { error } = await request;
  if (error) {
    showMessage(message, `That did not save: ${error.message}`);
    return;
  }
  showMessage(message, successText, 'success');
  await render();
}

function roleSelect(person) {
  const select = h('select', {
    class: 'inline',
    'aria-label': `Role for ${displayName(person)}`,
    disabled: person.id === me.id,
  }, Object.entries(ROLE_LABELS).map(([value, label]) => h('option', { value, selected: value === person.role }, label)));
  select.addEventListener('change', () => {
    const role = select.value;
    if (!confirm(`Change ${displayName(person)} to ${lower(role)}? Their access changes right away.`)) {
      select.value = person.role;
      return;
    }
    act(sb.from('profiles').update({ role }).eq('id', person.id), `${displayName(person)} is now ${lower(role)}.`);
  });
  return select;
}

function pendingRow(person) {
  const choice = h('select', { class: 'inline', 'aria-label': `Approve ${displayName(person)} as` },
    ['student', 'parent', 'tutor', 'admin'].map((role) =>
      h('option', { value: role, selected: role === (person.requested_role ?? 'student') }, ROLE_LABELS[role])));
  const approve = h('button', { type: 'button', class: 'btn btn-primary btn-small' }, 'Approve');
  approve.addEventListener('click', () => {
    const role = choice.value;
    if (role === 'admin' && !confirm(`Make ${displayName(person)} an admin? Admins can see and change everything.`)) return;
    act(sb.from('profiles').update({ role }).eq('id', person.id),
      `Approved ${displayName(person)} as ${lower(role)}. Connect them to a student below.`);
  });
  const asked = person.requested_role ? `asked to join as ${lower(person.requested_role)}` : 'no role requested';
  return h('li', {},
    h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('span', { class: 'row-title' }, displayName(person)),
        h('span', { class: 'meta' }, [person.email, `signed up ${formatDate(person.created_at)}`, asked].join(' · ')),
        person.signup_note ? h('p', { class: 'note' }, `"${person.signup_note}"`) : null),
      h('div', { class: 'row-actions' }, choice, approve)));
}

// The people linked to a student in one role, with remove buttons and a picker to add another
function linkGroup(label, linked, candidates, { add, remove }) {
  const linkedIds = new Set(linked.map((p) => p.id));
  const available = candidates.filter((p) => !linkedIds.has(p.id)).sort(byName);
  const picker = available.length
    ? h('select', { class: 'inline', 'aria-label': `Add to ${label.toLowerCase()}` },
        h('option', { value: '' }, label === 'Tutors' ? 'Add a tutor' : 'Add a parent'),
        available.map((p) => h('option', { value: p.id }, displayName(p))))
    : null;
  picker?.addEventListener('change', () => {
    if (picker.value) add(picker.value);
  });
  return h('div', { class: 'links' },
    h('span', { class: 'links-label' }, label),
    linked.length
      ? h('ul', { class: 'link-list' }, [...linked].sort(byName).map((p) => h('li', {},
          displayName(p),
          h('button', { type: 'button', class: 'remove', 'aria-label': `Remove ${displayName(p)}`, onclick: () => remove(p.id) }, '×'))))
      : h('span', { class: 'meta' }, 'None yet'),
    picker);
}

function studentRow(student, data, tutors, parents) {
  const linked = (links, key) => links
    .filter((l) => l.student_id === student.id)
    .map((l) => data.byId.get(l[key]))
    .filter(Boolean);
  const name = (id) => displayName(data.byId.get(id));
  return h('li', {},
    h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('span', { class: 'row-title' }, displayName(student)),
        h('span', { class: 'meta' }, student.email ?? '')),
      h('div', { class: 'row-actions' },
        h('a', { class: 'link-button', href: `/portal/staff.html?student=${encodeURIComponent(student.id)}` }, 'Open workspace'),
        roleSelect(student)),
      linkGroup('Tutors', linked(data.tutorLinks, 'tutor_id'), tutors, {
        add: (id) => act(sb.from('tutor_students').insert({ tutor_id: id, student_id: student.id }),
          `Assigned ${name(id)} to ${displayName(student)}.`),
        remove: (id) => act(sb.from('tutor_students').delete().eq('tutor_id', id).eq('student_id', student.id),
          `Removed ${name(id)} from ${displayName(student)}.`),
      }),
      linkGroup('Parents', linked(data.parentLinks, 'parent_id'), parents, {
        add: (id) => act(sb.from('parent_students').insert({ parent_id: id, student_id: student.id }),
          `Linked ${name(id)} to ${displayName(student)}.`),
        remove: (id) => act(sb.from('parent_students').delete().eq('parent_id', id).eq('student_id', student.id),
          `Unlinked ${name(id)} from ${displayName(student)}.`),
      })));
}

function personRow(person, detail) {
  return h('li', {},
    h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('span', { class: 'row-title' }, displayName(person)),
        h('span', { class: 'meta' }, [person.email, detail].filter(Boolean).join(' · '))),
      h('div', { class: 'row-actions' }, roleSelect(person))));
}

async function render() {
  let data;
  try {
    data = await load();
  } catch (err) {
    showMessage(message, `People could not be loaded: ${err.message}`);
    return;
  }
  const group = (role) => data.people.filter((p) => p.role === role).sort(byName);
  const tutors = group('tutor');
  const parents = group('parent');
  const names = (ids) => ids.map((id) => displayName(data.byId.get(id))).join(', ') || 'none';
  clear(root).append(
    section('Waiting for approval', data.people.filter((p) => p.role === 'pending').sort(byCreated), pendingRow,
      'Nobody is waiting.', { count: true }),
    section('Students', group('student'), (s) => studentRow(s, data, tutors, parents), 'No students yet.', { count: true }),
    section('Tutors', tutors, (t) => personRow(t,
      `students: ${names(data.tutorLinks.filter((l) => l.tutor_id === t.id).map((l) => l.student_id))}`),
      'No tutors yet.', { count: true }),
    section('Parents', parents, (p) => personRow(p,
      `children: ${names(data.parentLinks.filter((l) => l.parent_id === p.id).map((l) => l.student_id))}`),
      'No parents yet.', { count: true }),
    section('Admins', group('admin'), (a) => personRow(a, a.id === me.id ? 'you' : ''), '', { count: true }),
  );
}

await render();
