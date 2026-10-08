// Deleting a person for good (admin only), as two actions of POST /api/people
// (api/_lib/people.js):
//   { action: 'delete_preview', id }                 what would go, and why it may not
//   { action: 'delete_person', id, confirm_name }    do it
//
// The auth user is deleted with the service role. The database cascades the
// profile and everything that points at it (lessons, series, assignments,
// answers and drafts, materials rows, rates, links, invites, statements). What
// the database cannot do is done around it:
//   - before: the person's Google Calendar connection is revoked and removed
//     (api/_lib/google/handlers.js disconnectUser), so no token is left behind
//   - after: their files in Storage, the audit rows of their lessons, and the
//     paying parent of a student whose paying parent was deleted
//
// Refused, with a JSON code and a message the portal shows as it is:
//   self           the caller's own account
//   is_admin       any admin (change the role first)
//   has_payments   payments.parent_id restricts the delete (voided ones too)
//   has_payouts    payouts.tutor_id restricts it
//   has_adjustments  billing_adjustments.party_id restricts it
//   paid_sessions  a lesson that already happened sits in a month or pay period
//                  that has been paid (the rule sessions_guard enforces for
//                  tutors, applied here to students and tutors alike), or a
//                  recorded payment has a line for the student: billing history stays
//   in_use         the database refused for another reference
// and, only when deleting, name_mismatch: the typed name is not the person's
// (a typo guard).
//
// delete_person answers { ok, deleted: true, removed: { ...counts }, warnings }
// with the counts read BEFORE anything was deleted. delete_preview answers
// { ok, person, counts, lessons, children, no_payer, blocked } where blocked is
// null or { code, message }. Logs carry counts and the role, never names,
// addresses, paths or tokens.

const json = (status, body) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = 'America/Los_Angeles';
const DAY_MS = 24 * 3600 * 1000;
const PAGE = 1000;
const REMOVE_CHUNK = 100;
const IN_CHUNK = 150;
const MAX_FILES = 20000;

export const HOMEWORK_BUCKET = 'homework';
export const MATERIALS_BUCKET = 'materials';
export const AVATARS_BUCKET = 'avatars';

// ---------------------------------------------------------------------------
// Pure helpers

const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const firstNameOf = (person) => squash(person?.full_name).split(' ')[0] || 'This person';

// What a person types to confirm: their full name (or, with no name, their address)
export function confirmNameOf(person) {
  return squash(person?.full_name) || squash(person?.email);
}

// Trimmed, whitespace collapsed, case-insensitive. A person with neither a name
// nor an address cannot be matched.
export function nameMatches(typed, person) {
  const expected = confirmNameOf(person).toLowerCase();
  return Boolean(expected) && squash(typed).toLowerCase() === expected;
}

export const BLOCK_CODES = Object.freeze(['has_payments', 'has_payouts', 'has_adjustments', 'paid_sessions']);

// The sentence for a refusal, in the words the portal shows
export function refusalMessage(code, person) {
  const first = firstNameOf(person);
  const teaches = person?.role === 'tutor';
  switch (code) {
    case 'self': return 'You can’t delete your own account.';
    case 'is_admin': return `${first} is an admin, so they can’t be deleted here. Change their role first.`;
    case 'has_payments': return `${first} has payments recorded, so they can’t be deleted. Their billing history must stay.`;
    case 'has_payouts': return `${first} has pay recorded, so they can’t be deleted. Their pay history must stay.`;
    case 'has_adjustments': return `${first} has fees, credits or other billing adjustments recorded, so they can’t be deleted. Their billing history must stay.`;
    case 'paid_sessions': return teaches
      ? `${first} taught lessons in a month or pay period that has been paid, so they can’t be deleted. Their billing history must stay.`
      : `${first}’s past lessons are in a month that has been paid, so they can’t be deleted. Their billing history must stay.`;
    case 'in_use': return `${first} is still used by other records, so they can’t be deleted.`;
    case 'name_mismatch': return 'The name you typed doesn’t match. Type their full name exactly as shown.';
    case 'not_found': return 'That person is no longer in the portal.';
    default: return 'This person can’t be deleted.';
  }
}

const dayNumber = (day) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const dayString = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const LA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

// The Pacific calendar day of an instant: '2026-10-05'
export const laDay = (iso) => LA_DAY.format(new Date(iso));

// The first day of the pay period holding `day`: periods are 14 days from the
// anchor Sunday (private.pay_period_start in the billing migration)
export function payPeriodStart(day, anchor) {
  const a = dayNumber(anchor);
  return dayString(a + 14 * Math.floor((dayNumber(day) - a) / 14));
}

