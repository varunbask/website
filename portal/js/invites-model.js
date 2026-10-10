// Words and links for portal invites (People and portal/join.html). No DOM.

import { base64url, SITE } from './reviews-model.js';

export const INVITE_DAYS = 30;

// 32 random bytes, base64url (the review links use the same shape)
export function newInviteToken(random = globalThis.crypto) {
  return base64url(random.getRandomValues(new Uint8Array(32)));
}

// The token goes after #: it never reaches a server log or the next site's Referer
export function inviteLink(token, site = SITE) {
  return `${site}/portal/join.html#t=${token}`;
}

const first = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'there';

// "Maya", "Maya and Leo", "Maya, Leo and Ava"
export function namesText(names) {
  const list = (names ?? []).map(first).filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

// A message the admin can paste into a text
export function inviteMessage(name, link, { role = 'parent', children = [] } = {}) {
  const kids = namesText(children);
  const what = role === 'parent' && kids ? `${kids}’s lessons, homework and monthly statements` : 'your lessons, homework and progress';
  return `Hi ${first(name)}, your VP Education Group portal account is ready. Set your email and password here to see ${what}: ${link} (the link works once, for ${INVITE_DAYS} days)`;
}

// The token from '#t=...' (or '?t=...'), or null
export function readToken(loc) {
  const from = (s) => new URLSearchParams(String(s ?? '').replace(/^[#?]/, '')).get('t');
  const t = from(loc?.hash) ?? from(loc?.search);
  return t && /^[A-Za-z0-9_-]{32,64}$/.test(t) ? t : null;
}

// The join page's welcome, from GET /api/people
export function joinCopy({ name, role, children = [] } = {}) {
  const kids = namesText(children);
  const lede = role === 'parent' && kids
    ? `VP Education Group set up an account for you. Choose the email and password you will sign in with, then see ${kids}’s lessons, homework and monthly statements.`
    : 'VP Education Group set up an account for you. Choose the email and password you will sign in with, then see your lessons, homework and progress.';
  return { first: first(name), lede };
}

export function joinProblem(kind) {
  if (kind === 'used') return { title: 'This link was already used', text: 'Your account is set up. Sign in with the email and password you chose, or use Forgot your password on the sign-in page.' };
  if (kind === 'expired') return { title: 'This link has expired', text: 'Links work for 30 days. Ask VP Education Group to send you a new one.' };
  if (kind === 'offline') return { title: 'We couldn’t reach the portal', text: 'Check your connection, then open the link again.' };
  return { title: 'This link doesn’t work', text: 'Make sure you opened the whole link from your message, or ask VP Education Group for a new one.' };
}

export function joinError(status, body = {}) {
  if (status === 409) return 'That email already has a portal account. Use a different email, or email vbmgroupsllc@gmail.com and we will sort it out.';
  if (status === 422 && body.errors?.email) return 'Enter a valid email address.';
  if (status === 422 && body.errors?.password === 'weak') return 'Choose a stronger password: mix letters, numbers and symbols.';
  if (status === 422 && body.errors?.password) return 'Use a password of 8 to 72 characters.';
  return 'Something went wrong. Try again in a moment.';
}

// The state of a person's latest invite: 'none' | 'open' | 'used' | 'expired'
// (created_at is compared as an instant, so rows written with different offsets still order)
export function inviteState(invites, now = Date.now()) {
  const latest = (invites ?? []).reduce((best, i) => (!best || Date.parse(i.created_at) > Date.parse(best.created_at) ? i : best), null);
  if (!latest) return { key: 'none', invite: null };
  if (latest.used_at) return { key: 'used', invite: latest };
  if (Date.parse(latest.expires_at) < now) return { key: 'expired', invite: latest };
  return { key: 'open', invite: latest };
}

// ---------------------------------------------------------------------------
// Add from a list: the old scheduler's lines, "Amy (Ryan): Math $45",
// "Mason (Sunny)" or just "Amy". Anything after ":" (the rates) is ignored here.

export const NAME_MAX = 120;
const normName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const lower = (s) => normName(s).toLowerCase();

// -> { rows: [{ line, student, parent }], errors: [{ line, error }] }
export function parseFamilyLines(text) {
  const rows = [];
  const errors = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^():]+?)\s*(?:\(([^()]*)\))?\s*(?::.*)?$/.exec(line);
    const student = normName(m?.[1]);
    const parent = normName(m?.[2]) || null;
    if (!m || !student) {
      errors.push({ line, error: 'Write it as Student (Parent)' });
      continue;
    }
    if (student.length > NAME_MAX || (parent && parent.length > NAME_MAX)) {
      errors.push({ line, error: `Names can be at most ${NAME_MAX} characters` });
      continue;
    }
    rows.push({ line, student, parent });
  }
  return { rows, errors };
}

// Who to add, who is already in the portal and which parent links to make.
// An account is reused only on an exact full-name match with the same role; a
// first-name-only match ("Grace" when "Grace Lin" exists) is flagged instead,
// so a child is never linked to the wrong family's parent.
//   people: [{ id, full_name, role }]  parentLinks: [{ parent_id, student_id }]
// -> { add: [{ key, name, role }], found: [{ key, name, role, id }],
//      links: [{ parent, student }] (keys), problems: [{ line, reason }] }
export function planFamilies(rows, { people = [], parentLinks = [] } = {}) {
  const resolve = (name, role) => {
    const exact = people.filter((p) => p.role === role && lower(p.full_name) === lower(name));
    // Notes in brackets are not part of a name: "Grace" may also be "Grace (Gordon's Mom)"
    const alike = people.filter((p) => p.role === role && bareName(p.full_name) === bareName(name));
    if (exact.length === 1 && alike.length === 1) return { key: `id:${exact[0].id}`, name: normName(exact[0].full_name), role, id: String(exact[0].id) };
    if (exact.length > 1) return { reason: `There are ${exact.length} ${role}s named ${name} in the portal; link this one by hand` };
    if (alike.length > 1) {
      return { reason: `There are ${alike.length} ${role}s named like ${name} in the portal (${alike.map((p) => normName(p.full_name)).join(' or ')}); link this one by hand on People` };
    }
    if (alike.length === 1) return { reason: `Is this ${normName(alike[0].full_name)}? Link them by hand on People to use that account` };
    const nameFirst = lower(name).split(' ')[0];
    const near = people.filter((p) => p.role === role && lower(p.full_name).split(' ')[0] === nameFirst);
    if (near.length) return { reason: `Is this ${near.map((p) => normName(p.full_name)).join(' or ')}? Write the full name to use that account` };
    return { key: `new:${role}:${lower(name)}`, name, role };
  };
  const add = new Map();
  const found = new Map();
  const links = new Map();
  const problems = [];
  for (const row of rows) {
    const student = resolve(row.student, 'student');
    const parent = row.parent ? resolve(row.parent, 'parent') : null;
    const reason = student.reason ?? parent?.reason;
    if (reason) {
      problems.push({ line: row.line, reason });
      continue;
    }
    for (const who of [student, parent].filter(Boolean)) {
      if (who.id) found.set(who.key, who);
      else if (!add.has(who.key)) add.set(who.key, { key: who.key, name: who.name, role: who.role });
    }
    if (!parent) continue;
    const linked = parent.id && student.id && parentLinks.some((l) => String(l.parent_id) === parent.id && String(l.student_id) === student.id);
    if (!linked) links.set(`${parent.key}|${student.key}`, { parent: parent.key, student: student.key });
  }
  return { add: [...add.values()], found: [...found.values()], links: [...links.values()], problems };
}

// ---------------------------------------------------------------------------
// A sign-up waiting for approval that may be someone already added without a
// login (their lessons and bills are on that account, so the sign-up would be
// a second, empty one). Only students and parents of the role they asked for
// (any of the two when they asked for none). Notes in brackets are left out of
// names ("Grace (Gordon's Mom)" is "Grace"). A person matches when:
//   'email'  a link to their account was already emailed to the sign-up's address
//   'name'   the same full name
//   'first'  the same first name, when one of the two names is only a first name
//            ("Amy" and "Amy Chen"); two different surnames never match
// Several people can match ("Grace" twice): People then shows each one's family,
// and nobody is picked for the admin.
// -> [{ person, exact, reason }], strongest first

// A name without notes in brackets, lower case: "Grace (Gordon's Mom)" -> "grace"
export function bareName(name) {
  return lower(String(name ?? '').replace(/\([^()]*\)/g, ' '));
}

const REASON_RANK = { email: 0, name: 1, first: 2 };

export function signupMatches(signup, people = [], { invites = [] } = {}) {
  const wanted = signup?.requested_role;
  if (wanted && !['student', 'parent'].includes(wanted)) return [];
  const name = bareName(signup?.full_name);
  const email = lower(signup?.email);
  if (!name && !email) return [];
  const words = name.split(' ');
  const emailedTo = new Set((invites ?? [])
    .filter((i) => email && lower(i.emailed_to) === email)
    .map((i) => String(i.profile_id)));
  const out = [];
  for (const p of people) {
    if (!p.no_login || !['student', 'parent'].includes(p.role) || (wanted && p.role !== wanted) || p.id === signup.id) continue;
    const other = bareName(p.full_name);
    const otherWords = other.split(' ');
    let reason = null;
    if (emailedTo.has(String(p.id))) reason = 'email';
    else if (name && other && other === name) reason = 'name';
    else if (name && other && otherWords[0] === words[0] && (words.length === 1 || otherWords.length === 1)) reason = 'first';
    if (reason) out.push({ person: p, exact: reason !== 'first', reason });
  }
  return out.sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason]
    || lower(a.person.full_name).localeCompare(lower(b.person.full_name))).slice(0, 5);
}

