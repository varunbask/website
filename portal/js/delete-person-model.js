// Deleting a person (People > Everyone, admin): the words of the confirm
// dialog, the typed-name guard and the list left behind. Pure; no DOM.
// The server side is api/_lib/people-delete.js (POST /api/people, actions
// delete_preview and delete_person); its refusal messages are shown as they come.

export const CAN_DELETE_ROLES = Object.freeze(['student', 'parent', 'tutor']);
export const NAMES_SHOWN = 6;

const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// "1 lesson", "3 lessons"
export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export const firstName = (person) => squash(person?.full_name).split(' ')[0] || squash(person?.email) || 'This person';

// What the admin types: the full name (the address for someone with no name),
// the same rule the server holds them to
export function confirmName(person) {
  return squash(person?.full_name) || squash(person?.email);
}

// Trimmed, spacing squeezed, case ignored
export function nameMatches(typed, person) {
  const expected = confirmName(person).toLowerCase();
  return Boolean(expected) && squash(typed).toLowerCase() === expected;
}

// Rows with a Delete button: anyone but an admin (the server refuses admins and
// your own account too), and only someone the admin can type the name of
export function canDelete(person, me) {
  return Boolean(person) && CAN_DELETE_ROLES.includes(person.role) && person.id !== me?.id && Boolean(confirmName(person));
}

const ZERO = Object.freeze({
  sessions: 0, upcoming_sessions: 0, assignments: 0, tasks: 0, submissions: 0, drafts: 0, files: 0, updates: 0,
  series: 0, rates: 0, links: 0, invites: 0, statements: 0,
});

// The preview body from the server with every field present
export function normalizePreview(body) {
  const counts = { ...ZERO };
  for (const key of Object.keys(ZERO)) {
    const n = Number(body?.counts?.[key]);
    counts[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return {
    person: body?.person ?? null,
    counts,
    lessons: Array.isArray(body?.lessons) ? body.lessons : [],
    children: Array.isArray(body?.children) ? body.children : [],
    no_payer: Array.isArray(body?.no_payer) ? body.no_payer : [],
    blocked: body?.blocked?.code ? { code: body.blocked.code, message: String(body.blocked.message ?? '') } : null,
  };
}

// "Maya Chen (3), Leo Park (1) and 2 more"
export function namesWithCounts(rows, shown = NAMES_SHOWN) {
  const parts = rows.slice(0, shown).map((r) => `${r.name || 'Someone'} (${r.total})`);
  const rest = rows.length - parts.length;
  if (rest > 0) parts.push(`and ${rest} more`);
  return parts.length > 1 && rest <= 0 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts.join(', ');
}

// "Maya Chen, Leo Park and Ava Chen"
export function listNames(names) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

// The sentence over the dialog: what goes, in the three counts people care about
export function headline(person, counts) {
  return `This permanently deletes ${firstName(person)} and ${plural(counts.sessions, 'lesson')}, ${plural(counts.assignments, 'assignment')}, ${plural(counts.files, 'file')}. This can’t be undone.`;
}

// "All 7 lessons are still to come.", "5 of the 6 lessons are still to come."
function upcomingLine({ sessions, upcoming_sessions: upcoming }) {
  if (sessions === 1) return 'The lesson is still to come.';
  if (upcoming === sessions) return `All ${sessions} lessons are still to come.`;
  return `${upcoming} of the ${sessions} lessons ${upcoming === 1 ? 'is' : 'are'} still to come.`;
}

// The rest, as a short list of lines (only what is there)
export function detailLines(preview) {
  const { counts, lessons, children, no_payer: noPayer } = preview;
  const lines = [];
  if (counts.sessions && counts.upcoming_sessions) lines.push(upcomingLine(counts));
  if (lessons.length) {
    lines.push(`The lessons go with them: ${namesWithCounts(lessons)}. To keep them, move the lessons to another tutor first.`);
  }
  if (counts.submissions) lines.push(`${plural(counts.submissions, 'submitted answer')} and their grades.`);
  const plain = Math.max(0, counts.tasks - counts.assignments);
  if (plain) lines.push(`${plural(plain, 'other task')}.`);
  if (counts.updates) lines.push(`${plural(counts.updates, 'progress update')} and notes.`);
  if (counts.series) lines.push(`${plural(counts.series, 'repeating lesson schedule')}.`);
  if (counts.rates) lines.push(`${plural(counts.rates, 'hourly rate')}.`);
  if (counts.statements) lines.push(`${plural(counts.statements, 'sent statement')}.`);
  if (children.length) {
    lines.push(`${listNames(children)} ${children.length === 1 ? 'stays' : 'stay'} in the portal; only the link to them is removed.`);
  } else if (counts.links) {
    lines.push(`${plural(counts.links, 'tutor or parent link')}.`);
  }
  if (counts.invites) lines.push(`${counts.invites === 1 ? 'Their invite link' : `${counts.invites} invite links`}.`);
  if (noPayer.length) lines.push(`${listNames(noPayer)} would have no one to bill until you link a parent.`);
  return lines;
}

export const typedLabel = (person) => `Type ${confirmName(person)} to confirm`;
export const blockedTitle = (person) => `${firstName(person)} can’t be deleted`;
export const deleteTitle = (person) => `Delete ${confirmName(person)}?`;
export const doneText = (person) => `${firstName(person)} was deleted.`;

// What to tell the admin when a call did not go through: the server's own
// words when it gave some, else a plain line for the status
export function failureText(status, body) {
  if (body?.message) return body.message;
  if (status === 0) return 'Check your connection and try again.';
  if (status === 401) return 'Sign in again as an admin.';
  if (status === 404) return 'That person is already gone.';
  return 'Please try again.';
}

// A failed call as one sentence for the page: the server's own words when it
// gave some (a refusal reads well as it is), else a plain line
export function problemText(status, body) {
  return body?.message ? body.message : `That didn’t work: ${failureText(status, body)}`;
}

// The People data without one person: their row, their links and their invites. A
// student who lost the parent who paid is billed to the next parent linked, as
// the server does.
export function withoutPerson(data, id) {
  const people = data.people.filter((p) => p.id !== id);
  const gone = (l) => l.parent_id === id || l.tutor_id === id || l.student_id === id;
  const tutorLinks = data.tutorLinks.filter((l) => !gone(l));
  const parentLinks = data.parentLinks.filter((l) => !gone(l)).map((l) => ({ ...l }));
  const paid = new Set(data.parentLinks.filter((l) => l.parent_id === id && l.bills).map((l) => l.student_id));
  for (const studentId of paid) {
    const rest = parentLinks.filter((l) => l.student_id === studentId);
    if (rest.length && !rest.some((l) => l.bills) && 'bills' in rest[0]) rest[0].bills = true;
  }
  return {
    ...data,
    people,
    byId: new Map(people.map((p) => [p.id, p])),
    tutorLinks,
    parentLinks,
    invites: data.invites.filter((i) => i.profile_id !== id),
  };
}
