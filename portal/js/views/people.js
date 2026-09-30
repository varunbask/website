// People (people.html, admin; spec 5.14). Two link tabs over one data load:
//   #/pending   Waiting for approval: one card per sign-up, oldest first
//   #/everyone  Everyone else, filtered by role (?role=, replaceState) and an
//               in-memory search; role changes and tutor and parent links
//
// act() keeps the order the old page used: on error, redraw first so every
// control shows what the database really holds, then show the message and
// bring it into view; on success, show the message, then redraw. The message
// (#people-message) sits above #people, outside the part that is redrawn. It
// is never [hidden]: a live region that is in the accessibility tree before
// its first change is announced reliably; while empty, CSS collapses its slot.
//
// Pure helpers (normalizeRole, roleCounts, linkedTo, peopleIn, byCreated,
// approveText) are exported for tests; they never touch the DOM.

import { sb } from '../supabase.js';
import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import {
  avatar, button, iconButton, busy, pill, select, emptyState, errorCallout, skeletonRows,
  segmented, setSegmented, groupHeader, badgeText, visuallyHidden,
} from '../ui.js';
import { displayName } from '../format.js';
import { filterPeople } from '../app-model.js';
import { relativeTime } from '../dates.js';

// ---------------------------------------------------------------------------
// Pure logic

export const ROLE_LABELS = Object.freeze({ pending: 'Waiting', student: 'Student', parent: 'Parent', tutor: 'Tutor', admin: 'Admin' });
export const APPROVE_ROLES = Object.freeze(['student', 'parent', 'tutor', 'admin']);
export const FILTERS = Object.freeze(['all', 'student', 'parent', 'tutor', 'admin']);
const FILTER_LABELS = { all: 'All', student: 'Students', parent: 'Parents', tutor: 'Tutors', admin: 'Admins' };
const GROUP_NOUNS = { student: 'students', parent: 'parents', tutor: 'tutors', admin: 'admins' };

// The words after "to" and "is now": "parent", "waiting for approval"
const ROLE_WORDS = { pending: 'waiting for approval', student: 'student', parent: 'parent', tutor: 'tutor', admin: 'admin' };
const ROLE_ARTICLE = { pending: 'waiting for approval', student: 'a student', parent: 'a parent', tutor: 'a tutor', admin: 'an admin' };

export const roleWord = (role) => ROLE_WORDS[role] ?? String(role ?? '');

export function normalizeRole(role) {
  return FILTERS.includes(role) ? role : 'all';
}

export const byName = (a, b) => displayName(a).localeCompare(displayName(b));
export const byCreated = (a, b) => (Date.parse(a.created_at) - Date.parse(b.created_at)) || byName(a, b);

// Everyone except people waiting for approval, per role, plus the total
export function roleCounts(people) {
  const counts = { all: 0, student: 0, parent: 0, tutor: 0, admin: 0 };
  for (const p of people ?? []) {
    if (!(p.role in counts) || p.role === 'all') continue;
    counts[p.role] += 1;
    counts.all += 1;
  }
  return counts;
}

// The people in `role` linked to a student through `links` (tutor_students or
// parent_students rows), by name. key: 'tutor_id' | 'parent_id'.
export function linkedTo(studentId, links, key, byId) {
  return (links ?? [])
    .filter((l) => l.student_id === studentId)
    .map((l) => byId.get(l[key]))
    .filter(Boolean)
    .sort(byName);
}

// The students linked to a tutor or parent, by name
export function studentsOf(personId, links, key, byId) {
  return (links ?? [])
    .filter((l) => l[key] === personId)
    .map((l) => byId.get(l.student_id))
    .filter(Boolean)
    .sort(byName);
}

// The Everyone list: people with a real role (not pending), filtered by role
// and search text, grouped in the order Students, Parents, Tutors, Admins.
// Returns [{ role, label, people }] with empty groups left out.
export function peopleIn(people, { role = 'all', search = '' } = {}) {
  const want = normalizeRole(role);
  const shown = filterPeople((people ?? []).filter((p) => p.role !== 'pending' && p.role in GROUP_NOUNS), search);
  return ['student', 'parent', 'tutor', 'admin']
    .filter((r) => want === 'all' || want === r)
    .map((r) => ({ role: r, label: FILTER_LABELS[r], people: shown.filter((p) => p.role === r).sort(byName) }))
    .filter((g) => g.people.length);
}

