// Pure logic for People > Reviews (views/reviews.js). No DOM.
//
// A review link: { id, name, kind, created_at, expires_at, used_at }
// A review: { id, invite_id, kind, name, quote, translations, status, created_at, reviewed_at }

export const LANG_LABELS = Object.freeze({ en: 'English', zh: 'Chinese', es: 'Spanish', fr: 'French', ko: 'Korean' });
export const SITE = 'https://www.varunbaskaran.com';

const newestFirst = (a, b) => (Date.parse(b.created_at) - Date.parse(a.created_at)) || (Number(b.id) - Number(a.id));

// { pending, approved, declined }, newest first
export function groupReviews(list) {
  const sorted = [...(list ?? [])].sort(newestFirst);
  return {
    pending: sorted.filter((r) => r.status !== 'approved' && r.status !== 'declined'),
    approved: sorted.filter((r) => r.status === 'approved'),
    declined: sorted.filter((r) => r.status === 'declined'),
  };
}

// 'unused' | 'used' | 'expired'
export function linkState(invite, now = Date.now()) {
  if (invite.used_at) return 'used';
  if (Date.parse(invite.expires_at) < now) return 'expired';
  return 'unused';
}

// Links still waiting for a review first, then the rest, newest first
export function sortLinks(list, now = Date.now()) {
  const rank = { unused: 0, used: 1, expired: 2 };
  return [...(list ?? [])].sort((a, b) => (rank[linkState(a, now)] - rank[linkState(b, now)]) || newestFirst(a, b));
}

// The versions an admin reads before approving: English first
export function versions(review) {
  const tr = review?.translations;
  if (!tr || typeof tr !== 'object') return [];
  return Object.keys(LANG_LABELS).filter((l) => typeof tr[l] === 'string' && tr[l]).map((l) => ({ lang: l, label: LANG_LABELS[l], text: tr[l] }));
}

// 32 random bytes as base64url (43 characters)
export function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function reviewLink(token, site = SITE) {
  return `${site}/review.html?t=${token}`;
}

// A message the admin can paste into a text or email
export function inviteMessage(name, link) {
  const first = String(name ?? '').trim().split(/\s+/)[0] || 'there';
  return `Hi ${first}, would you write a short review of your experience with VP Education Group? It only takes a minute: ${link}`;
}