// How many of these lessons sit in a month a parent has paid or a pay period a
// tutor has been paid for (private.day_is_paid in the billing migration):
//   sessions  [{ student_id, tutor_id, starts_at }]
//   payerOf   { studentId: parentId }   the paying parent of each student
//   payments  [{ parent_id, period }]   payments that are not voided
//   payouts   [{ tutor_id, period_start }]   tutor payouts that are not voided
export function paidSessionCount({ sessions, payerOf, payments, payouts, anchor }) {
  const months = new Set(payments.filter((p) => p.period).map((p) => `${p.parent_id}|${p.period}`));
  const periods = new Set(payouts.map((p) => `${p.tutor_id}|${p.period_start}`));
  let n = 0;
  for (const s of sessions) {
    const day = laDay(s.starts_at);
    const payer = payerOf[s.student_id];
    if (periods.has(`${s.tutor_id}|${payPeriodStart(day, anchor)}`) || (payer && months.has(`${payer}|${day.slice(0, 7)}-01`))) n += 1;
  }
  return n;
}

// The first reason that stops a delete, or null
export function blockerOf({ refs, paid }) {
  if (refs.payments) return 'has_payments';
  if (refs.payouts) return 'has_payouts';
  if (refs.adjustments) return 'has_adjustments';
  if (paid) return 'paid_sessions';
  return null;
}

// What the database said when it refused the delete: a code the portal can
// explain, or null when it is not a reference problem
export function failureCode(error) {
  const text = `${error?.code ?? ''} ${error?.message ?? ''}`.toLowerCase();
  if (/23503|foreign key|restrict/.test(text)) return 'in_use';
  if (/vp00[12]|has been paid/.test(text)) return 'paid_sessions';
  return null;
}

// ---------------------------------------------------------------------------
// What a person has, before anything is deleted

