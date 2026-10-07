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
// Under Everyone, an Invites row of toggle chips (Needs an invite, Invited
// not joined, Invite expired, All) shows who still has no login and how far
// their invite has got, and narrows the list together with the role filter
// and the search. It appears only while someone has no login. The states come
// from the invites loaded once with the people (portal/js/invite-status-model.js);
// nothing is queried per row.
//
// Delete (every row but an admin's): asks /api/people what would go (delete_preview),
// shows it in the confirm dialog, which also asks for the person's name typed
// back, then deletes them for good (delete_person). The row leaves the list at
// once, every cached view is dropped (store.invalidateAll) so each page redraws,
// and the other open portal tabs are told (data-sync.js). The wording and the
// list left behind are in delete-person-model.js.
//
// Pure helpers (normalizeRole, roleCounts, linkedTo, peopleIn, byCreated,
// approveText) are exported for tests; they never touch the DOM.

import { sb } from '../supabase.js';
import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { newInviteToken, inviteLink, inviteMessage, INVITE_DAYS, parseFamilyLines, planFamilies, signupMatches } from '../invites-model.js';
import {
  INVITE_FILTERS, INVITE_FILTER_LABELS, inviteStatuses, inviteCounts, hasNoLoginPeople, filterByInvite,
  inviteSummary, inviteEmptyText,
} from '../invite-status-model.js';
import {
  avatar, button, iconButton, busy, pill, select, emptyState, errorCallout, skeletonRows,
  segmented, setSegmented, groupHeader, badgeText, visuallyHidden,
} from '../ui.js';
import { displayName } from '../format.js';
import { filterPeople, roleChangeBody, normalizeFullName, NAME_MAX } from '../app-model.js';
import { relativeTime } from '../dates.js';
import { SUBJECT_MAX, linkSubject, normalizeSubject } from '../schedule-summary.js';
import { colorOptions, automaticLabel, chosenColors, pickerState, colorSavedText, toneClassFor } from '../tutor-colors-model.js';
import {
  canDelete, confirmName, nameMatches, normalizePreview, headline, detailLines, typedLabel, blockedTitle, deleteTitle, doneText,
  problemText, withoutPerson,
} from '../delete-person-model.js';
import { announceDataChanged } from '../data-sync.js';

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

// profiles.no_login and portal_invites come with the invites migration, and
// profiles.calendar_color with the tutor colors one; the page still loads
// without them (no color pickers while the column is missing)
async function loadProfiles() {
  const fields = 'id, email, full_name, role, requested_role, signup_note, created_at';
  const withColor = await sb.from('profiles').select(`${fields}, no_login, calendar_color`);
  if (!withColor.error) return withColor;
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

// The Everyone search and the invite chip survive refresh re-renders, not a fresh visit
let keptSearch = '';
let keptInvite = 'all';

const ENTER_LIMIT = 8;
const cssEscape = (s) => (globalThis.CSS?.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));