// Success text after an approval
export function approveText(name, role) {
  const base = `Approved ${name} as ${roleWord(role)}.`;
  if (role === 'student') return `${base} Link a tutor and parents under Everyone.`;
  if (role === 'parent' || role === 'tutor') return `${base} Link them to a student under Everyone.`;
  return base;
}

// ---------------------------------------------------------------------------
// Data (the three queries the People page has always used)

async function load() {
  const [people, tutorLinks, parentLinks] = await Promise.all([
    sb.from('profiles').select('id, email, full_name, role, requested_role, signup_note, created_at'),
    sb.from('tutor_students').select('tutor_id, student_id'),
    sb.from('parent_students').select('parent_id, student_id'),
  ]);
  for (const result of [people, tutorLinks, parentLinks]) if (result.error) throw result.error;
  const list = people.data ?? [];
  return {
    people: list,
    byId: new Map(list.map((p) => [p.id, p])),
    tutorLinks: tutorLinks.data ?? [],
    parentLinks: parentLinks.data ?? [],
  };
}

// ---------------------------------------------------------------------------
// View

// The Everyone search survives refresh re-renders, not a fresh visit
let keptSearch = '';

const ENTER_LIMIT = 8;
const cssEscape = (s) => (globalThis.CSS?.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));

export function mount(ctx) {
  const view = ctx.route.view === 'everyone' ? 'everyone' : 'pending';
  const me = ctx.me;
  if (!ctx.isRefresh) keptSearch = '';

  // Header and link tabs. The waiting count fills in once the data arrives;
  // the tab links are updated in place so focus never drops.
  const pendingTab = h('a', { class: 'tab', href: '#/pending', 'aria-current': view === 'pending' ? 'page' : undefined }, 'Waiting for approval');
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'People' },
    pendingTab,
    h('a', { class: 'tab', href: '#/everyone', 'aria-current': view === 'everyone' ? 'page' : undefined }, 'Everyone'));
  ctx.setHeader({ title: 'People', tabs });

  function setPendingCount(n) {
    const text = badgeText(n);
    pendingTab.replaceChildren('Waiting for approval',
      text ? h('span', { class: 'tab-count num', 'aria-hidden': 'true' }, text) : null,
      text ? visuallyHidden(`, ${n} ${n === 1 ? 'person' : 'people'} waiting`) : null);
  }

  const message = h('p', { id: 'people-message', class: 'ppl-message', role: 'status', 'aria-live': 'polite' });
  function say(text, kind) {
    message.textContent = text ?? '';
    message.classList.remove('error', 'success');
    if (text) message.classList.add(kind);
  }
  const root = h('div', { id: 'people', class: 'ppl-root' });
  const okIcon = icon('check-circle', { size: 20 });
  okIcon.classList.add('ppl-message-icon', 'is-success');
  const errorIcon = icon('warning-circle', { size: 20 });
  errorIcon.classList.add('ppl-message-icon', 'is-error');
  ctx.host.append(h('div', { class: 'ppl-message-slot' }, okIcon, errorIcon, message), root);

  let data = null;
  let renderSeq = 0;
  let firstRender = true;
  let role = normalizeRole(ctx.route.params?.role);

  // Keeps the admin nav badge and the page default in step with the list
  function syncCounts() {
    try {
      ctx.store.invalidatePending?.();
    } catch {
      // older store: the badge catches up on the next load
    }
    ctx.refreshNav?.();
  }

  // Loads and redraws #people. Keeps the old list on screen until the new
  // data is in, then restores focus by data-focus-key (or its fallback).
  // `focus` names the control to focus when the one that acted is gone.
  async function render(focus = null) {
    const my = ++renderSeq;
    if (!data) {
      root.replaceChildren(skeletonRows(4));
      root.setAttribute('aria-busy', 'true');
    }
    let next;
    try {
      next = await load();
    } catch (error) {
      if (!ctx.alive() || my !== renderSeq) return;
      console.error(error);
      root.removeAttribute('aria-busy');
      root.replaceChildren(errorCallout({
        title: 'We couldn’t load people.',
        text: 'Check your connection and try again.',
        onRetry: () => render(),
      }));
      if (firstRender) {
        firstRender = false;
        ctx.announce('People could not be loaded');
      }
      return;
    }
    if (!ctx.alive() || my !== renderSeq) return;
    data = next;
    root.removeAttribute('aria-busy');

    const target = focus ?? focusTarget();
    draw();
    restoreFocus(target);

    const waiting = data.people.filter((p) => p.role === 'pending').length;
    setPendingCount(waiting);
    if (firstRender) {
      firstRender = false;
      if (view === 'pending') ctx.announce(`Waiting for approval, ${waiting} ${waiting === 1 ? 'person' : 'people'}`);
      else ctx.announce(`Everyone, ${roleCounts(data.people).all} people`);
    }
  }

  function focusTarget() {
    const active = document.activeElement;
    if (!active || !root.contains(active)) return null;
    return { key: active.dataset?.focusKey ?? null, fallback: active.dataset?.focusFallback ?? null };
  }

  // `target` is only set when focus was inside #people or a write passed a
  // hint. When neither key survived the redraw (the last waiting person was
  // approved, or a role change moved someone out of the list), focus goes to
  // the nearest thing left rather than falling to <body>.
  function restoreFocus(target) {
    if (!target) return;
    for (const key of [target.key, target.fallback]) {
      if (!key) continue;
      const el = root.querySelector(`[data-focus-key="${cssEscape(key)}"]`);
      if (el && !el.disabled) {
        el.focus({ preventScroll: true });
        return;
      }
    }
    const active = document.activeElement;
    // Only when focus really dropped: never pull it from somewhere the user moved to
    if (active && active !== document.body && active.isConnected) return;
    const pressed = everyone && root.contains(everyone.seg) && role !== 'all'
      ? everyone.seg.querySelector('button[aria-pressed="true"]')
      : null;
    const search = everyone && root.contains(everyone.input) ? everyone.input : null;
    const last = root.querySelector('.empty-state .btn') ?? pressed ?? search ?? ctx.host.querySelector('h1');
    last?.focus({ preventScroll: true });
  }

  // Runs a write, reports the result, and redraws (order preserved from the old page)
  async function act(request, successText, focus = null) {
    let error = null;
    try {
      ({ error } = await request);
    } catch (thrown) {
      error = thrown;
    }
    if (!ctx.alive()) return;
    if (error) {
      await render(focus);
      if (!ctx.alive()) return;
      say(`That didn’t save: ${error.message ?? 'please try again.'}`, 'error');
      message.scrollIntoView({ block: 'center' });
      return;
    }
    say(successText, 'success');
    await render(focus);
    if (!ctx.alive()) return;
    syncCounts();
  }

  function draw() {
    if (view === 'pending') drawPending();
    else drawEveryone();
  }

  // -------------------------------------------------------------------------
  // Waiting for approval

  function drawPending() {
    const waiting = data.people.filter((p) => p.role === 'pending').sort(byCreated);
    if (!waiting.length) {
      root.replaceChildren(emptyState({
        icon: 'check-circle',
        text: 'Nobody is waiting.',
        action: { label: 'See everyone', href: '#/everyone' },
      }));
      return;
    }
    const animate = firstRender && !ctx.isRefresh;
    root.replaceChildren(h('ul', { class: 'ppl-cards', 'aria-label': 'Waiting for approval' },
      waiting.map((p, i) => {
        const li = pendingCard(p);
        if (animate && i < ENTER_LIMIT) {
          li.classList.add('enter');
          li.style.setProperty('--i', String(i));
        }
        return li;
      })));
  }

  function pendingCard(person) {
    const name = displayName(person);
    const requested = APPROVE_ROLES.includes(person.requested_role) ? person.requested_role : null;
    const nameId = uid('ppl-name');
    const selectId = uid('ppl-approve');

    const choice = select({
      id: selectId,
      size: 'sm',
      value: requested ?? 'student',
      options: APPROVE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
    });
    choice.firstElementChild.dataset.focusKey = `approve-as-${person.id}`;
    // Every card's select is labelled "Approve as"; the name tells them apart
    choice.firstElementChild.setAttribute('aria-describedby', nameId);

    const approve = button({
      label: 'Approve',
      variant: 'primary',
      size: 'sm',
      icon: 'check',
      focusKey: `approve-${person.id}`,
      onClick: async () => {
        const next = choice.firstElementChild.value;
        if (next === 'admin') {
          const ok = await ctx.confirm({
            title: `Make ${name} an admin?`,
            body: 'Admins can see and change everything.',
            confirmLabel: 'Make admin',
            tone: 'danger',
          });
          if (!ok || !ctx.alive()) return;
        }
        // The card leaves the list on success: focus moves to the next card
        const li = approve.closest('li');
        const near = li?.nextElementSibling ?? li?.previousElementSibling;
        const focus = { key: `approve-${person.id}`, fallback: near?.querySelector('button[data-focus-key^="approve-"]')?.dataset.focusKey ?? null };
        await busy(approve, 'Approving…', () =>
          act(sb.from('profiles').update({ role: next }).eq('id', person.id), approveText(name, next), focus));
      },
    });
    approve.setAttribute('aria-describedby', nameId);

    const created = person.created_at ? relativeTime(person.created_at, ctx.now) : null;
    const signedUp = created
      ? h('time', { class: 'ppl-signed num', datetime: person.created_at, title: `Signed up ${created.full}` },
        `Signed up ${created.text === 'Just now' || created.text === 'Yesterday' ? created.text.toLowerCase() : created.text}`)
      : null;

    const asked = requested
      ? pill({ label: `Asked to join as ${roleWord(requested)}`, tone: 'neutral', icon: 'identification-badge' })
      : pill({ label: 'No role requested', tone: 'neutral', icon: 'minus-circle' });

    return h('li', { class: 'card ppl-card' },
      h('div', { class: 'ppl-card-head' },
        avatar(name, { size: 40 }),
        h('div', { class: 'ppl-id' },
          h('h2', { class: 'ppl-card-name', id: nameId }, name),
          person.email && person.email !== name ? h('span', { class: 'ppl-email' }, person.email) : null),
        signedUp),
      h('div', { class: 'ppl-card-body' },
        asked,
        person.signup_note ? h('blockquote', { class: 'quote ppl-note' }, person.signup_note) : null),
      h('div', { class: 'ppl-approve' },
        h('label', { class: 'ppl-approve-label', for: selectId }, 'Approve as'),
        choice,
        approve));
  }

  // -------------------------------------------------------------------------
  // Everyone

  let everyone = null; // { input, seg, list, count } built once per mount

  function drawEveryone() {
    const counts = roleCounts(data.people);
    if (!everyone) buildEveryone();
    updateSegmentCounts(counts);
    fillEveryone();
  }

  function buildEveryone() {
    const inputId = uid('ppl-search');
    const input = h('input', {
      class: 'input',
      id: inputId,
      type: 'text',
      role: 'searchbox',
      inputmode: 'search',
      enterkeyhint: 'search',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'Find a person',
      dataset: { focusKey: 'ppl-search' },
    });
    input.value = keptSearch;
    input.addEventListener('input', () => {
      keptSearch = input.value;
      fillEveryone();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        e.preventDefault();
        input.value = '';
        keptSearch = '';
        fillEveryone();
      }
    });

    const countSpans = {};
    const seg = segmented({
      label: 'Filter by role',
      className: 'ppl-filter',
      value: role,
      options: FILTERS.map((f) => {
        // The hidden comma keeps the name "Students, 12" rather than "Students12"
        countSpans[f] = h('span', { class: 'num' });
        return { value: f, label: [FILTER_LABELS[f], h('span', { class: 'ppl-seg-count' }, visuallyHidden(', '), countSpans[f])] };
      }),
      onChange: (value) => {
        role = normalizeRole(value);
        ctx.setParams({ role: role === 'all' ? null : role }, { replace: true });
        fillEveryone();
      },
    });
    for (const btn of seg.querySelectorAll('button[data-value]')) btn.dataset.focusKey = `ppl-filter-${btn.dataset.value}`;

    const list = h('div', { class: 'ppl-everyone' });
    const status = h('p', { class: 'visually-hidden', role: 'status' });
    const toolbar = h('div', { class: 'ppl-toolbar' },
      h('div', { class: 'ppl-search' },
        h('label', { class: 'visually-hidden', for: inputId }, 'Find a person'),
        h('span', { class: 'input-icon' }, icon('magnifying-glass'), input)),
      h('div', { class: 'ppl-filter-wrap' }, seg));
    everyone = { input, seg, list, status, countSpans, toolbar };
    root.replaceChildren(toolbar, status, list);
  }

  function updateSegmentCounts(counts) {
    for (const f of FILTERS) everyone.countSpans[f].textContent = String(counts[f] ?? 0);
    setSegmented(everyone.seg, role);
    if (!root.contains(everyone.toolbar)) root.replaceChildren(everyone.toolbar, everyone.status, everyone.list);
  }

  function fillEveryone() {
    const { list, input, status } = everyone;
    const focus = focusTarget();
    const groups = peopleIn(data.people, { role, search: input.value });
    const total = groups.reduce((n, g) => n + g.people.length, 0);
    status.textContent = input.value.trim() ? `${total} ${total === 1 ? 'person' : 'people'} found` : '';

    if (!groups.length) {
      const counts = roleCounts(data.people);
      let text;
      if (input.value.trim()) text = 'Nobody matches that search.';
      else if (role === 'all' || !counts[role]) text = role === 'all' ? 'Nobody has joined yet.' : `No ${GROUP_NOUNS[role]} yet.`;
      list.replaceChildren(emptyState({ icon: 'users-three', text }));
      return;
    }

    const tutors = data.people.filter((p) => p.role === 'tutor').sort(byName);
    const parents = data.people.filter((p) => p.role === 'parent').sort(byName);
    let n = 0;
    const animate = firstRender && !ctx.isRefresh;
    list.replaceChildren(...groups.map((g) => h('section', { class: 'ppl-group', 'aria-label': g.label },
      role === 'all' ? groupHeader({ label: g.label, count: g.people.length }) : null,
      h('ul', { class: 'ppl-list' }, g.people.map((p) => {
        const li = personRow(p, { tutors, parents });
        if (animate && n < ENTER_LIMIT) {
          li.classList.add('enter');
          li.style.setProperty('--i', String(n));
        }
        n += 1;
        return li;
      })))));
    restoreFocus(focus);
  }

  function roleSelect(person) {
    const name = displayName(person);
    const self = person.id === me.id;
    const noteId = self ? uid('ppl-self') : null;
    const wrap = select({
      label: `Role for ${name}`,
      size: 'sm',
      value: person.role,
      disabled: self,
      options: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
    });
    const sel = wrap.firstElementChild;
    sel.dataset.focusKey = `role-${person.id}`;
    if (noteId) sel.setAttribute('aria-describedby', noteId);
    sel.addEventListener('change', async () => {
      const next = sel.value;
      const risky = next === 'admin' || person.role === 'admin';
      const ok = await ctx.confirm({
        title: `Change ${name} to ${roleWord(next)}?`,
        body: 'Their access changes right away.',
        confirmLabel: 'Change role',
        tone: risky ? 'danger' : 'primary',
      });
      if (!ctx.alive()) return;
      if (!ok) {
        sel.value = person.role;
        return;
      }
      // One write at a time: the redraw replaces this select
      sel.disabled = true;
      await act(sb.from('profiles').update({ role: next }).eq('id', person.id),
        `${name} is now ${ROLE_ARTICLE[next] ?? roleWord(next)}.`, { key: `role-${person.id}` });
    });
    return h('div', { class: 'ppl-role' },
      wrap,
      self ? h('p', { class: 'ppl-self-note', id: noteId }, 'You can’t change your own role') : null);
  }

  // Tutors or Parents linked to a student: removable chips and an add select
  function linkGroup(student, kind, linked, candidates) {
    const isTutor = kind === 'tutor';
    const label = isTutor ? 'Tutors' : 'Parents';
    const table = isTutor ? 'tutor_students' : 'parent_students';
    const key = isTutor ? 'tutor_id' : 'parent_id';
    const studentName = displayName(student);
    const addKey = `add-${kind}-${student.id}`;
    const labelId = uid('ppl-links');

    const nameOf = (id) => displayName(data.byId.get(id));
    const add = (id) => act(sb.from(table).insert({ [key]: id, student_id: student.id }),
      isTutor ? `Assigned ${nameOf(id)} to ${studentName}.` : `Linked ${nameOf(id)} to ${studentName}.`,
      { key: `remove-${kind}-${student.id}-${id}`, fallback: addKey });
    const remove = (id) => act(sb.from(table).delete().eq(key, id).eq('student_id', student.id),
      isTutor ? `Removed ${nameOf(id)} from ${studentName}.` : `Unlinked ${nameOf(id)} from ${studentName}.`,
      { key: addKey, fallback: null });

    const linkedIds = new Set(linked.map((p) => p.id));
    const available = candidates.filter((p) => !linkedIds.has(p.id));

    let picker = null;
    if (available.length) {
      picker = select({
        label: `${isTutor ? 'Add a tutor' : 'Add a parent'} for ${studentName}`,
        size: 'sm',
        value: '',
        options: [{ value: '', label: isTutor ? 'Add a tutor' : 'Add a parent' }, ...available.map((p) => ({ value: p.id, label: displayName(p) }))],
      });
      picker.classList.add('ppl-add');
      const sel = picker.firstElementChild;
      sel.dataset.focusKey = addKey;
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        sel.disabled = true;
        add(sel.value);
      });
    }

    const chips = linked.length
      ? h('ul', { class: 'ppl-chips', 'aria-labelledby': labelId }, linked.map((p) => {
        const pname = displayName(p);
        const x = iconButton({
          icon: 'x',
          label: `Remove ${pname}`,
          tip: 'top',
          className: 'ppl-chip-remove',
          focusKey: `remove-${kind}-${student.id}-${p.id}`,
          onClick: () => {
            x.disabled = true;
            remove(p.id);
          },
        });
        x.dataset.focusFallback = addKey;
        return h('li', { class: 'ppl-chip' }, avatar(pname, { size: 24 }), h('span', { class: 'ppl-chip-name' }, pname), x);
      }))
      : h('p', { class: 'ppl-none' }, 'None yet');

    return h('div', { class: 'ppl-link-group' },
      h('span', { class: 'ppl-link-label', id: labelId }, label),
      h('div', { class: 'ppl-link-body' }, chips, picker));
  }

  function personRow(person, { tutors, parents }) {
    const name = displayName(person);
    const self = person.id === me.id;
    const isStudent = person.role === 'student';

    let detail = null;
    if (person.role === 'tutor' || person.role === 'parent') {
      const linked = studentsOf(person.id, person.role === 'tutor' ? data.tutorLinks : data.parentLinks,
        person.role === 'tutor' ? 'tutor_id' : 'parent_id', data.byId);
      const word = person.role === 'tutor' ? 'Students' : 'Children';
      detail = h('p', { class: linked.length ? 'ppl-detail' : 'ppl-detail is-empty' },
        linked.length ? `${word}: ${linked.map(displayName).join(', ')}` : `${word}: none yet`);
    }

    const workspace = isStudent
      ? button({
        label: 'Open workspace',
        href: `/portal/staff.html?student=${encodeURIComponent(person.id)}#/overview`,
        variant: 'secondary',
        size: 'sm',
        iconEnd: 'caret-right',
        className: 'ppl-open',
        focusKey: `open-${person.id}`,
      })
      : null;
    if (workspace) workspace.setAttribute('aria-label', `Open workspace for ${name}`);

    return h('li', { class: isStudent ? 'ppl-person is-student' : 'ppl-person' },
      h('div', { class: 'ppl-person-head' },
        avatar(name, { size: 32 }),
        h('div', { class: 'ppl-id' },
          h('span', { class: 'ppl-name' }, h('span', { class: 'ppl-name-text' }, name), self ? h('span', { class: 'ppl-you' }, 'You') : null),
          person.email && person.email !== name ? h('span', { class: 'ppl-email' }, person.email) : null,
          detail),
        h('div', { class: 'ppl-controls' }, workspace, roleSelect(person))),
      isStudent
        ? h('div', { class: 'ppl-links' },
          linkGroup(person, 'tutor', linkedTo(person.id, data.tutorLinks, 'tutor_id', data.byId), tutors),
          linkGroup(person, 'parent', linkedTo(person.id, data.parentLinks, 'parent_id', data.byId), parents))
        : null);
  }

  return render();
}