// The accounts an admin may pick by hand for a sign-up (the role they asked
// for, or any student or parent), in name order -> [person]
export function signupChoices(signup, people = []) {
  const wanted = signup?.requested_role;
  if (wanted && !['student', 'parent'].includes(wanted)) return [];
  return people
    .filter((p) => p.no_login && ['student', 'parent'].includes(p.role) && (!wanted || p.role === wanted) && p.id !== signup?.id)
    .sort((a, b) => lower(a.full_name).localeCompare(lower(b.full_name)));
}

// What the admin types to confirm a pick that is not certain: the first name of
// the account's (first) child for a parent, else the account's first name.
// -> { word, what } ("Gordon", "the child's first name")
export function confirmWordFor(person, family = []) {
  const firstOf = (n) => normName(String(n ?? '').replace(/\([^()]*\)/g, ' ')).split(' ')[0] ?? '';
  const kid = family.map(firstOf).find(Boolean);
  if (person?.role === 'parent' && kid) return { word: kid, what: 'the child’s first name' };
  return { word: firstOf(person?.full_name) || normName(person?.full_name), what: 'their first name' };
}

// Whether typed text matches a confirm word. Case, spaces, accents and the
// kind of apostrophe do not matter ("zoe" confirms "Zoë", "d'angelo" "D’Angelo")
const fold = (s) => lower(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2018\u2019\u02bc`]/g, "'");
export const confirmMatches = (typed, word) => Boolean(fold(word)) && fold(typed) === fold(word);

// Who an account belongs with, so two people with one name can be told apart:
//   parent:  "Parent of Gordon; pays for Gordon", "Parent of Camila and Leo",
//            "No children linked yet"
//   student: "Student; parent Grace Young", "Student; no parent linked yet"
// children / parents: names; paying: the children whose bills this parent pays
export function familyText({ role, children = [], paying = [], parents = [] } = {}) {
  const list = (names) => (names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
  if (role === 'parent') {
    if (!children.length) return 'No children linked yet';
    return `Parent of ${list(children)}${paying.length ? `; pays for ${list(paying)}` : ''}`;
  }
  if (!parents.length) return 'Student; no parent linked yet';
  return `Student; ${parents.length === 1 ? 'parent' : 'parents'} ${list(parents)}`;
}
