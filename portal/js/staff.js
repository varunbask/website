import { sb } from './supabase.js';
import { requireRole, mountHeader } from './session.js';
import { h, clear } from './dom.js';
import { displayName, one } from './format.js';
import { renderProgress } from './progress-view.js';
import { renderTasks } from './staff-tasks.js';
import { renderUpdates } from './staff-updates.js';
import { renderSubmissions } from './staff-submissions.js';

const me = await requireRole(['admin', 'tutor']);
mountHeader(me);

const list = document.getElementById('student-list');
const search = document.getElementById('student-search');
const pickerEmpty = document.getElementById('picker-empty');
const pane = document.getElementById('pane');
const paneEmpty = document.getElementById('pane-empty');

let students = [];
let reviewCounts = new Map();
let selectedId = new URLSearchParams(location.search).get('student');

// The database limits a tutor to assigned students; an admin sees everyone
async function loadStudents() {
  const [people, waiting] = await Promise.all([
    sb.from('profiles').select('id, full_name, email').eq('role', 'student'),
    sb.from('submissions').select('student_id, grade:grades(released_at)').in('status', ['ai_graded', 'failed']),
  ]);
  if (people.error) throw people.error;
  students = people.data.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  reviewCounts = new Map();
  for (const s of waiting.data ?? []) {
    if (one(s.grade)?.released_at) continue;
    reviewCounts.set(s.student_id, (reviewCounts.get(s.student_id) ?? 0) + 1);
  }
}

function renderPicker() {
  const term = search.value.trim().toLowerCase();
  const shown = students.filter((s) => `${s.full_name} ${s.email}`.toLowerCase().includes(term));
  clear(list).append(...shown.map((s) => {
    const count = reviewCounts.get(s.id) ?? 0;
    return h('li', {}, h('button', {
      type: 'button',
      'aria-current': s.id === selectedId ? 'true' : 'false',
      onclick: () => select(s.id, true),
    }, h('span', {}, displayName(s)), count ? h('span', { class: 'badge' }, `${count} to review`) : null));
  }));
  pickerEmpty.hidden = shown.length > 0;
  if (!students.length) {
    pickerEmpty.textContent = me.role === 'admin'
      ? 'No students yet. Approve one on the People page.'
      : 'No students are assigned to you yet.';
  } else {
    pickerEmpty.textContent = 'No student matches that search.';
  }
}

async function onChange() {
  try {
    await loadStudents();
  } catch {
    /* keep the old list */
  }
  renderPicker();
  if (selectedId) await renderProgress(document.getElementById('progress'), selectedId);
}

async function select(id, focus = false) {
  const student = students.find((s) => s.id === id);
  if (!student) return;
  selectedId = id;
  const url = new URL(location.href);
  url.searchParams.set('student', id);
  history.replaceState(null, '', url);
  renderPicker();
  paneEmpty.hidden = true;
  pane.hidden = false;
  document.getElementById('student-name').textContent = displayName(student);
  document.getElementById('student-email').textContent = student.email ?? '';
  if (focus) document.getElementById('student-name').focus();
  const context = { me, student, onChange };
  await Promise.all([
    renderProgress(document.getElementById('progress'), id),
    renderSubmissions(document.getElementById('submissions'), context),
    renderTasks(document.getElementById('tasks'), context),
    renderUpdates(document.getElementById('updates'), context),
  ]);
}

search.addEventListener('input', renderPicker);

try {
  await loadStudents();
} catch {
  pickerEmpty.hidden = false;
  pickerEmpty.textContent = 'Students could not be loaded. Refresh to try again.';
}
renderPicker();
if (selectedId && students.some((s) => s.id === selectedId)) await select(selectedId);
else if (students.length === 1) await select(students[0].id);
