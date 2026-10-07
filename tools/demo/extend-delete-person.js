/* Demo extension: delete a person for good (api/_lib/people-delete.js).
   Loaded by the local demo build right after demo-supabase.js. It answers the
   two /api/people actions the Delete button uses, delete_preview and
   delete_person, on top of the demo's own /api/people answers (the join and
   invite actions stay as they were), and cascades the delete through the demo
   tables the way the database would.

   Try it, signed in as the admin: People > Everyone > Delete on a row
     Constance Lin    a student with no login: lessons, assignments, a file, an invite
     Mary Lin         her parent, who is left with no children
     Theo Brooks      a tutor with lessons still to come, for two students
     Ava Chen, Mei Chen, Mateo Diaz, Rosa Diaz   deletable too
     Leo Park, Jin Park, Grace Lin, Maya Lin, Daniel Ortiz, Priya Shah
                      refused: payments, or lessons in a paid month
   The admin's own row has no Delete button (the server refuses it as well).

   Where the demo differs from the real thing: deleting also tells the other
   demo tabs (a BroadcastChannel named vb-demo-db) so each removes the same
   rows from its own in-memory data, as one shared database would; the portal's
   own tab-to-tab message (vb-portal) is the real one. */
(function () {
  'use strict';
  if (!window.portalDemo) return;
  const { db, helpers } = window.portalDemo;
  const { id, pt, ago, DAY } = helpers;
  const TZ = 'America/Los_Angeles';
  const LA_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

  // ---------------------------------------------------------------------------
  // People to delete: a family who left, and a tutor with only upcoming lessons

  const profile = (pid, full_name, role, extra = {}) => ({
    id: pid, full_name, email: `no-login+${pid}@people.varunbaskaran.com`, role, requested_role: null, signup_note: null,
    no_login: true, created_at: ago(20), ...extra,
  });
  db.profiles.push(
    profile('u-constance', 'Constance Lin', 'student'),
    profile('u-mary', 'Mary Lin', 'parent'),
    profile('u-theo', 'Theo Brooks', 'tutor', { email: 'theo.brooks@example.com', no_login: false, calendar_color: null }),
  );
  db.parent_students.push({ parent_id: 'u-mary', student_id: 'u-constance', bills: true, created_at: ago(20) });
  db.tutor_students.push(
    { tutor_id: 'u-priya', student_id: 'u-constance', subject: 'Chemistry', created_at: ago(20) },
    { tutor_id: 'u-theo', student_id: 'u-constance', subject: 'Physics', created_at: ago(15) },
    { tutor_id: 'u-theo', student_id: 'u-ava', subject: 'Biology', created_at: ago(15) },
  );
  db.family_rates.push({ id: id(), student_id: 'u-constance', subject: 'Chemistry', tutor_id: null, rate_cents: 7000, effective_from: helpers.monthStart(-2), note: null, created_by: 'u-admin', created_at: ago(20), voided_at: null, void_reason: null });

  const lesson = (student, tutor, subject, offset, start, end, extra = {}) => db.sessions.push({
    id: id(), student_id: student, tutor_id: tutor, series_id: null, subject, starts_at: pt(offset, start), ends_at: pt(offset, end),
    location: 'VP Education Group, San Gabriel', meeting_url: null, notes: null, status: 'scheduled', attendance: offset < 0 ? 'present' : null,
    recap: offset < 0 ? 'Worked through the practice set.' : null, moved_from: null, changed_at: null, created_by: tutor, created_at: ago(30),
    updated_at: ago(30), cancelled_at: null, google_event_id: null, google_link: null, sync_state: 'synced', ...extra,
  });
  // Constance: Chemistry with Priya, one lesson a week, two behind her and two ahead (in months no one has paid)
  for (const offset of [-4, 3, 10]) lesson('u-constance', 'u-priya', 'Chemistry', offset, '15:00', '16:00');
  // Theo's lessons are all still to come
  for (const offset of [2, 9, 16]) lesson('u-constance', 'u-theo', 'Physics', offset, '17:00', '18:00');
  for (const offset of [1, 8, 15, 22]) lesson('u-ava', 'u-theo', 'Biology', offset, '16:30', '17:30');

  const homework = (title, kind, offset) => {
    const row = {
      id: id(), student_id: 'u-constance', created_by: 'u-priya', kind, title, details: null, due_at: helpers.dueAt(offset),
      completed_at: null, created_at: ago(9), session_id: null, series_id: null,
    };
    db.tasks.push(row);
    return row;
  };
  const stoich = homework('Stoichiometry problem set', 'assignment', -2);
  homework('Lab report: titration', 'assignment', 5);
  homework('Balancing equations drill', 'assignment', 8);
  homework('Bring safety goggles', 'task', 3);
  db.submissions.push({
    id: id(), student_id: 'u-constance', task_id: stoich.id, storage_path: 'u-constance/stoich.svg', file_type: 'image/svg+xml', note: null,
    status: 'ai_graded', attempts: 1, error: null, status_changed_at: ago(2, '19:30'), created_at: ago(2, '19:00'), body: null, body_doc: null,
  });
  db.materials.push({
    id: id(), student_id: 'u-constance', session_id: null, task_id: stoich.id, title: 'Stoichiometry worksheet', storage_path: 'u-constance/worksheet.pdf',
    file_type: 'application/pdf', size_bytes: 30211, url: null, created_by: 'u-priya', created_at: ago(9),
  });
  db.updates.push({ id: id(), student_id: 'u-constance', author_id: 'u-priya', body: 'Good first month. Mole conversions are the next focus.', visible_to_student: true, created_at: ago(5, '18:30') });
  db.portal_invites.push({ id: id(), profile_id: 'u-mary', token_hash: 'e'.repeat(64), created_by: 'u-admin', created_at: ago(3), expires_at: pt(27), used_at: null, emailed_to: null, emailed_at: null });

  // ---------------------------------------------------------------------------
  // The rules, as the server holds them (api/_lib/people-delete.js)

  const squash = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const confirmNameOf = (p) => squash(p.full_name) || squash(p.email);
  const first = (p) => squash(p.full_name).split(' ')[0] || 'This person';
  const MESSAGES = {
    self: () => 'You can’t delete your own account.',
    is_admin: (p) => `${first(p)} is an admin, so they can’t be deleted here. Change their role first.`,
    has_payments: (p) => `${first(p)} has payments recorded, so they can’t be deleted. Their billing history must stay.`,
    has_payouts: (p) => `${first(p)} has pay recorded, so they can’t be deleted. Their pay history must stay.`,
    has_adjustments: (p) => `${first(p)} has fees, credits or other billing adjustments recorded, so they can’t be deleted. Their billing history must stay.`,
    paid_sessions: (p) => (p.role === 'tutor'
      ? `${first(p)} taught lessons in a month or pay period that has been paid, so they can’t be deleted. Their billing history must stay.`
      : `${first(p)}’s past lessons are in a month that has been paid, so they can’t be deleted. Their billing history must stay.`),
    name_mismatch: () => 'The name you typed doesn’t match. Type their full name exactly as shown.',
    not_found: () => 'That person is no longer in the portal.',
  };
  const message = (code, p) => MESSAGES[code](p);

  const dayNumber = (day) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY);
  const periodStart = (day, anchor) => {
    const a = dayNumber(anchor);
    return new Date((a + 14 * Math.floor((dayNumber(day) - a) / 14)) * DAY).toISOString().slice(0, 10);
  };
  const payerOf = (studentId) => db.parent_students.find((l) => l.student_id === studentId && l.bills)?.parent_id ?? null;

  // How many past lessons sit in a month a parent has paid or a pay period a tutor was paid for
  function paidCount(lessons) {
    const anchor = db.billing_settings[0]?.payroll_anchor ?? '2026-11-01';
    return lessons.filter((s) => {
      const day = LA_DAY.format(new Date(s.starts_at));
      const payer = payerOf(s.student_id);
      const month = `${day.slice(0, 7)}-01`;
      return db.payments.some((p) => !p.voided_at && p.parent_id === payer && p.period === month)
        || db.payouts.some((p) => !p.voided_at && p.kind === 'tutor' && p.tutor_id === s.tutor_id && p.period_start === periodStart(day, anchor));
    }).length;
  }

  const lessonsOf = (pid) => db.sessions.filter((s) => s.student_id === pid || s.tutor_id === pid);
  const filesOf = (p) => {
    const mine = new Set(lessonsOf(p.id).filter((s) => s.tutor_id === p.id).map((s) => s.id));
    const paths = new Set();
    for (const s of db.submissions) if (s.student_id === p.id && s.storage_path) paths.add(`h/${s.storage_path}`);
    for (const m of db.materials) if (m.storage_path && (m.student_id === p.id || mine.has(m.session_id))) paths.add(`m/${m.storage_path}`);
    return paths.size;
  };

  function blockerOf(p, lessons) {
    if (db.payments.some((x) => x.parent_id === p.id)) return 'has_payments';
    if (db.payouts.some((x) => x.tutor_id === p.id)) return 'has_payouts';
    if (db.billing_adjustments.some((x) => x.party_id === p.id)) return 'has_adjustments';
    const past = lessons.filter((s) => Date.parse(s.ends_at) <= Date.now());
    if (paidCount(past)) return 'paid_sessions';
    if (p.role === 'student' && db.payments.some((x) => !x.voided_at && (x.lines ?? []).some((l) => l.student_id === p.id))) return 'paid_sessions';
    return null;
  }

  function summaryOf(p) {
    const lessons = lessonsOf(p.id);
    const nameOf = (pid) => db.profiles.find((x) => x.id === pid)?.full_name ?? '';
    const byStudent = new Map();
    for (const s of lessons.filter((x) => x.tutor_id === p.id)) {
      const row = byStudent.get(s.student_id) ?? { id: s.student_id, name: nameOf(s.student_id), total: 0, upcoming: 0 };
      row.total += 1;
      if (Date.parse(s.starts_at) > Date.now()) row.upcoming += 1;
      byStudent.set(s.student_id, row);
    }
    const children = p.role === 'parent'
      ? db.parent_students.filter((l) => l.parent_id === p.id).map((l) => nameOf(l.student_id)).filter(Boolean).sort() : [];
    const noPayer = p.role === 'parent'
      ? db.parent_students.filter((l) => l.parent_id === p.id && l.bills)
        .filter((l) => !db.parent_students.some((o) => o.student_id === l.student_id && o.parent_id !== p.id))
        .map((l) => nameOf(l.student_id)).filter(Boolean).sort() : [];
    const tasks = db.tasks.filter((t) => t.student_id === p.id);
    const blocked = blockerOf(p, lessons);
    return {
      counts: {
        sessions: lessons.length,
        upcoming_sessions: lessons.filter((s) => Date.parse(s.starts_at) > Date.now()).length,
        assignments: tasks.filter((t) => t.kind === 'assignment').length,
        tasks: tasks.length,
        submissions: db.submissions.filter((s) => s.student_id === p.id).length,
        drafts: db.submission_drafts.filter((d) => d.student_id === p.id).length,
        files: filesOf(p),
        updates: db.updates.filter((u) => u.student_id === p.id).length,
        series: db.session_series.filter((s) => s.student_id === p.id || s.tutor_id === p.id).length,
        rates: db.family_rates.filter((r) => r.student_id === p.id || r.tutor_id === p.id).length + db.tutor_rates.filter((r) => r.tutor_id === p.id).length,
        links: db.tutor_students.filter((l) => l.tutor_id === p.id || l.student_id === p.id).length
          + db.parent_students.filter((l) => l.parent_id === p.id || l.student_id === p.id).length,
        invites: db.portal_invites.filter((i) => i.profile_id === p.id).length,
        statements: db.statements.filter((s) => s.parent_id === p.id).length,
      },
      lessons: [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name)),
      children,
      no_payer: noPayer,
      blocked: blocked ? { code: blocked, message: message(blocked, p) } : null,
    };
  }

  // The database's cascade, and what the server does around it
  function cascade(pid) {
    const lessonIds = new Set(lessonsOf(pid).map((s) => s.id));
    const taskIds = new Set(db.tasks.filter((t) => t.student_id === pid).map((t) => t.id));
    const subIds = new Set(db.submissions.filter((s) => s.student_id === pid).map((s) => s.id));
    const paidFor = db.parent_students.filter((l) => l.parent_id === pid && l.bills).map((l) => l.student_id);
    db.profiles = db.profiles.filter((p) => p.id !== pid);
    db.tutor_students = db.tutor_students.filter((l) => l.tutor_id !== pid && l.student_id !== pid);
    db.parent_students = db.parent_students.filter((l) => l.parent_id !== pid && l.student_id !== pid);
    // a student left without a paying parent is billed to the next linked parent
    for (const studentId of paidFor) {
      const rest = db.parent_students.filter((l) => l.student_id === studentId);
      if (rest.length && !rest.some((l) => l.bills)) rest[0].bills = true;
    }
    db.tasks = db.tasks.filter((t) => !taskIds.has(t.id));
    db.submissions = db.submissions.filter((s) => !subIds.has(s.id));
    db.grades = db.grades.filter((g) => !subIds.has(g.submission_id));
    db.submission_drafts = db.submission_drafts.filter((d) => d.student_id !== pid);
    db.updates = db.updates.filter((u) => u.student_id !== pid);
    db.sessions = db.sessions.filter((s) => !lessonIds.has(s.id));
    db.session_series = db.session_series.filter((s) => s.student_id !== pid && s.tutor_id !== pid);
    db.materials = db.materials.filter((m) => m.student_id !== pid && !lessonIds.has(m.session_id) && !taskIds.has(m.task_id));
    db.family_rates = db.family_rates.filter((r) => r.student_id !== pid && r.tutor_id !== pid);
    db.tutor_rates = db.tutor_rates.filter((r) => r.tutor_id !== pid);
    db.portal_invites = db.portal_invites.filter((i) => i.profile_id !== pid);
    db.statements = db.statements.filter((s) => s.parent_id !== pid);
    db.billing_contacts = db.billing_contacts.filter((c) => c.parent_id !== pid);
    db.session_billing = db.session_billing.filter((b) => !lessonIds.has(b.session_id));
    db.session_edits = db.session_edits.filter((e) => e.student_id !== pid && e.tutor_id !== pid);
    window.portalDemo.notify();
  }

  // One shared database, as far as the demo can fake it: other open demo tabs hear of the delete
  let wire = null;
  try {
    wire = new BroadcastChannel('vb-demo-db');
    wire.addEventListener('message', (event) => {
      if (event.data?.type === 'person-deleted') cascade(event.data.id);
    });
  } catch (error) {
    // no BroadcastChannel: each tab keeps its own demo data
  }

  // ---------------------------------------------------------------------------
  // /api/people: the two actions here, everything else as the demo had it

  const UUIDISH = /^[\w-]{1,64}$/;
  const answer = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const previous = window.fetch;

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    let body = {};
    try { body = JSON.parse(init.body ?? '{}'); } catch (error) { body = {}; }
    const mine = url.origin === location.origin && url.pathname === '/api/people' && init.method === 'POST'
      && (body.action === 'delete_preview' || body.action === 'delete_person');
    if (!mine) return previous(input, init);

    await new Promise((r) => setTimeout(r, 250));
    if (helpers.role() !== 'admin') return answer(401, { error: 'unauthorized' });
    const target = UUIDISH.test(String(body.id ?? '')) ? db.profiles.find((p) => p.id === body.id) : null;
    if (!UUIDISH.test(String(body.id ?? ''))) return answer(422, { error: 'invalid', errors: { id: 'invalid' } });
    if (!target) return answer(404, { error: 'not_found', message: message('not_found') });
    const info = { id: target.id, full_name: target.full_name, role: target.role, no_login: Boolean(target.no_login) };
    const fixed = target.id === helpers.meId ? 'self' : target.role === 'admin' ? 'is_admin' : null;

    if (body.action === 'delete_preview') {
      if (fixed) return answer(200, { ok: true, person: info, blocked: { code: fixed, message: message(fixed, target) } });
      return answer(200, { ok: true, person: info, ...summaryOf(target) });
    }
    if (fixed) return answer(409, { error: fixed, message: message(fixed, target) });
    if (squash(body.confirm_name).toLowerCase() !== confirmNameOf(target).toLowerCase() || !confirmNameOf(target)) {
      return answer(422, { error: 'name_mismatch', message: message('name_mismatch') });
    }
    const summary = summaryOf(target);
    if (summary.blocked) return answer(409, { error: summary.blocked.code, message: summary.blocked.message });
    cascade(target.id);
    try { wire?.postMessage({ type: 'person-deleted', id: target.id }); } catch (error) { /* no other tabs */ }
    return answer(200, { ok: true, deleted: true, removed: summary.counts, warnings: [] });
  };

})();
