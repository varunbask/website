// People (people.html, admin; spec 5.14). Two link tabs over one data load:
//   #/pending   Waiting for approval: one card per sign-up, oldest first
//   #/everyone  Everyone else, filtered by role (?role=, replaceState) and an
//               in-memory search; role changes and tutor and parent links.
//               Each tutor link carries the subject that tutor teaches the
//               student (tutor_students.subject), shown and edited in an
//               inline field beside the chip; adding a tutor takes an optional
//               subject.
//
// act() keeps the order the old page used: on error, redraw first so every
// control shows what the database really holds, then show the message and
// bring it into view; on success, show the message, then redraw. The message
// (#people-message) sits above #people, outside the part that is redrawn. It
// is never [hidden]: a live region that is in the accessibility tree before
// its first change is announced reliably; while empty, CSS collapses its slot.
//
// People without a sign-in (profiles.no_login): the admin adds a student or
// parent by name (Add without a login, through /api/people), links and
// schedules them like anyone else, and later sends a personal Invite link
// (only its SHA-256 is stored in portal_invites) so they can set their own
// email and password on portal/join.html.
//
// Pure helpers (normalizeRole, roleCounts, linkedTo, peopleIn, byCreated,
// approveText) are exported for tests; they never touch the DOM.

import { sb } from '../supabase.js';
import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { newInviteToken, inviteLink, inviteMessage, inviteState, parseFamilyLines, planFamilies } from '../invites-model.js';
import {
  avatar, button, iconButton, busy, pill, select, emptyState, errorCallout, skeletonRows,
  segmented, setSegmented, groupHeader, badgeText, visuallyHidden,
} from '../ui.js';
import { displayName } from '../format.js';
import { filterPeople, roleChangeBody, normalizeFullName, NAME_MAX } from '../app-model.js';
import { relativeTime } from '../dates.js';
import { SUBJECT_MAX, linkSubject, normalizeSubject } from '../schedule-summary.js';

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

// parent_students.bills (which parent pays) comes with the billing migration;
// without it the page still loads, just without the Pays marks
async function loadParentLinks() {
  const withBills = await sb.from('parent_students').select('parent_id, student_id, bills');
  if (!withBills.error) return withBills;
  return sb.from('parent_students').select('parent_id, student_id');
}

// profiles.no_login and portal_invites come with the invites migration; the
// page still loads without them
async function loadProfiles() {
  const fields = 'id, email, full_name, role, requested_role, signup_note, created_at';
  const withFlag = await sb.from('profiles').select(`${fields}, no_login`);
  if (!withFlag.error) return withFlag;
  return sb.from('profiles').select(fields);
}

async function loadInvites() {
  const res = await sb.from('portal_invites').select('id, profile_id, created_at, expires_at, used_at, emailed_to, emailed_at');
  return res.error ? { data: [] } : res;
}

