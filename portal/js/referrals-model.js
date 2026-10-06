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

// Rows come from two forms on the landing page: "Refer a family" (kind
// 'referral', also what rows from before the kind column count as) and "Book
// a free consultation" (kind 'consultation', the person asking is the family).
export const isConsultation = (r) => r?.kind === 'consultation';
export const kindLabel = (r) => (isConsultation(r) ? 'Consultation' : 'Referral');

const LESSON_LABELS = { online: 'Online', in_person: 'In person', either: 'Online or in person' };
const CONTACT_LABELS = { email: 'Email', phone: 'Phone call', text: 'Text message', wechat: 'WeChat', kakaotalk: 'KakaoTalk' };
export const lessonsLabel = (code) => LESSON_LABELS[code] ?? null;
export const contactPrefLabel = (code) => CONTACT_LABELS[code] ?? null;

// A referral is approved or declined; a consultation request is only handled.
// `status` is what the table stores (approved), `done` the word for toasts.
export function decisionWords(r) {
  return isConsultation(r)
    ? { approve: 'Mark as handled', done: { approved: 'marked as handled', new: 'moved back to New' } }
    : { approve: 'Approve', done: { approved: 'approved', declined: 'declined', new: 'moved back to New' } };
}

// "Referred by Grace Lin, a parent"
export function referrerLine(r) {
  const who = r.referrer_role === 'student' ? 'a student' : 'a parent';
  return `Referred by ${r.referrer_name}, ${who}`;
}
