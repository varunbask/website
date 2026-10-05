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