export function mount(ctx) {
  const view = ctx.route.view === 'everyone' ? 'everyone' : 'pending';
  const me = ctx.me;
  if (!ctx.isRefresh) {
    keptSearch = '';
    keptInvite = 'all';
  }

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
  let inviteFilter = keptInvite;
  // Each person without a login -> { key, invite }, from the invites already loaded
  let statuses = new Map();

  // Keeps the admin nav badge and the page default in step with the list
  function syncCounts() {
    try {
      ctx.store.invalidatePending?.();
      // A role change can clear a tutor's color: the rest of the portal reloads them
      ctx.store.refreshTutorColors?.();
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
        person.signup_note ? h('blockquote', { class: 'quote ppl-note' }, person.signup_note) : null,
        duplicateWarning(person, name)),
      h('div', { class: 'ppl-approve' },
        h('label', { class: 'ppl-approve-label', for: selectId }, 'Approve as'),
        choice,
        approve));
  }

  // A sign-up that may be someone already added without a login: approving it
  // would make a second, empty account (their lessons and bills are on the
  // first, and the sign-up holds their email). "Use X's account" removes the
  // sign-up and emails them a link to set a password on the first one.
  function duplicateWarning(signup, name) {
    const matches = signupMatches(signup, data.people);
    if (!matches.length) return null;
    const label = (p) => `${displayName(p)} (${roleWord(p.role)})`;
    const [top] = matches;
    const title = matches.length > 1
      ? `This may be ${matches.map(({ person }) => label(person)).join(' or ')}, added without a login`
      : top.exact
        ? `${label(top.person)} is already in the portal, added without a login`
        : `This may be ${label(top.person)}, added without a login`;
    const to = signup.email ?? 'their email';
    const warnIcon = icon('warning-circle', { size: 20 });
    warnIcon.classList.add('callout-icon');
    const actions = matches.map(({ person: p, exact }) => {
      const pname = displayName(p);
      const use = button({
        label: `Use ${pname}’s account`,
        size: 'sm',
        variant: exact && matches.length === 1 ? 'primary' : 'secondary',
        icon: 'envelope-simple',
        focusKey: `use-${signup.id}-${p.id}`,
        onClick: async () => {
          const same = pname.toLowerCase() === name.toLowerCase();
          const ok = await ctx.confirm({
            title: same ? `Use the account you set up for ${name}?` : `Use ${pname}’s account for ${name}?`,
            body: `This sign-up will be removed, and ${to} gets an email with a link to set a password on ${same ? 'the account you set up' : `${pname}’s account`}, where their lessons and bills already are.`,
            confirmLabel: 'Remove sign-up and email the link',
          });
          if (!ok || !ctx.alive()) return;
          const li = use.closest('li');
          const near = li?.nextElementSibling ?? li?.previousElementSibling;
          const focus = { key: `invite-${p.id}`, fallback: near?.querySelector('button[data-focus-key^="approve-"]')?.dataset.focusKey ?? null };
          await busy(use, 'Sending…', async () => {
            const { status, body } = await peopleApi({ action: 'use_signup', signup_id: signup.id, profile_id: p.id });
            if (!ctx.alive()) return;
            if (status === 200) {
              say(`Removed ${name}’s sign-up and emailed ${body.to ?? to} a link to ${pname}’s account. Once they choose a password, they sign in there.`, 'success');
            } else if (status === 502) {
              say(`Removed ${name}’s sign-up, but the email didn’t send. Use Invite on ${pname}’s row under Everyone to send a new link.`, 'error');
            } else {
              const why = status === 409 ? 'this changed since the page loaded. Refresh and try again.'
                : status === 503 ? 'email is not set up, so nothing was changed.'
                  : status === 401 ? 'sign in again as an admin.' : 'please try again.';
              say(`That didn’t work: ${why}`, 'error');
              return;
            }
            await render(focus);
            syncCounts();
          });
        },
      });
      use.setAttribute('aria-label', `Use ${pname}’s account for ${name}`);
      return use;
    });
    return h('div', { class: 'callout tone-warning ppl-dupe', role: 'note' },
      warnIcon,
      h('div', { class: 'callout-body' },
        h('p', { class: 'callout-title' }, title),
        h('p', { class: 'callout-text' }, `Their lessons and bills are on that account, so approving this sign-up would give them a second, empty one. Use their account instead: this sign-up is removed and ${to} gets a link to set a password on it. If it’s someone else, approve as usual.`),
        h('div', { class: 'callout-actions' }, ...actions)));
  }

  // -------------------------------------------------------------------------
  // Everyone

  let everyone = null; // { input, seg, list, count } built once per mount

  function drawEveryone() {
    const counts = roleCounts(data.people);
    statuses = inviteStatuses(data.people, data.invites, Date.now());
    // With nobody left without a login the chips are gone: never leave a filter on that hides the list
    if (!hasNoLoginPeople(statuses)) {
      inviteFilter = 'all';
      keptInvite = 'all';
    }
    if (!everyone) buildEveryone();
    updateSegmentCounts(counts);
    updateInviteBar();
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
        updateInviteBar();
        fillEveryone();
      },
    });
    for (const btn of seg.querySelectorAll('button[data-value]')) btn.dataset.focusKey = `ppl-filter-${btn.dataset.value}`;

    const list = h('div', { class: 'ppl-everyone' });
    const status = h('p', { class: 'visually-hidden', role: 'status' });
    const adder = addWithoutLogin();
    const invites = buildInviteBar();
    const toolbar = h('div', { class: 'ppl-toolbar' },
      h('div', { class: 'ppl-search' },
        h('label', { class: 'visually-hidden', for: inputId }, 'Find a person'),
        h('span', { class: 'input-icon' }, icon('magnifying-glass'), input)),
      h('div', { class: 'ppl-filter-wrap' }, seg),
      invites.el,
      adder);
    everyone = { input, seg, list, status, countSpans, toolbar, invites };
    root.replaceChildren(toolbar, status, list);
  }

  // The Invites row: toggle chips with counts, and a sentence above the list
  // that says how many people have no login and how far their invites have got.
  // Built once and updated in place, so a focused chip stays focused.
  function buildInviteBar() {
    const countSpans = {};
    const chips = INVITE_FILTERS.map((f) => {
      countSpans[f] = h('span', { class: 'ppl-invchip-count num' });
      return h('button', {
        type: 'button',
        class: 'ppl-invchip',
        'aria-pressed': 'false',
        dataset: { value: f, focusKey: `ppl-invite-filter-${f}` },
        // Pressing the chip that is on turns the filter off
        onClick: () => chooseInvite(f === 'all' || inviteFilter === f ? 'all' : f),
      }, INVITE_FILTER_LABELS[f], h('span', { class: 'ppl-invchip-meta' }, visuallyHidden(', '), countSpans[f]));
    });
    const group = h('div', { class: 'ppl-invchips', role: 'group', 'aria-label': 'Filter by invite status' }, chips);
    const summary = h('p', { class: 'ppl-invite-summary' });
    const el = h('div', { class: 'ppl-invites', hidden: true },
      h('div', { class: 'ppl-invites-row' }, h('span', { class: 'ppl-invites-label', 'aria-hidden': 'true' }, 'Invites'), group),
      summary);
    return { el, group, countSpans, summary };
  }

  // Counts, pressed chip and sentence, from the statuses and the role filter.
  // The chips show only while someone has no login.
  function updateInviteBar() {
    const bar = everyone.invites;
    bar.el.hidden = !hasNoLoginPeople(statuses);
    const counts = inviteCounts(data.people, statuses, role);
    for (const f of INVITE_FILTERS) bar.countSpans[f].textContent = String(counts[f]);
    for (const btn of bar.group.querySelectorAll('button[data-value]')) {
      btn.setAttribute('aria-pressed', btn.dataset.value === inviteFilter ? 'true' : 'false');
    }
    const text = inviteSummary(counts, role);
    bar.summary.textContent = text ?? '';
    bar.summary.hidden = !text;
  }

  // People just added have no invite, so a filter that would hide them is turned off
  function showAllInvites() {
    if (inviteFilter === 'invited' || inviteFilter === 'expired') {
      inviteFilter = 'all';
      keptInvite = 'all';
    }
  }

  function chooseInvite(value) {
    inviteFilter = value;
    keptInvite = value;
    updateInviteBar();
    fillEveryone();
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
        showAllInvites();
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
      showAllInvites();
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
    const first = statuses.get(person.id);
    if (!first) return null;
    const name = displayName(person);
    const panel = h('div', { class: 'ppl-invite-panel', hidden: true });
    const when = (iso) => relativeTime(iso, ctx.now).text.toLowerCase();
    const noteOf = (s) => {
      if (s.key === 'invited') return `Invited ${when(s.invite.created_at)}${s.invite.emailed_to ? `, emailed to ${s.invite.emailed_to}` : ''}`;
      if (s.key === 'expired') return 'Invite expired';
      if (s.key === 'joining') return 'Link used. Reload to see their sign-in.';
      return '';
    };
    // An expired invite is replaced, not added to: the same button, worded for that
    const labelOf = (s) => (s.key === 'invited' ? 'New invite link' : s.key === 'expired' ? 'Send a new invite' : 'Invite');
    const ariaOf = (s) => (s.key === 'invited' ? `New invite link for ${name}` : s.key === 'expired' ? `Send a new invite to ${name}` : `Invite for ${name}`);
    const note = h('span', { class: 'ppl-invite-note' });
    // Makes the link and shows it; the new status, or null when it did not save
    async function makeLink() {
      const token = newInviteToken();
      const token_hash = await sha256Hex(token);
      const { data: rows, error } = await sb.from('portal_invites').insert({ profile_id: person.id, token_hash }).select('id');
      if (!ctx.alive()) return null;
      if (error || !rows?.length) {
        say('That didn’t save: the invite could not be made. Refresh the page and try again.', 'error');
        return null;
      }
      // The chips and the sentence count this link now, though the list is not redrawn while its link is open
      const at = Date.now();
      data.invites.push({
        id: rows[0].id, profile_id: person.id, created_at: new Date(at).toISOString(),
        expires_at: new Date(at + INVITE_DAYS * 86400000).toISOString(), used_at: null, emailed_to: null, emailed_at: null,
      });
      statuses = inviteStatuses(data.people, data.invites, at);
      updateInviteBar();
      showLink(panel, person, token);
      return statuses.get(person.id);
    }
    const make = button({
      label: labelOf(first),
      size: 'sm',
      variant: first.key === 'invited' ? 'ghost' : 'secondary',
      icon: 'envelope-simple',
      focusKey: `invite-${person.id}`,
      onClick: async () => {
        let made = null;
        await busy(make, 'Making a link…', async () => { made = await makeLink(); });
        // busy puts the old label back when it ends, so the new wording goes on after it
        if (made) paint(made);
      },
    });
    function paint(s) {
      note.textContent = noteOf(s);
      note.hidden = !note.textContent;
      make.querySelector('.btn-label').textContent = labelOf(s);
      make.classList.toggle('btn-ghost', s.key === 'invited');
      make.classList.toggle('btn-secondary', s.key !== 'invited');
      make.setAttribute('aria-label', ariaOf(s));
    }
    paint(first);
    return h('div', { class: 'ppl-invite' },
      h('div', { class: 'ppl-invite-row' }, pill({ label: 'No sign-in yet', tone: 'warning', icon: 'clock' }), note, make),
      panel);
  }

  // Where focus goes when emailing a link takes the person out of the filtered
  // list: the next row's Invite button, else the one before, else the chip
  function inviteFocusFallback(person) {
    const own = `invite-${person.id}`;
    const keys = [...everyone.list.querySelectorAll('button[data-focus-key^="invite-"]')].map((b) => b.dataset.focusKey);
    const at = keys.indexOf(own);
    return keys[at + 1] ?? (at > 0 ? keys[at - 1] : null) ?? `ppl-invite-filter-${inviteFilter}`;
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
        await render({ key: `invite-${person.id}`, fallback: inviteFocusFallback(person) });
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
    const groups = peopleIn(filterByInvite(data.people, statuses, inviteFilter), { role, search: input.value });
    const total = groups.reduce((n, g) => n + g.people.length, 0);
    const narrowed = Boolean(input.value.trim()) || inviteFilter !== 'all';
    status.textContent = narrowed ? `${total} ${total === 1 ? 'person' : 'people'} found` : '';

    if (!groups.length) {
      const counts = roleCounts(data.people);
      let text;
      if (input.value.trim()) text = inviteFilter === 'all' ? 'Nobody matches that search.' : 'Nobody matches that search and invite filter.';
      else if (inviteFilter !== 'all') text = inviteEmptyText(inviteFilter, role);
      else if (role === 'all' || !counts[role]) text = role === 'all' ? 'Nobody has joined yet.' : `No ${GROUP_NOUNS[role]} yet.`;
      list.replaceChildren(emptyState({ icon: 'users-three', text }));
      restoreFocus(focus);
      return;
    }

    // An admin can also be a student's tutor (marked in the add list)
    const tutors = data.people.filter((p) => p.role === 'tutor' || p.role === 'admin').sort(byName);
    const parents = data.people.filter((p) => p.role === 'parent').sort(byName);
    const students = data.people.filter((p) => p.role === 'student').sort(byName);
    let n = 0;
    const animate = firstRender && !ctx.isRefresh;
    colorControls.clear();
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

  // Staff rows: the color this person's lessons wear on every calendar. The
  // select saves at once, with a toast; a refusal shows under it and puts the
  // old choice back. `colorControls` lets one save repaint every row, because an
  // automatic color depends on the colors the others were given.
  const colorControls = new Map();

  function paintColor(control, colors) {
    const state = pickerState(control.person, colors);
    control.sel.options[0].textContent = automaticLabel(state.automatic);
    control.sel.value = state.chosen ?? '';
    control.swatch.className = `ppl-color-swatch ${toneClassFor(state.shown)}`;
  }

  function paintColors() {
    const colors = chosenColors(data.people);
    for (const control of colorControls.values()) paintColor(control, colors);
  }

  function colorControl(person, name) {
    const swatch = h('span', { class: 'ppl-color-swatch', 'aria-hidden': 'true' });
    const error = h('p', { class: 'ppl-color-error', role: 'alert' });
    const wrap = select({
      id: uid('ppl-color'),
      label: `Calendar color for ${name}`,
      size: 'sm',
      options: colorOptions(),
    });
    const sel = wrap.firstElementChild;
    sel.dataset.focusKey = `color-${person.id}`;
    // Where the browser lets a menu item be colored (not Safari), each name wears its own color
    for (const option of sel.options) if (option.value) option.className = toneClassFor(option.value);
    const control = { person, sel, swatch };
    colorControls.set(person.id, control);
    sel.addEventListener('change', async () => {
      const next = sel.value || null;
      error.textContent = '';
      sel.disabled = true;
      let failure = null;
      try {
        const result = await sb.from('profiles').update({ calendar_color: next }).eq('id', person.id).select('id, calendar_color');
        if (result.error) failure = result.error.message || 'please try again.';
        else if (!result.data?.length) failure = 'nothing changed. Refresh the page and try again.';
        else person.calendar_color = result.data[0].calendar_color ?? null;
      } catch {
        failure = 'please try again.';
      }
      if (!ctx.alive()) return;
      sel.disabled = false;
      sel.focus({ preventScroll: true });
      paintColors();
      if (failure) {
        error.textContent = `That didn’t save: ${failure}`;
        return;
      }
      try {
        ctx.store.refreshTutorColors();
      } catch {
        // older store: other pages pick the color up on the next load
      }
      ctx.toast({ text: colorSavedText(name, next) });
    });
    paintColor(control, chosenColors(data.people));
    return h('div', { class: 'ppl-color' },
      h('span', { class: 'ppl-color-label', 'aria-hidden': 'true' }, 'Calendar color'),
      h('span', { class: 'ppl-color-pick' }, swatch, wrap),
      error);
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

  // Where focus goes when a row leaves the list: the next row's Delete button,
  // else the one before, else the search box
  function deleteFocusFallback(person) {
    const keys = [...everyone.list.querySelectorAll('button[data-focus-key^="delete-"]')].map((b) => b.dataset.focusKey);
    const at = keys.indexOf(`delete-${person.id}`);
    return keys[at + 1] ?? (at > 0 ? keys[at - 1] : null) ?? 'ppl-search';
  }

  // Delete a person for good: what would go (the server counts it), the confirm
  // dialog with the name typed back, then the delete. The server refuses anything
  // that must stay (payments, paid lessons, admins); its words are shown as they come.
  async function removePerson(person, trigger) {
    let preview = null;
    await busy(trigger, 'Checking…', async () => {
      const { status, body } = await peopleApi({ action: 'delete_preview', id: person.id });
      if (!ctx.alive()) return;
      if (status !== 200) {
        if (status === 404) await render();
        say(problemText(status, body), 'error');
        return;
      }
      preview = normalizePreview(body);
    });
    if (!preview || !ctx.alive()) return;

    if (preview.blocked) {
      await ctx.confirm({ title: blockedTitle(person), body: preview.blocked.message, confirmLabel: null });
      return;
    }
    const ok = await ctx.confirm({
      title: deleteTitle(person),
      body: headline(person, preview.counts),
      details: detailLines(preview),
      requireText: { label: typedLabel(person), match: (typed) => nameMatches(typed, person) },
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;

    // Once confirmed it goes through even if a refresh swapped the page meanwhile
    const next = ctx.alive() ? deleteFocusFallback(person) : null;
    let answer = { status: 0, body: {} };
    await busy(trigger, 'Deleting…', async () => {
      answer = await peopleApi({ action: 'delete_person', id: person.id, confirm_name: confirmName(person) });
    });
    const { status, body } = answer;

    if (status !== 200 || !body.deleted) {
      if (!ctx.alive()) {
        ctx.toast({ text: problemText(status, body) });
        return;
      }
      // Redraw first so the list shows what the database really holds, then say why
      if (status === 404 || status === 409) await render({ key: `delete-${person.id}`, fallback: next });
      if (!ctx.alive()) return;
      say(problemText(status, body), 'error');
      message.scrollIntoView({ block: 'center' });
      return;
    }

    ctx.toast({ text: doneText(person) });
    if (ctx.alive()) {
      // The row goes now; the refresh the store change starts then loads the truth
      data = withoutPerson(data, person.id);
      setPendingCount(data.people.filter((p) => p.role === 'pending').length);
      drawEveryone();
      restoreFocus({ key: next, fallback: 'ppl-search' });
    }
    // Every cached list, count and switcher is dropped and the page redrawn; other tabs do the same
    ctx.store.invalidateAll();
    announceDataChanged();
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

    // Tutors and admins get a calendar color (once the column exists)
    const staffColor = (person.role === 'tutor' || person.role === 'admin') && person.calendar_color !== undefined
      ? colorControl(person, name) : null;

    // Anyone but an admin can be deleted for good (after a preview and the name typed back)
    const remove = canDelete(person, me)
      ? button({
        label: 'Delete',
        variant: 'danger-ghost',
        size: 'sm',
        icon: 'trash',
        className: 'ppl-delete',
        focusKey: `delete-${person.id}`,
        ariaLabel: `Delete ${name}`,
        onClick: () => removePerson(person, remove),
      })
      : null;

    return h('li', { class: isStudent ? 'ppl-person is-student' : 'ppl-person' },
      h('div', { class: 'ppl-person-head' },
        avatar(name, { size: 32 }),
        h('div', { class: 'ppl-id' },
          nameField(person, name, self),
          person.email && person.email !== name && !person.no_login ? h('span', { class: 'ppl-email' }, person.email) : null,
          detail,
          staffColor),
        h('div', { class: 'ppl-controls' }, workspace, roleSelect(person), remove)),
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