async function gather(repo, person, nowMs) {
  const sessions = await repo.sessionsOf(person.id);
  const mine = sessions.filter((s) => s.tutor_id === person.id);
  const upcoming = sessions.filter((s) => Date.parse(s.starts_at) > nowMs);
  const parent = person.role === 'parent';
  const [counts, refs, files, children, moves] = await Promise.all([
    repo.countsOf(person.id),
    repo.billingRefs(person.id),
    repo.filesOf(person.id, mine.map((s) => s.id)),
    parent ? repo.childrenOf(person.id) : [],
    parent ? repo.payerMoves(person.id) : [],
  ]);

  // Past lessons in a paid month or pay period, and (for a student) payments that name them
  let paid = 0;
  if (!refs.payments && !refs.payouts && !refs.adjustments) {
    const past = sessions.filter((s) => Date.parse(s.ends_at) <= nowMs);
    if (past.length) paid = paidSessionCount({ sessions: past, ...(await repo.billingFacts(past)) });
    if (!paid && person.role === 'student') paid = await repo.paymentsNaming(person.id);
  }
  const blocked = blockerOf({ refs, paid });

  // A tutor's lessons are deleted with them: say whose
  const byStudent = new Map();
  for (const s of mine) {
    const row = byStudent.get(s.student_id) ?? { id: s.student_id, total: 0, upcoming: 0 };
    row.total += 1;
    if (Date.parse(s.starts_at) > nowMs) row.upcoming += 1;
    byStudent.set(s.student_id, row);
  }
  const names = await repo.namesOf([...byStudent.keys(), ...moves.map((m) => m.student_id)]);
  const lessons = [...byStudent.values()]
    .map((r) => ({ ...r, name: names[r.id] ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const noPayer = moves.filter((m) => !m.next_parent_id).map((m) => names[m.student_id] ?? '').filter(Boolean).sort();

  const fileCount = new Set([...files.homework, ...files.materials.map((p) => `m/${p}`), ...(files.avatars ?? []).map((p) => `a/${p}`)]).size;
  return {
    summary: {
      counts: {
        sessions: sessions.length,
        upcoming_sessions: upcoming.length,
        assignments: counts.assignments,
        tasks: counts.tasks,
        submissions: counts.submissions,
        drafts: counts.drafts,
        files: fileCount,
        updates: counts.updates + counts.notes,
        series: counts.series,
        rates: counts.family_rates + counts.tutor_rates,
        links: counts.tutor_links + counts.parent_links,
        invites: counts.invites,
        statements: counts.statements,
      },
      lessons,
      children,
      no_payer: noPayer,
      blocked: blocked ? { code: blocked, message: refusalMessage(blocked, person) } : null,
    },
    files,
    moves,
  };
}

const logCounts = (log, what, role, counts) => {
  try {
    log(`[people] ${what} role=${role} ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  } catch {
    // logging must never fail a delete
  }
};

// ---------------------------------------------------------------------------
// The two actions. `caller` is the verified admin ({ id }).

export async function handleDelete(action, data, caller, {
  repo, auth, disconnectGoogle = async () => false, now = () => Date.now(), log = console.info, warn = console.error,
}) {
  const id = typeof data.id === 'string' ? data.id.toLowerCase() : '';
  if (!UUID_RE.test(id)) return json(422, { error: 'invalid', errors: { id: 'invalid' } });

  const person = await repo.getProfile(id);
  if (!person) return json(404, { error: 'not_found', message: refusalMessage('not_found') });
  const info = { id: person.id, full_name: person.full_name, role: person.role, no_login: Boolean(person.no_login) };

  const refuse = (code, status = 409) => json(status, { error: code, message: refusalMessage(code, person) });
  const fixed = person.id === caller.id ? 'self' : person.role === 'admin' ? 'is_admin' : null;

  if (action === 'delete_preview') {
    if (fixed) return json(200, { ok: true, person: info, blocked: { code: fixed, message: refusalMessage(fixed, person) } });
    const { summary } = await gather(repo, person, now());
    return json(200, { ok: true, person: info, ...summary });
  }

  // delete_person
  if (fixed) return refuse(fixed);
  if (!nameMatches(data.confirm_name, person)) return refuse('name_mismatch', 422);
  const { summary, files, moves } = await gather(repo, person, now());
  if (summary.blocked) return refuse(summary.blocked.code);
  const removed = summary.counts;
  const warnings = [];

  // The Google connection first: once the user is gone its token could not be revoked
  let hadGoogle = false;
  try {
    hadGoogle = await disconnectGoogle(person.id);
  } catch (error) {
    warn('[people] google disconnect:', error?.name ?? 'Error');
    warnings.push('google');
  }

  const result = await auth.deleteUser(person.id);
  if (result?.error) {
    // A reference that appeared since the check, or one the check does not know of
    const again = await gather(repo, person, now()).catch(() => null);
    if (again?.summary.blocked) return refuse(again.summary.blocked.code);
    const code = failureCode(result.error);
    if (code) return refuse(code);
    throw new Error(`deleteUser: ${result.error.message ?? 'failed'}`);
  }

  // The user is gone and everything the database could cascade with it. The rest is best effort.
  const step = async (name, task) => {
    try {
      await task();
    } catch (error) {
      warn(`[people] cleanup ${name}:`, error?.name ?? 'Error');
      warnings.push(name);
    }
  };
  await step('homework files', () => repo.removeFiles(HOMEWORK_BUCKET, files.homework));
  await step('material files', () => repo.removeFiles(MATERIALS_BUCKET, files.materials));
  // Their profile photos (avatars/<id>/...): nobody can see them any more, so they go too
  if (files.avatars?.length) await step('profile photos', () => repo.removeFiles(AVATARS_BUCKET, files.avatars));
  await step('lesson history', () => repo.deleteSessionEdits(person.id));
  // A parent who paid for a student: the bill goes to another linked parent, if any
  for (const move of moves) {
    if (move.next_parent_id) await step('payer', () => repo.setPayer(move.student_id, move.next_parent_id));
  }
  logCounts(log, 'deleted', person.role, { ...removed, google: hadGoogle ? 1 : 0, warnings: warnings.length });
  return json(200, { ok: true, deleted: true, removed, warnings });
}

// ---------------------------------------------------------------------------
// The service-role queries (`db` is a supabase-js client built with the service
// key). Every method throws Error('<name>: <message>') on a Supabase error.

// A table or column that a migration has not made yet (the portal runs without
// some of them): nothing there to delete or to refuse
const MISSING = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);

export function createDeleteRepo(db) {
  const fail = (what, error) => Object.assign(new Error(`${what}: ${error.message}`), { missing: MISSING.has(error.code) });
  const check = ({ data, error }, what) => {
    if (error) throw fail(what, error);
    return data;
  };
  // The answer of a query on something that may not exist yet, or `fallback`
  const optional = async (task, fallback) => {
    try {
      return await task();
    } catch (error) {
      if (error?.missing) return fallback;
      throw error;
    }
  };
  const count = (table, apply, what = table) => optional(async () => {
    const { count: n, error } = await apply(db.from(table).select('*', { count: 'exact', head: true }));
    if (error) throw fail(`count ${what}`, error);
    return n ?? 0;
  }, 0);
  // Every row of a query, a page at a time
  const pages = async (make, what) => {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const part = check(await make().range(from, from + PAGE - 1), what) ?? [];
      rows.push(...part);
      if (part.length < PAGE) return rows;
    }
  };
  const chunks = (list, size) => {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  };
  const either = (id, a, b) => `${a}.eq.${id},${b}.eq.${id}`;

  // The files directly under '<id>/' in a bucket
  async function folder(bucket, id) {
    const names = [];
    for (let offset = 0; offset < MAX_FILES; offset += PAGE) {
      const { data, error } = await db.storage.from(bucket).list(id, { limit: PAGE, offset });
      if (error) throw new Error(`list ${bucket}: ${error.message}`);
      const part = (data ?? []).filter((e) => e.id !== null && e.id !== undefined);
      names.push(...part.map((e) => `${id}/${e.name}`));
      if ((data ?? []).length < PAGE) break;
    }
    return names;
  }

  return {
    // Every lesson of the person, as a student or as a tutor
    async sessionsOf(id) {
      return pages(() => db.from('sessions').select('id, student_id, tutor_id, starts_at, ends_at')
        .or(either(id, 'student_id', 'tutor_id')).order('id'), 'sessionsOf');
    },

    async countsOf(id) {
      const [assignments, tasks, submissions, drafts, updates, notes, series, familyRates, tutorRates, tutorLinks, parentLinks, invites, statements] = await Promise.all([
        count('tasks', (q) => q.eq('student_id', id).eq('kind', 'assignment')),
        count('tasks', (q) => q.eq('student_id', id)),
        count('submissions', (q) => q.eq('student_id', id)),
        count('submission_drafts', (q) => q.eq('student_id', id)),
        count('updates', (q) => q.eq('student_id', id)),
        count('student_notes', (q) => q.eq('student_id', id)),
        count('session_series', (q) => q.or(either(id, 'student_id', 'tutor_id'))),
        count('family_rates', (q) => q.or(either(id, 'student_id', 'tutor_id'))),
        count('tutor_rates', (q) => q.eq('tutor_id', id)),
        count('tutor_students', (q) => q.or(either(id, 'tutor_id', 'student_id'))),
        count('parent_students', (q) => q.or(either(id, 'parent_id', 'student_id'))),
        count('portal_invites', (q) => q.eq('profile_id', id)),
        count('statements', (q) => q.eq('parent_id', id)),
      ]);
      return {
        assignments, tasks, submissions, drafts, updates, notes, series, family_rates: familyRates, tutor_rates: tutorRates,
        tutor_links: tutorLinks, parent_links: parentLinks, invites, statements,
      };
    },

    // Money rows that restrict the delete, voided ones included
    async billingRefs(id) {
      const [payments, payouts, adjustments] = await Promise.all([
        count('payments', (q) => q.eq('parent_id', id)),
        count('payouts', (q) => q.eq('tutor_id', id)),
        count('billing_adjustments', (q) => q.eq('party_id', id)),
      ]);
      return { payments, payouts, adjustments };
    },

    // What day_is_paid reads, for these lessons
    async billingFacts(lessons) {
      return optional(async () => {
        const students = [...new Set(lessons.map((s) => s.student_id))];
        const tutors = [...new Set(lessons.map((s) => s.tutor_id))];
        const settings = check(await db.from('billing_settings').select('payroll_anchor').eq('id', 1).maybeSingle(), 'billingFacts');
        const payerOf = {};
        for (const part of chunks(students, IN_CHUNK)) {
          const links = await pages(() => db.from('parent_students').select('parent_id, student_id')
            .eq('bills', true).in('student_id', part).order('student_id'), 'billingFacts');
          for (const l of links) payerOf[l.student_id] = l.parent_id;
        }
        const payers = [...new Set(Object.values(payerOf))];
        const payments = [];
        for (const part of chunks(payers, IN_CHUNK)) {
          payments.push(...await pages(() => db.from('payments').select('parent_id, period')
            .in('parent_id', part).is('voided_at', null).not('period', 'is', null).order('id'), 'billingFacts'));
        }
        const payouts = [];
        for (const part of chunks(tutors, IN_CHUNK)) {
          payouts.push(...await pages(() => db.from('payouts').select('tutor_id, period_start')
            .in('tutor_id', part).eq('kind', 'tutor').is('voided_at', null).order('id'), 'billingFacts'));
        }
        return { payerOf, payments, payouts, anchor: settings?.payroll_anchor ?? '2026-11-01' };
      }, { payerOf: {}, payments: [], payouts: [], anchor: '2026-11-01' });
    },

    // Payments that are not voided with a line for this student. supabase-js turns
    // a JS array into a Postgres array literal ({...}), which a jsonb column refuses,
    // so the jsonb value goes as JSON text (lines @> '[{"student_id": ...}]')
    async paymentsNaming(studentId) {
      return count('payments', (q) => q.is('voided_at', null).contains('lines', JSON.stringify([{ student_id: studentId }])), 'paymentsNaming');
    },

    // Every file the delete would leave behind: homework answers, materials on
    // the person's own folder or (a tutor) on their lessons, which sit in their
    // students' folders, and their profile photos
    async filesOf(id, lessonIds) {
      const homework = new Set();
      const materials = new Set();
      // Homework only ever sits in the student's own folder; nothing else is touched
      for (const r of await pages(() => db.from('submissions').select('storage_path')
        .eq('student_id', id).not('storage_path', 'is', null).order('id'), 'filesOf')) {
        if (String(r.storage_path).startsWith(`${id}/`)) homework.add(r.storage_path);
      }
      for (const r of await pages(() => db.from('materials').select('storage_path')
        .eq('student_id', id).not('storage_path', 'is', null).order('id'), 'filesOf')) materials.add(r.storage_path);
      for (const part of chunks(lessonIds, IN_CHUNK)) {
        for (const r of await pages(() => db.from('materials').select('storage_path')
          .in('session_id', part).not('storage_path', 'is', null).order('id'), 'filesOf')) materials.add(r.storage_path);
      }
      for (const p of await folder(HOMEWORK_BUCKET, id)) homework.add(p);
      for (const p of await folder(MATERIALS_BUCKET, id)) materials.add(p);
      // Profile photos sit in '<id>/' of the avatars bucket. The bucket comes with
      // the profiles and photos migration: before it, there is nothing to remove.
      // Any other failure stops the delete, like the other folders, so a child's
      // photo is never left behind without a word.
      const avatars = await folder(AVATARS_BUCKET, id).catch((error) => {
        if (/bucket not found/i.test(error?.message ?? '')) return [];
        throw error;
      });
      return { homework: [...homework], materials: [...materials], avatars };
    },

    // Removes files by path, a hundred at a time -> how many went
    async removeFiles(bucket, paths) {
      let removed = 0;
      for (const part of chunks(paths, REMOVE_CHUNK)) {
        const { data, error } = await db.storage.from(bucket).remove(part);
        if (error) throw new Error(`remove ${bucket}: ${error.message}`);
        removed += data?.length ?? 0;
      }
      return removed;
    },

    // { id: full_name }
    async namesOf(ids) {
      const out = {};
      for (const part of chunks([...new Set(ids)], IN_CHUNK)) {
        for (const p of check(await db.from('profiles').select('id, full_name').in('id', part), 'namesOf') ?? []) out[p.id] = p.full_name;
      }
      return out;
    },

    // The students this parent pays for, and who would pay next (the earliest linked
    // of the other parents, as 20261010120000_billing.sql picked the first): [{ student_id, next_parent_id|null }]
    async payerMoves(parentId) {
      return optional(async () => {
        const mine = check(await db.from('parent_students').select('student_id').eq('parent_id', parentId).eq('bills', true), 'payerMoves') ?? [];
        const moves = [];
        for (const part of chunks(mine.map((m) => m.student_id), IN_CHUNK)) {
          const others = check(await db.from('parent_students').select('parent_id, student_id, created_at')
            .in('student_id', part).neq('parent_id', parentId), 'payerMoves') ?? [];
          for (const student_id of part) {
            const next = others.filter((o) => o.student_id === student_id)
              .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.parent_id).localeCompare(String(b.parent_id)))[0];
            moves.push({ student_id, next_parent_id: next?.parent_id ?? null });
          }
        }
        return moves;
      }, []);
    },

    // Makes this parent the one who pays for the student, unless someone already does
    async setPayer(studentId, parentId) {
      const paying = await count('parent_students', (q) => q.eq('student_id', studentId).eq('bills', true), 'setPayer');
      if (paying) return;
      check(await db.from('parent_students').update({ bills: true }).eq('student_id', studentId).eq('parent_id', parentId), 'setPayer');
    },

    // The audit rows of the person's lessons: the cascade writes a "deleted" row for
    // each, and the Account page would list them as lessons deleted after they happened
    async deleteSessionEdits(id) {
      await optional(async () => {
        check(await db.from('session_edits').delete().or(either(id, 'student_id', 'tutor_id')), 'deleteSessionEdits');
      }, undefined);
    },
  };
}
