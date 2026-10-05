// Pure logic for the admin Referrals list (views/referrals.js). No DOM.

const LANGUAGE_NAMES = { en: 'English', zh: 'Chinese', es: 'Spanish', fr: 'French', ko: 'Korean' };
export const languageName = (code) => LANGUAGE_NAMES[code] ?? 'English';

// Newest first
export function sortReferrals(list) {
  return [...(list ?? [])].sort((a, b) => (Date.parse(b.created_at) - Date.parse(a.created_at)) || (Number(b.id) - Number(a.id)));
}

// { fresh, approved, declined }, each newest first
export function groupReferrals(list) {
  const sorted = sortReferrals(list);
  return {
    fresh: sorted.filter((r) => r.status !== 'approved' && r.status !== 'declined'),
    approved: sorted.filter((r) => r.status === 'approved'),
    declined: sorted.filter((r) => r.status === 'declined'),
  };
}

// "Referred by Grace Lin, a parent"
export function referrerLine(r) {
  const who = r.referrer_role === 'student' ? 'a student' : 'a parent';
  return `Referred by ${r.referrer_name}, ${who}`;
}