async function load() {
  const [people, tutorLinks, parentLinks, invites] = await Promise.all([
    loadProfiles(),
    sb.from('tutor_students').select('tutor_id, student_id, subject'),
    loadParentLinks(),
    loadInvites(),
  ]);
  for (const result of [people, tutorLinks, parentLinks]) if (result.error) throw result.error;
  const list = people.data ?? [];
  return {
    people: list,
    byId: new Map(list.map((p) => [p.id, p])),
    tutorLinks: tutorLinks.data ?? [],
    parentLinks: parentLinks.data ?? [],
    invites: invites.data ?? [],
  };
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// POST /api/people as the signed-in admin -> { status, body }
async function peopleApi(payload) {
  const { data: { session } } = await sb.auth.getSession();
  try {
    const res = await fetch('/api/people', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch {
    return { status: 0, body: {} };
  }
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
    h('a', { class: 'tab', href: '#/everyone', 'aria-current': view === 'everyone' ? 'page' : undefined }, 'Everyone'),
    h('a', { class: 'tab', href: '#/referrals' }, 'Referrals'),
    h('a', { class: 'tab', href: '#/reviews' }, 'Reviews'));
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
      const result = await request;
      error = result.error;
      // A write that asked for its rows back and got none did not happen (RLS)
      if (!error && Array.isArray(result.data) && result.data.length === 0) {
        error = { message: 'nothing changed. Refresh the page and try again.' };
      }
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
    const adder = addWithoutLogin();
    const toolbar = h('div', { class: 'ppl-toolbar' },
      h('div', { class: 'ppl-search' },
        h('label', { class: 'visually-hidden', for: inputId }, 'Find a person'),
        h('span', { class: 'input-icon' }, icon('magnifying-glass'), input)),
      h('div', { class: 'ppl-filter-wrap' }, seg),
      adder);
    everyone = { input, seg, list, status, countSpans, toolbar };
    root.replaceChildren(toolbar, status, list);
  }

  // A student or parent who has no account yet: a real portal account with no
  // way to sign in, so they can be linked, scheduled and billed; Invite later
  function addWithoutLogin() {
    const nameInput = h('input', {
      class: 'input', type: 'text', maxlength: '120', autocomplete: 'off', placeholder: 'Full name',
      'aria-label': 'Full name of the person to add', dataset: { focusKey: 'ppl-add-name' },
    });
    let newRole = 'student';
    const kind = segmented({
      label: 'Add as',
      value: newRole,
      options: [{ value: 'student', label: 'Student' }, { value: 'parent', label: 'Parent' }],
      onChange: (v) => { newRole = v; },
    });
    const add = button({ label: 'Add', type: 'submit', variant: 'primary', size: 'sm', icon: 'plus', focusKey: 'ppl-add-submit' });
    const form = h('form', { class: 'ppl-add-person', hidden: true },
      h('p', { class: 'ppl-add-person-help' }, 'For a student or parent who has no account yet. You can link, schedule and bill them now, and send them an invite to set up their sign-in later.'),
      h('div', { class: 'ppl-add-person-row' }, nameInput, kind, add));
    const list = addFromList();
    const open = button({
      label: 'Add without a login', size: 'sm', variant: 'secondary', icon: 'plus', focusKey: 'ppl-add-open',
      onClick: () => {
        form.hidden = !form.hidden;
        list.hidden = true;
        if (!form.hidden) nameInput.focus();
      },
    });
    const openList = button({
      label: 'Paste a list', size: 'sm', variant: 'ghost', icon: 'clipboard-text', focusKey: 'ppl-list-open',
      onClick: () => {
        list.hidden = !list.hidden;
        form.hidden = true;
        if (!list.hidden) list.querySelector('textarea').focus();
      },
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameInput.value.trim().replace(/\s+/g, ' ');
      if (!name) {
        nameInput.focus();
        return;
      }
      busy(add, 'Adding…', async () => {
        const { status, body } = await peopleApi({ action: 'create', full_name: name, role: newRole });
        if (!ctx.alive()) return;
        if (status !== 201) {
          say(`That didn’t save: ${status === 0 ? 'check your connection and try again.' : status === 401 ? 'sign in again as an admin.' : 'please try again.'}`, 'error');
          return;
        }
        nameInput.value = '';
        form.hidden = true;
        say(`Added ${name} as a ${newRole} without a login. Link them below, then use Invite when they are ready to sign in.`, 'success');
        await render({ key: `invite-${body.id}`, fallback: 'ppl-add-open' });
        syncCounts();
      });
    });
    return h('div', { class: 'ppl-add-wrap' }, h('div', { class: 'ppl-add-buttons' }, open, openList), form, list);
  }

  // Many families at once, from the old scheduler's lines ("Amy (Ryan): Math $45"):
  // adds the students and parents who are not in the portal yet, without a
  // login, and links each student to their parent. Nothing is saved until Add.
  function addFromList() {
    const text = h('textarea', {
      class: 'input textarea ppl-list-text', rows: '6', 'aria-label': 'Families, one student per line',
      placeholder: 'Amy (Ryan)\nMason (Sunny)\nBill (Sunny): Programming $15',
    });
    const out = h('div', { class: 'ppl-list-plan' });
    const progress = h('p', { class: 'ppl-list-progress', role: 'status' });
    let plan = null;
    const names = (rows) => rows.map((p) => p.name).join(', ');
    const section = (title, body, warning = false) => [
      h('h4', { class: `ppl-list-title${warning ? ' is-warning' : ''}` }, title),
      body,
    ];
    const go = button({ label: 'Add', variant: 'primary', size: 'sm', icon: 'plus', focusKey: 'ppl-list-add' });
    const preview = button({
      label: 'Preview', size: 'sm', focusKey: 'ppl-list-preview',
      onClick: () => {
        const parsed = parseFamilyLines(text.value);
        plan = planFamilies(parsed.rows, { people: data.people, parentLinks: data.parentLinks });
        const students = plan.add.filter((p) => p.role === 'student');
        const parents = plan.add.filter((p) => p.role === 'parent');
        const issues = [...parsed.errors.map((e) => `${e.line}: ${e.error}`), ...plan.problems.map((p) => `${p.line}: ${p.reason}`)];
        const total = plan.add.length + plan.links.length;
        go.querySelector('.btn-label').textContent = `Add ${plan.add.length} ${plan.add.length === 1 ? 'person' : 'people'}`
          + (plan.links.length ? ` and ${plan.links.length} ${plan.links.length === 1 ? 'link' : 'links'}` : '');
        out.replaceChildren(
          ...(students.length ? section(`New students (${students.length})`, h('p', {}, names(students))) : []),
          ...(parents.length ? section(`New parents (${parents.length})`, h('p', {}, names(parents))) : []),
          ...(plan.found.length ? section(`Already in the portal (${plan.found.length})`, h('p', {}, names(plan.found))) : []),
          ...(plan.links.length ? section(`Parent links to make (${plan.links.length})`, h('p', {}, 'Each student to the parent in brackets. The first parent linked to a student pays.')) : []),
          ...(issues.length ? section(`Needs attention, skipped (${issues.length})`, h('ul', {}, issues.map((t) => h('li', {}, t))), true) : []),
          total ? go : h('p', { class: 'ppl-list-none' }, 'Nothing new to add.'),
        );
      },
    });
    go.addEventListener('click', () => busy(go, 'Adding…', async () => {
      if (!plan) return;
      const ids = new Map(plan.found.map((p) => [p.key, p.id]));
      let made = 0;
      let failed = 0;
      for (const person of plan.add) {
        progress.textContent = `Adding ${made + failed + 1} of ${plan.add.length}…`;
        const { status, body } = await peopleApi({ action: 'create', full_name: person.name, role: person.role });
        if (!ctx.alive()) return;
        if (status === 201 && body.id) {
          ids.set(person.key, body.id);
          made += 1;
        } else {
          failed += 1;
          if (status === 401 || status === 0) break;
        }
      }
      let linked = 0;
      for (const l of plan.links) {
        const parentId = ids.get(l.parent);
        const studentId = ids.get(l.student);
        if (!parentId || !studentId) continue;
        progress.textContent = `Linking ${linked + 1} of ${plan.links.length}…`;
        const { error } = await sb.from('parent_students').insert({ parent_id: parentId, student_id: studentId });
        if (!ctx.alive()) return;
        if (error) failed += 1;
        else linked += 1;
      }
      progress.textContent = '';
      plan = null;
      out.replaceChildren();
      const done = `Added ${made} ${made === 1 ? 'person' : 'people'} without a login and ${linked} parent ${linked === 1 ? 'link' : 'links'}.`;
      if (failed) {
        say(`${done} ${failed} didn’t save. Paste the same list again to add the rest; anyone already added is kept.`, 'error');
      } else {
        text.value = '';
        say(`${done} Press Invite on a parent’s row when the family is ready to sign in.`, 'success');
      }
      await render({ fallback: 'ppl-list-open' });
      syncCounts();
    }));
    return h('div', { class: 'ppl-add-person ppl-add-list', hidden: true },
      h('p', { class: 'ppl-add-person-help' }, 'One student per line, with their parent in brackets, as the old scheduler lists them: Amy (Ryan). For a parent with two children, write a line for each child with the same parent: Mason (Sunny) and Bill (Sunny). Rates after a colon are ignored here (paste them on Account > Rates). People already in the portal under the same full name are reused, not added twice.'),
      text,
      h('div', { class: 'ppl-add-person-row' }, preview),
      progress,
      out);
  }

  // The latest invite of a person without a sign-in, and making a new one
  function inviteControls(person) {
    if (!person.no_login || !['student', 'parent'].includes(person.role)) return null;
    const name = displayName(person);
    const state = inviteState(data.invites.filter((i) => i.profile_id === person.id), Date.now());
    const panel = h('div', { class: 'ppl-invite-panel', hidden: true });
    const when = (iso) => relativeTime(iso, ctx.now).text.toLowerCase();
    const note = state.key === 'open'
      ? `Invited ${when(state.invite.created_at)}${state.invite.emailed_to ? `, emailed to ${state.invite.emailed_to}` : ''}`
      : state.key === 'expired' ? 'Invite expired' : null;
    const make = button({
      label: state.key === 'open' ? 'New invite link' : 'Invite',
      size: 'sm',
      variant: state.key === 'open' ? 'ghost' : 'secondary',
      icon: 'envelope-simple',
      focusKey: `invite-${person.id}`,
      onClick: () => busy(make, 'Making a link…', async () => {
        const token = newInviteToken();
        const token_hash = await sha256Hex(token);
        const { data: rows, error } = await sb.from('portal_invites').insert({ profile_id: person.id, token_hash }).select('id');
        if (!ctx.alive()) return;
        if (error || !rows?.length) {
          say('That didn’t save: the invite could not be made. Refresh the page and try again.', 'error');
          return;
        }
        showLink(panel, person, token);
      }),
    });
    make.setAttribute('aria-label', `${state.key === 'open' ? 'New invite link' : 'Invite'} for ${name}`);
    return h('div', { class: 'ppl-invite' },
      h('div', { class: 'ppl-invite-row' }, pill({ label: 'No sign-in yet', tone: 'warning', icon: 'clock' }), note ? h('span', { class: 'ppl-invite-note' }, note) : null, make),
      panel);
  }

  // The link is shown once (only its hash is kept): copy it, or email it from here
  function showLink(panel, person, token) {
    const name = displayName(person);
    const link = inviteLink(token, location.origin);
    const children = person.role === 'parent' ? studentsOf(person.id, data.parentLinks, 'parent_id', data.byId).map(displayName) : [];
    const message = inviteMessage(name, link, { role: person.role, children });
    const copy = (text, label, done) => button({
      label, size: 'sm', icon: 'copy',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          say(done, 'success');
        } catch {
          say('Your browser blocked copying. Select the link and copy it yourself.', 'error');
        }
      },
    });
    const to = h('input', { class: 'input', type: 'email', autocomplete: 'off', placeholder: 'their@email.com', 'aria-label': `Email to send ${name}’s invite to` });
    const send = button({ label: 'Email it', size: 'sm', variant: 'primary', icon: 'envelope-simple' });
    send.addEventListener('click', () => busy(send, 'Sending…', async () => {
      const address = to.value.trim();
      if (!address.includes('@')) {
        to.focus();
        return;
      }
      const { status } = await peopleApi({ action: 'email', t: token, to: address });
      if (!ctx.alive()) return;
      if (status === 200) {
        say(`Invite emailed to ${address}. ${name} can set up their sign-in from the link.`, 'success');
        await render({ key: `invite-${person.id}` });
        return;
      }
      say(`That didn’t send: ${status === 422 ? 'check the email address.' : status === 503 ? 'email is not set up; copy the link instead.' : 'please try again, or copy the link instead.'}`, 'error');
    }));
    const field = h('input', { class: 'input ppl-invite-link', type: 'text', readonly: true, value: link, 'aria-label': `Invite link for ${name}` });
    field.addEventListener('focus', () => field.select());
    panel.replaceChildren(
      h('p', { class: 'ppl-invite-help' }, `${name}’s personal link. It works once, for 30 days, and is shown only now.`),
      field,
      h('div', { class: 'ppl-invite-actions' },
        copy(link, 'Copy link', 'Link copied.'),
        copy(message, 'Copy message with link', 'Message copied. Paste it into a text.')),
      h('div', { class: 'ppl-invite-email' }, to, send));
    panel.hidden = false;
    field.focus();
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

    // An admin can also be a student's tutor (marked in the add list)
    const tutors = data.people.filter((p) => p.role === 'tutor' || p.role === 'admin').sort(byName);
    const parents = data.people.filter((p) => p.role === 'parent').sort(byName);
    const students = data.people.filter((p) => p.role === 'student').sort(byName);
    let n = 0;
    const animate = firstRender && !ctx.isRefresh;
    list.replaceChildren(...groups.map((g) => h('section', { class: 'ppl-group', 'aria-label': g.label },
      role === 'all' ? groupHeader({ label: g.label, count: g.people.length }) : null,
      h('ul', { class: 'ppl-list' }, g.people.map((p) => {
        const li = personRow(p, { tutors, parents, students });
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
        body: roleChangeBody(person, data),
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
      await act(sb.from('profiles').update({ role: next }).eq('id', person.id).select('id'),
        `${name} is now ${ROLE_ARTICLE[next] ?? roleWord(next)}.`, { key: `role-${person.id}` });
    });
    return h('div', { class: 'ppl-role' },
      wrap,
      self ? h('p', { class: 'ppl-self-note', id: noteId }, 'You can’t change your own role') : null);
  }

  // Tutors or Parents linked to a student: removable chips and an add select.
  // A tutor's chip has an inline field beside it for the subject;
  // the add select takes an optional subject typed beside it.
  function linkGroup(student, kind, linked, candidates) {
    const isTutor = kind === 'tutor';
    const label = isTutor ? 'Tutors' : 'Parents';
    const table = isTutor ? 'tutor_students' : 'parent_students';
    const key = isTutor ? 'tutor_id' : 'parent_id';
    const studentName = displayName(student);
    const addKey = `add-${kind}-${student.id}`;
    const labelId = uid('ppl-links');

    const nameOf = (id) => displayName(data.byId.get(id));
    const add = (id, subject = null) => {
      const row = { [key]: id, student_id: student.id };
      if (isTutor) row.subject = subject;
      const done = isTutor
        ? `Assigned ${nameOf(id)} to ${studentName}${subject ? ` for ${subject}` : ''}.`
        : `Linked ${nameOf(id)} to ${studentName}.`;
      return act(sb.from(table).insert(row), done, { key: `remove-${kind}-${student.id}-${id}`, fallback: addKey });
    };
    const remove = (id) => act(sb.from(table).delete().eq(key, id).eq('student_id', student.id),
      isTutor ? `Removed ${nameOf(id)} from ${studentName}.` : `Unlinked ${nameOf(id)} from ${studentName}.`,
      { key: addKey, fallback: null });

    const tooLong = () => {
      say(`That didn’t save: the subject can be at most ${SUBJECT_MAX} characters.`, 'error');
      message.scrollIntoView({ block: 'center' });
    };

    // Changes the subject a tutor teaches this student: on change or Enter,
    // zero rows back means the link changed or was removed (act reports it)
    function subjectField(tutor, tutorName, current) {
      const fieldKey = `subject-${student.id}-${tutor.id}`;
      const input = h('input', {
        class: 'input ppl-subject-input',
        type: 'text',
        maxlength: String(SUBJECT_MAX),
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: 'Subject',
        'aria-label': `Subject ${tutorName} teaches ${studentName}`,
        dataset: { focusKey: fieldKey },
      });
      input.value = current ?? '';
      let saving = false;
      const commit = (fromKey) => {
        if (saving) return;
        const parsed = normalizeSubject(input.value);
        if (!parsed.ok) {
          tooLong();
          return;
        }
        if (parsed.subject === (current ?? null)) {
          input.value = current ?? '';
          return;
        }
        saving = true;
        input.disabled = true;
        // Enter keeps focus on the field; leaving it (Tab, a click) keeps focus
        // wherever the person went
        act(sb.from('tutor_students').update({ subject: parsed.subject }).eq('tutor_id', tutor.id).eq('student_id', student.id).select('tutor_id'),
          parsed.subject
            ? `${tutorName} now teaches ${parsed.subject} to ${studentName}.`
            : `Cleared the subject ${tutorName} teaches ${studentName}.`,
          fromKey ? { key: fieldKey } : null);
      };
      input.addEventListener('change', () => commit(false));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(true);
        } else if (e.key === 'Escape') {
          input.value = current ?? '';
        }
      });
      return input;
    }

    // One payer per student, switched in one statement (set_payer)
    function makePayer(parentId) {
      act(sb.rpc('set_payer', { p_student: student.id, p_parent: parentId }),
        `${nameOf(parentId)} now gets ${studentName}’s bill. Change payers on the first of a month so each month has one payer.`,
        { key: `pays-${student.id}-${parentId}` });
    }

    const linkedIds = new Set(linked.map((p) => p.id));
    const available = candidates.filter((p) => !linkedIds.has(p.id));

    let adder = null;
    if (available.length) {
      const picker = select({
        label: `${isTutor ? 'Add a tutor' : 'Add a parent'} for ${studentName}`,
        size: 'sm',
        value: '',
        options: [{ value: '', label: isTutor ? 'Add a tutor' : 'Add a parent' }, ...available.map((p) => ({ value: p.id, label: p.role === 'admin' ? `${displayName(p)} (admin)` : displayName(p) }))],
      });
      picker.classList.add('ppl-add');
      const sel = picker.firstElementChild;
      sel.dataset.focusKey = addKey;

      // Type the subject first, then choose the tutor: the choice adds them
      let newSubject = null;
      if (isTutor) {
        newSubject = h('input', {
          class: 'input ppl-subject-input is-new',
          type: 'text',
          maxlength: String(SUBJECT_MAX),
          autocomplete: 'off',
          spellcheck: 'false',
          placeholder: 'Subject (optional)',
          'aria-label': `Subject for the tutor you add to ${studentName}`,
          dataset: { focusKey: `new-subject-${student.id}` },
        });
      }
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        let subject = null;
        if (newSubject) {
          const parsed = normalizeSubject(newSubject.value);
          if (!parsed.ok) {
            sel.value = '';
            tooLong();
            return;
          }
          subject = parsed.subject;
        }
        sel.disabled = true;
        if (newSubject) newSubject.disabled = true;
        add(sel.value, subject);
      });
      adder = h('div', { class: 'ppl-add-row' }, newSubject, picker);
    }

    const chips = linked.length
      ? h('ul', { class: isTutor ? 'ppl-chips is-tutors' : 'ppl-chips', 'aria-labelledby': labelId }, linked.map((p) => {
        const pname = displayName(p);
        const subject = isTutor ? linkSubject(data.tutorLinks, p.id, student.id) : null;
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
        // Which parent gets the bill, when there is more than one (the Account page)
        const link = isTutor ? null : data.parentLinks.find((l) => l.parent_id === p.id && l.student_id === student.id);
        const pays = !isTutor && linked.length > 1 && link && 'bills' in link
          ? (link.bills
            ? h('span', { class: 'pill tone-success ppl-pays' }, 'Pays')
            : h('button', { type: 'button', class: 'btn btn-ghost btn-sm ppl-pays', dataset: { focusKey: `pays-${student.id}-${p.id}` }, onClick: () => makePayer(p.id) }, h('span', { class: 'btn-label' }, 'Bill to')))
          : null;
        const chip = h(isTutor ? 'span' : 'li', { class: 'ppl-chip' },
          avatar(pname, { size: 24 }),
          // The subject sits in the editable field beside a tutor's chip
          h('span', { class: 'ppl-chip-name' }, pname),
          pays,
          x);
        return isTutor ? h('li', { class: 'ppl-tutor' }, chip, subjectField(p, pname, subject)) : chip;
      }))
      : h('p', { class: 'ppl-none' }, 'None yet');

    return h('div', { class: 'ppl-link-group' },
      h('span', { class: 'ppl-link-label', id: labelId }, label),
      h('div', { class: 'ppl-link-body' }, chips, adder));
  }

  // A parent's children, from the parent's side: one parent can have any number
  // of children (two kids with us = two chips), and a child can have two parents
  function childGroup(parent, students) {
    const parentName = displayName(parent);
    const addKey = `add-child-${parent.id}`;
    const labelId = uid('ppl-links');
    const linked = studentsOf(parent.id, data.parentLinks, 'parent_id', data.byId);
    const linkedIds = new Set(linked.map((p) => p.id));
    const available = students.filter((p) => !linkedIds.has(p.id));

    let adder = null;
    if (available.length) {
      const picker = select({
        label: `Add a child for ${parentName}`,
        size: 'sm',
        value: '',
        options: [{ value: '', label: 'Add a child' }, ...available.map((p) => ({ value: p.id, label: displayName(p) }))],
      });
      picker.classList.add('ppl-add');
      const sel = picker.firstElementChild;
      sel.dataset.focusKey = addKey;
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        const child = sel.value;
        sel.disabled = true;
        act(sb.from('parent_students').insert({ parent_id: parent.id, student_id: child }),
          `Linked ${parentName} to ${displayName(data.byId.get(child))}.`,
          { key: `remove-child-${parent.id}-${child}`, fallback: addKey });
      });
      adder = h('div', { class: 'ppl-add-row' }, picker);
    }

    const chips = linked.length
      ? h('ul', { class: 'ppl-chips', 'aria-labelledby': labelId }, linked.map((c) => {
        const cname = displayName(c);
        const x = iconButton({
          icon: 'x',
          label: `Unlink ${cname}`,
          tip: 'top',
          className: 'ppl-chip-remove',
          focusKey: `remove-child-${parent.id}-${c.id}`,
          onClick: () => {
            x.disabled = true;
            act(sb.from('parent_students').delete().eq('parent_id', parent.id).eq('student_id', c.id),
              `Unlinked ${parentName} from ${cname}.`, { key: addKey, fallback: null });
          },
        });
        x.dataset.focusFallback = addKey;
        // Who gets the bill shows when a child has more than one parent (Bill to is on the child's row)
        const link = data.parentLinks.find((l) => l.parent_id === parent.id && l.student_id === c.id);
        const parentsOfChild = data.parentLinks.filter((l) => l.student_id === c.id).length;
        const pays = parentsOfChild > 1 && link && 'bills' in link && link.bills
          ? h('span', { class: 'pill tone-success ppl-pays' }, 'Pays') : null;
        return h('li', { class: 'ppl-chip' }, avatar(cname, { size: 24 }), h('span', { class: 'ppl-chip-name' }, cname), pays, x);
      }))
      : h('p', { class: 'ppl-none' }, 'None yet');

    return h('div', { class: 'ppl-link-group' },
      h('span', { class: 'ppl-link-label', id: labelId }, 'Children'),
      h('div', { class: 'ppl-link-body' }, chips, adder));
  }

  // The name with an Edit button that swaps in a field. Enter or Save saves,
  // Escape or Cancel puts the name back; zero rows back means it did not save
  // (act reports it). The sidebar shows a new name of your own after a reload.
  function nameField(person, name, self) {
    const key = `name-${person.id}`;
    const wrap = h('span', { class: 'ppl-name' });
    const show = () => {
      wrap.classList.remove('is-editing');
      // replaceChildren would write a null as the text "null", so leave it out
      wrap.replaceChildren(...[
        h('span', { class: 'ppl-name-text' }, name),
        self ? h('span', { class: 'ppl-you' }, 'You') : null,
        iconButton({ icon: 'pencil-simple', label: `Edit name: ${name}`, className: 'ppl-name-edit', focusKey: key, tip: 'top', onClick: edit }),
      ].filter(Boolean));
    };
    function edit() {
      const input = h('input', {
        class: 'input ppl-name-input',
        type: 'text',
        maxlength: String(NAME_MAX),
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': `Name for ${person.email || name}`,
        dataset: { focusKey: `${key}-input` },
      });
      input.value = person.full_name ?? '';
      let saving = false;
      const cancel = () => {
        show();
        wrap.querySelector('.ppl-name-edit')?.focus();
      };
      const commit = () => {
        if (saving) return;
        const parsed = normalizeFullName(input.value);
        if (!parsed.ok) {
          say(parsed.error, 'error');
          input.focus();
          return;
        }
        if (parsed.name === String(person.full_name ?? '').trim()) {
          cancel();
          return;
        }
        saving = true;
        input.disabled = true;
        act(sb.from('profiles').update({ full_name: parsed.name }).eq('id', person.id).select('id'),
          self ? `Your name is now ${parsed.name}. Reload to see it in the sidebar.` : `Renamed to ${parsed.name}.`,
          { key });
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      });
      wrap.classList.add('is-editing');
      wrap.replaceChildren(input,
        button({ label: 'Save', variant: 'primary', size: 'sm', className: 'ppl-name-save', onClick: commit }),
        button({ label: 'Cancel', variant: 'ghost', size: 'sm', className: 'ppl-name-cancel', onClick: cancel }));
      input.focus();
      input.select();
    }
    show();
    return wrap;
  }

  function personRow(person, { tutors, parents, students }) {
    const name = displayName(person);
    const self = person.id === me.id;
    const isStudent = person.role === 'student';

    let detail = null;
    // An admin who teaches shows their students too
    const teachingAdmin = person.role === 'admin' && data.tutorLinks.some((l) => l.tutor_id === person.id);
    if (person.role === 'tutor' || teachingAdmin) {
      const linked = studentsOf(person.id, data.tutorLinks, 'tutor_id', data.byId);
      detail = h('p', { class: linked.length ? 'ppl-detail' : 'ppl-detail is-empty' },
        linked.length ? `Students: ${linked.map(displayName).join(', ')}` : 'Students: none yet');
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
          nameField(person, name, self),
          person.email && person.email !== name && !person.no_login ? h('span', { class: 'ppl-email' }, person.email) : null,
          detail),
        h('div', { class: 'ppl-controls' }, workspace, roleSelect(person))),
      inviteControls(person),
      isStudent
        ? h('div', { class: 'ppl-links' },
          linkGroup(person, 'tutor', linkedTo(person.id, data.tutorLinks, 'tutor_id', data.byId), tutors),
          linkGroup(person, 'parent', linkedTo(person.id, data.parentLinks, 'parent_id', data.byId), parents))
        : null,
      person.role === 'parent' ? h('div', { class: 'ppl-links is-parent' }, childGroup(person, students)) : null);
  }

  return render();
}
