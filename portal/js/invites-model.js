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
export function inviteState(invites, now = Date.now()) {
  const latest = (invites ?? []).reduce((best, i) => (!best || i.created_at > best.created_at ? i : best), null);
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
    const same = people.filter((p) => p.role === role && lower(p.full_name) === lower(name));
    if (same.length === 1) return { key: `id:${same[0].id}`, name: normName(same[0].full_name), role, id: String(same[0].id) };
    if (same.length > 1) return { reason: `There are ${same.length} ${role}s named ${name} in the portal; link this one by hand` };
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
// (any of the two when they asked for none); the same full name, or the same
// first name when one of the two names is only a first name ("Amy" and
// "Amy Chen"). Two different surnames never match.
// -> [{ person, exact }], exact matches first
export function signupMatches(signup, people = []) {
  const wanted = signup?.requested_role;
  if (wanted && !['student', 'parent'].includes(wanted)) return [];
  const name = lower(signup?.full_name);
  if (!name) return [];
  const words = name.split(' ');
  const out = [];
  for (const p of people) {
    if (!p.no_login || !['student', 'parent'].includes(p.role) || (wanted && p.role !== wanted) || p.id === signup.id) continue;
    const other = lower(p.full_name);
    if (!other) continue;
    const otherWords = other.split(' ');
    if (other === name) out.push({ person: p, exact: true });
    else if (otherWords[0] === words[0] && (words.length === 1 || otherWords.length === 1)) out.push({ person: p, exact: false });
  }
  return out.sort((a, b) => Number(b.exact) - Number(a.exact) || lower(a.person.full_name).localeCompare(lower(b.person.full_name))).slice(0, 3);
}
