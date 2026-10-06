// Who still needs an invite (People > Everyone). No DOM.
//
// A person added without a login (profiles.no_login) is in one of four
// states, from their latest portal_invites row (the latest created wins):
//   needs    no invite yet
//   invited  an invite that is unused and has not expired
//   expired  the latest invite went unused past its expires_at
//   joining  the latest invite was used but the profile still says no_login:
//            they joined and the page has not caught up (or the join is still
//            finishing). Not counted as waiting for a login.
// Anyone with a login (or a role that never lacks one) has no status, and an
// expiry is an instant compared with the clock, so no time zone is involved.

import { inviteState } from './invites-model.js';

// The chips, in the order shown ('all' turns the filter off)
export const INVITE_FILTERS = Object.freeze(['needs', 'invited', 'expired', 'all']);

export const INVITE_FILTER_LABELS = Object.freeze({
  needs: 'Needs an invite',
  invited: 'Invited, not joined',
  expired: 'Invite expired',
  all: 'All',
});

// A filter that is not one of the chips means no filter
export const normalizeInviteFilter = (filter) => (INVITE_FILTERS.includes(filter) ? filter : 'all');

const KEY_OF = { none: 'needs', open: 'invited', expired: 'expired', used: 'joining' };

// The roles that can be added without a login, and so invited
const INVITABLE = ['student', 'parent'];

function statusFrom(person, mine, now) {
  if (!person?.no_login || !INVITABLE.includes(person.role)) return null;
  const state = inviteState(mine, now);
  return { key: KEY_OF[state.key], invite: state.invite };
}

// { key, invite } for one person, or null when they are not waiting on a login.
// `invites` is every portal_invites row, or just this person's.
export function inviteStatus(person, invites, now = Date.now()) {
  return statusFrom(person, (invites ?? []).filter((i) => i.profile_id === person?.id), now);
}

// Everyone's status in one pass over the invites: Map(profile id -> { key, invite }),
// only for people without a login. The page loads the invites once, so no
// query per person.
export function inviteStatuses(people, invites, now = Date.now()) {
  const byProfile = new Map();
  for (const invite of invites ?? []) {
    if (!byProfile.has(invite.profile_id)) byProfile.set(invite.profile_id, []);
    byProfile.get(invite.profile_id).push(invite);
  }
  const out = new Map();
  for (const person of people ?? []) {
    const status = statusFrom(person, byProfile.get(person?.id) ?? [], now);
    if (status) out.set(person.id, status);
  }
  return out;
}

// What each chip shows, for the people in `role` ('all' or one role) who have
// a real role (not waiting for approval):
//   needs, invited, expired  how many are in each state
//   waiting                  needs + invited + expired: no login yet
//   all                      everyone in that role, with or without a login
export function inviteCounts(people, statuses, role = 'all') {
  const counts = { needs: 0, invited: 0, expired: 0, waiting: 0, all: 0 };
  for (const p of people ?? []) {
    if (!p || p.role === 'pending' || (role !== 'all' && p.role !== role)) continue;
    counts.all += 1;
    const key = statuses?.get(p.id)?.key;
    if (key === 'needs' || key === 'invited' || key === 'expired') {
      counts[key] += 1;
      counts.waiting += 1;
    }
  }
  return counts;
}

// Is any person waiting on a login, or just joined? The chips are only worth
// showing then.
export const hasNoLoginPeople = (statuses) => (statuses?.size ?? 0) > 0;

// The people whose status is `filter` ('all' keeps everyone)
export function filterByInvite(people, statuses, filter) {
  const want = normalizeInviteFilter(filter);
  if (want === 'all') return people ?? [];
  return (people ?? []).filter((p) => statuses?.get(p.id)?.key === want);
}

const NOUNS = {
  all: ['person', 'people'],
  student: ['student', 'students'],
  parent: ['parent', 'parents'],
};

// "12 people have no login yet: 5 need an invite, 6 invited, 1 expired."
// Parts with nobody in them are left out. Null for roles that always have a
// login (tutors and admins), so the page shows no sentence for them.
export function inviteSummary(counts, role = 'all') {
  const nouns = NOUNS[role];
  if (!nouns) return null;
  const { needs, invited, expired, waiting } = counts;
  if (!waiting) return role === 'all' ? 'Everyone has a login.' : `Every ${nouns[0]} has a login.`;
  const parts = [
    needs ? `${needs} ${needs === 1 ? 'needs' : 'need'} an invite` : null,
    invited ? `${invited} invited` : null,
    expired ? `${expired} expired` : null,
  ].filter(Boolean);
  return `${waiting} ${nouns[waiting === 1 ? 0 : 1]} ${waiting === 1 ? 'has' : 'have'} no login yet: ${parts.join(', ')}.`;
}

// The empty list under an invite filter: "No parents need an invite."
export function inviteEmptyText(filter, role = 'all') {
  const who = { all: 'Nobody', student: 'No students', parent: 'No parents' }[role] ?? 'Nobody';
  const plural = who !== 'Nobody';
  switch (normalizeInviteFilter(filter)) {
    case 'needs': return `${who} ${plural ? 'need' : 'needs'} an invite.`;
    case 'invited': return `${who} ${plural ? 'have' : 'has'} an invite waiting to be used.`;
    case 'expired': return `${who} ${plural ? 'have' : 'has'} an expired invite.`;
    default: return null;
  }
}
