import { sb } from './supabase.js';
import { requireRole, mountHeader } from './session.js';
import { h, clear } from './dom.js';
import { displayName, firstName } from './format.js';
import { renderProgress } from './progress-view.js';
import { staffNames, loadUpdates, updateItem } from './updates-feed.js';
import { renderStudentView } from './student-view.js';

const me = await requireRole(['parent']);
mountHeader(me);

const title = document.getElementById('child-title');
const lede = document.getElementById('child-lede');
const switcher = document.getElementById('child-switch');

async function loadChildren() {
  const links = await sb.from('parent_students').select('student_id').eq('parent_id', me.id);
  if (links.error) throw links.error;
  const ids = links.data.map((l) => l.student_id);
  if (!ids.length) return [];
  const kids = await sb.from('profiles').select('id, full_name, email').in('id', ids);
  if (kids.error) throw kids.error;
  return kids.data.sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

async function renderUpdatesFeed(container, studentId) {
  try {
    const [updates, names] = await Promise.all([loadUpdates(studentId), staffNames()]);
    clear(container).append(updates.length
      ? h('ul', { class: 'ruled-list' }, updates.map((u) => updateItem(u, names)))
      : h('p', { class: 'empty' }, 'No updates yet. Your tutor posts them here.'));
  } catch {
    clear(container).append(h('p', { class: 'form-message error' }, 'Updates could not be loaded.'));
  }
}

// A fresh host per selection: a slow load for the previous child paints into a detached node
function freshHost(id) {
  const host = h('div');
  document.getElementById(id).replaceChildren(host);
  return host;
}

async function showChild(child) {
  const url = new URL(location.href);
  url.searchParams.set('child', child.id);
  history.replaceState(null, '', url);
  title.textContent = `${firstName(child.full_name)}'s progress`;
  const progress = freshHost('progress');
  const updates = freshHost('updates');
  const view = freshHost('child-view');
  await Promise.all([
    renderProgress(progress, child.id),
    renderUpdatesFeed(updates, child.id),
    renderStudentView(view, { studentId: child.id, readOnly: true, showUpdates: false }),
  ]);
}

// Shown only for more than one child
function renderSwitcher(children, selectedId) {
  if (children.length < 2) return;
  clear(switcher).append(h('fieldset', { class: 'field child-switch' },
    h('legend', { class: 'visually-hidden' }, 'Choose a child'),
    h('div', { class: 'segmented' }, children.map((child) => {
      const input = h('input', { type: 'radio', name: 'child', value: child.id, checked: child.id === selectedId });
      input.addEventListener('change', () => showChild(child));
      return h('label', {}, input, h('span', {}, firstName(child.full_name)));
    }))));
}

let children = [];
try {
  children = await loadChildren();
} catch {
  /* handled as "no children" below */
}

if (!children.length) {
  title.textContent = `Welcome, ${firstName(me.full_name)}`;
  lede.textContent = 'Your account is approved, but no student is linked to it yet. We will connect your child shortly. Questions? Email vbmgroupsllc@gmail.com.';
  document.getElementById('progress-section').hidden = true;
  document.getElementById('updates-section').hidden = true;
} else {
  const wanted = new URLSearchParams(location.search).get('child');
  const first = children.find((c) => c.id === wanted) ?? children[0];
  renderSwitcher(children, first.id);
  await showChild(first);
}
