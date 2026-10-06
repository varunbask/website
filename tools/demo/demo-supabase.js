/* Local demo stand-in for supabase-js (npm run demo). Made-up sample data kept
   in memory, no network, nothing saved: reload and it starts fresh.

   Pick who you are with ?as=admin | tutor | tutor2 | student | student2 |
   parent | parent2 | pending (remembered until you sign out), or sign in on
   /portal/ with any demo address (any password). The access rules are a
   simplified mirror of the real row level security, enough to show each role
   what it would see. /api calls the portal makes are answered here too. */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Time helpers (sessions are placed on the Pacific clock, like dates.js)

  const DAY = 86400000;
  const NOW = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const PT_WALL = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const PT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
  const wallUtc = (ms) => {
    const p = {};
    for (const { type, value } of PT_WALL.formatToParts(ms)) p[type] = Number(value);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  };
  const today = PT_DAY.format(NOW).split('-').map(Number);
  // Pacific wall time `offset` days from today -> ISO instant
  const pt = (offset, time = '17:00') => {
    const [hh, mm] = time.split(':').map(Number);
    const target = Date.UTC(today[0], today[1] - 1, today[2] + offset, hh, mm);
    let ms = target - (wallUtc(target) - target);
    const again = target - (wallUtc(ms) - ms);
    if (again !== ms && wallUtc(again) === target) ms = again;
    return iso(ms);
  };
  const dayKey = (offset) => pt(offset, '12:00').slice(0, 10);
  const weekday = (offset) => new Date(Date.UTC(today[0], today[1] - 1, today[2] + offset)).getUTCDay();
  const dueAt = (offset) => pt(offset, '23:59');
  const ago = (days, time = '10:00') => pt(-days, time);
  const monthStart = (deltaMonths = 0) => {
    const d = new Date(Date.UTC(today[0], today[1] - 1 + deltaMonths, 1));
    return d.toISOString().slice(0, 10);
  };

  // ---------------------------------------------------------------------------
  // Who is signed in

  const PERSONAS = {
    admin: 'u-admin', tutor: 'u-daniel', tutor2: 'u-priya', student: 'u-maya', student2: 'u-leo',
    parent: 'u-grace', parent2: 'u-jin', pending: 'u-sam',
  };
  const KEY = 'portal-demo-as';
  const params = new URLSearchParams(location.search);
  try { if (params.has('as')) localStorage.setItem(KEY, params.get('as')); } catch (e) { /* private mode */ }
  let meId = null;
  try {
    const saved = localStorage.getItem(KEY);
    meId = PERSONAS[saved] ?? (saved && saved.startsWith('u-') ? saved : null);
  } catch (e) { /* private mode */ }

  // ---------------------------------------------------------------------------
  // Sample data

  let nextId = 5000;
  const id = () => nextId++;
  const profile = (pid, full_name, email, role, extra = {}) => ({
    id: pid, full_name, email, role, requested_role: null, signup_note: null, no_login: false, created_at: ago(60), ...extra,
  });

  const db = {
    profiles: [
      profile('u-admin', 'Varun Baskaran', 'bvarun2004@gmail.com', 'admin'),
      profile('u-daniel', 'Daniel Ortiz', 'daniel.ortiz@example.com', 'tutor'),
      profile('u-priya', 'Priya Shah', 'priya.shah@example.com', 'tutor'),
      profile('u-maya', 'Maya Lin', 'maya.lin@example.com', 'student'),
      profile('u-leo', 'Leo Park', 'leo.park@example.com', 'student'),
      profile('u-ava', 'Ava Chen', 'ava.chen@example.com', 'student'),
      profile('u-mateo', 'Mateo Diaz', 'no-login+u-mateo@people.varunbaskaran.com', 'student', { no_login: true, created_at: ago(12) }),
      profile('u-grace', 'Grace Lin', 'grace.lin@example.com', 'parent'),
      profile('u-jin', 'Jin Park', 'jin.park@example.com', 'parent'),
      profile('u-mei', 'Mei Chen', 'mei.chen@example.com', 'parent'),
      profile('u-rosa', 'Rosa Diaz', 'no-login+u-rosa@people.varunbaskaran.com', 'parent', { no_login: true, created_at: ago(12) }),
      profile('u-sam', 'Sam Rivera', 'sam.rivera@example.com', 'pending', { requested_role: 'parent', signup_note: 'My son Leo Park is in 8th grade and works with Daniel.', created_at: ago(1, '09:00') }),
      profile('u-nora', 'Nora Kim', 'nora.kim@example.com', 'pending', { requested_role: 'student', created_at: ago(0, '08:00') }),
    ],
    tutor_students: [
      { tutor_id: 'u-daniel', student_id: 'u-maya', subject: 'Algebra', created_at: ago(60) },
      { tutor_id: 'u-daniel', student_id: 'u-leo', subject: 'Math', created_at: ago(60) },
      { tutor_id: 'u-priya', student_id: 'u-ava', subject: 'English', created_at: ago(60) },
      { tutor_id: 'u-priya', student_id: 'u-maya', subject: 'SAT Reading', created_at: ago(40) },
      { tutor_id: 'u-admin', student_id: 'u-mateo', subject: 'AP CSP', created_at: ago(12) },
    ],
    parent_students: [
      { parent_id: 'u-grace', student_id: 'u-maya', bills: true, created_at: ago(60) },
      { parent_id: 'u-jin', student_id: 'u-leo', bills: true, created_at: ago(60) },
      { parent_id: 'u-mei', student_id: 'u-ava', bills: true, created_at: ago(60) },
      { parent_id: 'u-rosa', student_id: 'u-mateo', bills: true, created_at: ago(12) },
    ],
    tasks: [],
    submissions: [],
    grades: [],
    submission_drafts: [],
    updates: [],
    sessions: [],
    session_series: [],
    materials: [],
    referrals: [
      { id: 301, referrer_name: 'Grace Lin', referrer_email: 'grace.lin@example.com', referrer_role: 'parent', family_name: 'The Okafor family', family_email: 'okafor@example.com', family_phone: '(626) 555-0142', grade: '9th', subjects: 'Geometry', note: 'Neighbors, looking for help before finals.', language: 'en', ip_hash: null, status: 'new', created_at: ago(2) },
      { id: 302, referrer_name: 'Jin Park', referrer_email: 'jin.park@example.com', referrer_role: 'parent', family_name: 'Lee family', family_email: 'lee.family@example.com', family_phone: null, grade: '11th', subjects: 'SAT, AP Chemistry', note: null, language: 'ko', ip_hash: null, status: 'contacted', created_at: ago(9) },
    ],
    site_reviews: [
      { id: 401, invite_id: 701, kind: 'parent', name: 'Ryan Lee', quote: 'Our daughter went from dreading math to asking for extra practice. Clear updates after every lesson.', translations: null, status: 'pending', created_at: ago(1), reviewed_at: null },
      { id: 402, invite_id: null, kind: 'student', name: 'Ethan W.', quote: 'Daniel explains things three different ways until one clicks.', translations: null, status: 'approved', created_at: ago(20), reviewed_at: ago(19) },
    ],
    review_invites: [
      { id: 701, token_hash: 'a'.repeat(64), name: 'Ryan Lee', kind: 'parent', created_by: 'u-admin', created_at: ago(3), expires_at: pt(57), used_at: ago(1) },
      { id: 702, token_hash: 'b'.repeat(64), name: 'Phoebe Wu', kind: 'parent', created_by: 'u-admin', created_at: ago(4), expires_at: pt(56), used_at: null },
    ],
    portal_invites: [
      // Rosa's link: /portal/join.html#t=DemoInviteLinkForRosaDiaz000000000000000000
      { id: 801, profile_id: 'u-rosa', token_hash: '886a7c8f1131ad636b0aa6c8ffbb744e50c233f0091f4eca7a7de2eba2bc349c', created_by: 'u-admin', created_at: ago(2), expires_at: pt(28), used_at: null, emailed_to: 'rosa.diaz@example.com', emailed_at: ago(2) },
    ],
    // ---- billing (admin only); the demo ledger starts two months back so there is history
    billing_settings: [{ id: 1, business_name: 'VP Education Group', payroll_anchor: monthStart(-2), pay_lag_days: 6, due_day: 15, ledger_start: monthStart(-2), pay_note: 'Pay by Zelle to vbmgroupsllc@gmail.com, or a check made out to VP Education Group.', updated_by: 'u-admin', updated_at: ago(5) }],
    billing_policies: [{ id: 1, effective_from: monthStart(-2), absent_family_pct: 100, absent_tutor_pct: 100, count_unconfirmed: true, created_by: 'u-admin', created_at: ago(60) }],
    family_rates: [
      { student: 'u-maya', subject: 'Algebra', cents: 7500 }, { student: 'u-maya', subject: 'SAT Reading', cents: 9500 },
      { student: 'u-leo', subject: 'Math', cents: 6000 }, { student: 'u-ava', subject: 'English', cents: 6500 },
      { student: 'u-mateo', subject: 'AP CSP', cents: 6500 },
    ].map((r, i) => ({ id: 900 + i, student_id: r.student, subject: r.subject, tutor_id: null, rate_cents: r.cents, effective_from: monthStart(-2), note: null, created_by: 'u-admin', created_at: ago(60), voided_at: null, void_reason: null })),
    tutor_rates: [
      { id: 950, tutor_id: 'u-daniel', rate_cents: 3000, effective_from: monthStart(-2), note: null, created_by: 'u-admin', created_at: ago(60), voided_at: null, void_reason: null },
      { id: 951, tutor_id: 'u-priya', rate_cents: 2500, effective_from: monthStart(-2), note: null, created_by: 'u-admin', created_at: ago(60), voided_at: null, void_reason: null },
      { id: 952, tutor_id: 'u-admin', rate_cents: 0, effective_from: monthStart(-2), note: null, created_by: 'u-admin', created_at: ago(60), voided_at: null, void_reason: null },
    ],
    session_billing: [],
    session_edits: [],
    payments: [],
    payouts: [],
    billing_adjustments: [],
    billing_contacts: [{ parent_id: 'u-grace', phone: '(626) 555-0101', pay_handle: 'grace.lin@example.com', preferred_method: 'zelle', billing_note: null, updated_by: 'u-admin', updated_at: ago(30) }],
    statements: [],
  };

  // ---- tasks, submissions and grades
  const task = (student, kind, title, offset, extra = {}) => {
    const row = {
      id: id(), student_id: student, created_by: extra.by ?? 'u-daniel', kind, title, details: extra.details ?? null,
      due_at: offset === null ? null : dueAt(offset), completed_at: extra.done ? ago(1) : null, created_at: ago(extra.made ?? 8),
      session_id: null, series_id: null,
    };
    db.tasks.push(row);
    return row;
  };
  const submit = (t, { daysAgo = 1, body, status = 'ai_graded', score = null, feedback = null, released = false, attempts = 1 }) => {
    const s = {
      id: id(), student_id: t.student_id, task_id: t.id, storage_path: body ? null : `${t.student_id}/${t.id}/work.svg`, file_type: body ? null : 'image/svg+xml',
      note: null, status, attempts, error: null, status_changed_at: ago(daysAgo, '19:30'), created_at: ago(daysAgo, '19:00'), body: body ?? null, body_doc: null,
    };
    db.submissions.push(s);
    if (score !== null) {
      db.grades.push({ submission_id: s.id, student_id: s.student_id, score, feedback, reviewed_by: released ? 'u-daniel' : null, reviewed_at: released ? ago(daysAgo - 0.5) : null, released_at: released ? ago(Math.max(0, daysAgo - 1)) : null });
    }
    return s;
  };
  const ratio = task('u-leo', 'assignment', 'Ratio word problems', 2, { details: 'Problems 1 to 12 on the worksheet. Show your work.' });
  submit(ratio, { daysAgo: 0.3, body: 'Problem 1: 3 to 5 means 3 parts to 5 parts, so 24 out of 40.\nProblem 2: 12/18 = 2/3.', score: 82, feedback: 'Strong setup on 1 to 8. On 9 to 12, label the units so you can see which quantity you are scaling.' });
  const systems = task('u-maya', 'assignment', 'Systems of equations practice', 1, { details: 'Solve by substitution and by elimination.' });
  submit(systems, { daysAgo: 0.5, score: 91, feedback: 'Clean elimination work. Double-check the sign on number 7.' });
  const decimals = task('u-leo', 'assignment', 'Decimals practice', -3);
  submit(decimals, { daysAgo: 4, status: 'ai_graded', score: 74, feedback: 'Watch place value when you multiply by 10 and 100.', released: true });
  const quadratics = task('u-maya', 'assignment', 'Quadratics: factoring', -6);
  submit(quadratics, { daysAgo: 7, score: 95, feedback: 'Excellent. Every factor checked by expanding.', released: true });
  const essay = task('u-ava', 'assignment', 'Persuasive essay draft', 3, { by: 'u-priya', details: 'Five paragraphs on whether school should start later. Use two sources.' });
  submit(essay, { daysAgo: 0.2, body: 'Every morning, thousands of teenagers drag themselves out of bed before their brains are ready to learn...', status: 'pending', score: null });
  task('u-maya', 'assignment', 'SAT Reading set 4', 4, { by: 'u-priya', details: 'Timed: 32 minutes. Note the questions you guessed on.' });
  task('u-leo', 'assignment', 'Percent change quiz review', 5);
  task('u-maya', 'task', 'Bring graphing calculator', 1);
  task('u-leo', 'task', 'Read chapter 6, sections 1 to 3', 2);
  task('u-maya', 'task', 'Watch the factoring video', -2, { done: true });
  task('u-ava', 'task', 'Vocabulary list 3', 0, { by: 'u-priya' });
  task('u-mateo', 'assignment', 'Create task: digital portfolio outline', 6, { by: 'u-admin' });
  const late = task('u-leo', 'assignment', 'Integers worksheet', -10);
  submit(late, { daysAgo: 11, score: 88, feedback: 'Good. Two sign slips on the last row.', released: true });

  // ---- updates from tutors to families
  const update = (student, author, body, daysAgo, visible = true) => db.updates.push({ id: id(), student_id: student, author_id: author, body, visible_to_student: visible, created_at: ago(daysAgo, '18:30') });
  update('u-maya', 'u-daniel', 'Great session on systems of equations. Maya can now choose between substitution and elimination on her own. Next week: word problems.', 2);
  update('u-leo', 'u-daniel', 'Leo was focused today. We fixed place value mistakes with decimals; practice 15 minutes on the worksheet before Thursday.', 4);
  update('u-ava', 'u-priya', 'Ava\'s thesis statements are much sharper. Her next draft should add a counterargument paragraph.', 3);
  update('u-maya', 'u-priya', 'SAT Reading diagnostic: 33 of 52. Main gaps are evidence pairs; we will drill those for two weeks.', 9);

  // ---- weekly sessions (past ones with attendance and recaps)
  const SERIES = [
    { student: 'u-maya', tutor: 'u-daniel', subject: 'Algebra', weekday: 2, start: '16:00', end: '17:00', location: 'VP Education Group, San Gabriel' },
    { student: 'u-leo', tutor: 'u-daniel', subject: 'Math', weekday: 1, start: '17:30', end: '18:30', location: 'VP Education Group, San Gabriel' },
    { student: 'u-ava', tutor: 'u-priya', subject: 'English', weekday: 3, start: '18:00', end: '19:00', meeting_url: 'https://meet.google.com/abc-defg-hij' },
    { student: 'u-maya', tutor: 'u-priya', subject: 'SAT Reading', weekday: 6, start: '10:00', end: '11:30', meeting_url: 'https://zoom.us/j/5550001234' },
    { student: 'u-mateo', tutor: 'u-admin', subject: 'AP CSP', weekday: 4, start: '16:30', end: '17:30', location: 'VP Education Group, San Gabriel' },
  ];
  const RECAPS = [
    'Reviewed last week\'s homework, then new material with guided practice.',
    'Worked through the tricky problems from class; homework assigned.',
    'Quiz review and timed practice.',
  ];
  for (const sr of SERIES) {
    const seriesId = `ser-${id()}`;
    let first = null;
    let last = null;
    for (let off = -63; off <= 56; off += 1) {
      if (weekday(off) !== sr.weekday) continue;
      first = first ?? dayKey(off);
      last = dayKey(off);
      const past = off < 0;
      const s = {
        id: id(), student_id: sr.student, tutor_id: sr.tutor, series_id: seriesId, subject: sr.subject,
        starts_at: pt(off, sr.start), ends_at: pt(off, sr.end), location: sr.location ?? null, meeting_url: sr.meeting_url ?? null,
        notes: null, status: 'scheduled', attendance: past ? 'present' : null, recap: past ? RECAPS[Math.abs(off) % RECAPS.length] : null,
        moved_from: null, changed_at: null, created_by: sr.tutor, created_at: ago(70), updated_at: ago(70), cancelled_at: null,
        google_event_id: null, google_link: null, sync_state: 'synced',
      };
      if (past && off > -8 && sr.student === 'u-leo') { s.attendance = null; s.recap = null; } // needs notes
      if (past && off <= -20 && off > -27 && sr.student === 'u-ava') { s.status = 'cancelled'; s.attendance = null; s.recap = null; s.cancelled_at = pt(off - 2, '09:00'); }
      if (past && off <= -34 && off > -41 && sr.student === 'u-leo') { s.attendance = 'absent'; s.recap = null; }
      db.sessions.push(s);
    }
    db.session_series.push({
      id: seriesId, student_id: sr.student, tutor_id: sr.tutor, subject: sr.subject, location: sr.location ?? null, meeting_url: sr.meeting_url ?? null,
      notes: null, start_time: sr.start, end_time: sr.end, first_date: first, until: null, last_date: last, created_by: sr.tutor, created_at: ago(70), updated_at: ago(70),
    });
  }
  // lesson materials on Maya's most recent Algebra session, and a link
  const lastAlgebra = db.sessions.filter((s) => s.student_id === 'u-maya' && s.subject === 'Algebra' && Date.parse(s.starts_at) < NOW).pop();
  if (lastAlgebra) {
    db.materials.push({ id: id(), student_id: 'u-maya', session_id: lastAlgebra.id, task_id: null, title: 'Systems of equations slides', storage_path: 'u-maya/slides.svg', file_type: 'image/svg+xml', size_bytes: 48213, url: null, created_by: 'u-daniel', created_at: lastAlgebra.ends_at });
    db.materials.push({ id: id(), student_id: 'u-maya', session_id: lastAlgebra.id, task_id: null, title: 'Khan Academy: elimination', storage_path: null, file_type: null, size_bytes: null, url: 'https://www.khanacademy.org/math/algebra', created_by: 'u-daniel', created_at: lastAlgebra.ends_at });
  }
  db.materials.push({ id: id(), student_id: 'u-leo', session_id: null, task_id: ratio.id, title: 'Ratio worksheet', storage_path: 'u-leo/ratio.svg', file_type: 'image/svg+xml', size_bytes: 21811, url: null, created_by: 'u-daniel', created_at: ago(8) });
  // a family payment for two months ago, so the Account page has history
  db.payments.push({ id: id(), client_key: 'demo-pay-1', parent_id: 'u-jin', payer_name: 'Jin Park', period: monthStart(-2), amount_cents: 24000, method: 'zelle', received_on: dayKey(-25), reference: 'ZL-2201', note: null, lines: [], owed_cents: 24000, recorded_by: 'u-admin', created_at: ago(25), voided_at: null, void_reason: null });

  // A statement sent to Grace for last month, saved the way Account > Families
  // saves it (statements.snapshot), so Billing has something to show
  (function sentStatement() {
    const month = monthStart(-1);
    const next = monthStart(0);
    const rate = { Algebra: 7500, 'SAT Reading': 9500 };
    const lines = db.sessions
      .filter((x) => x.student_id === 'u-maya' && x.starts_at.slice(0, 10) >= month && x.starts_at.slice(0, 10) < next && x.status !== 'cancelled')
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((x) => {
        const minutes = Math.round((Date.parse(x.ends_at) - Date.parse(x.starts_at)) / 60000);
        return {
          day: PT_DAY.format(Date.parse(x.starts_at)), starts_at: x.starts_at, ends_at: x.ends_at, student: 'Maya Lin', subject: x.subject,
          tutor: db.profiles.find((p) => p.id === x.tutor_id)?.full_name ?? '', minutes, rate_cents: rate[x.subject] ?? 7500,
          amount_cents: Math.round((minutes / 60) * (rate[x.subject] ?? 7500)), note: null, cancelled: false,
        };
      });
    const total = lines.reduce((t, l) => t + l.amount_cents, 0);
    db.statements.push({
      parent_id: 'u-grace', period: month, sent_on: next, sent_by: 'u-admin', due_cents: total,
      snapshot: {
        v: 1, number: `${month.slice(0, 7)}-UGRACE`, business: 'VP Education Group', pay_note: db.billing_settings[0].pay_note,
        name: 'Grace Lin', month, bill_date: next, due_date: `${next.slice(0, 8)}15`, lines, adjustments: [], previous_cents: 0,
        month_cents: total, payments: [], due_cents: total,
      },
    });
    db.payments.push({ id: id(), client_key: 'demo-pay-2', parent_id: 'u-grace', payer_name: 'Grace Lin', period: month, amount_cents: Math.round(total / 2), method: 'zelle', received_on: next, reference: 'ZL-3310', note: 'First half', lines: [], owed_cents: total, recorded_by: 'u-admin', created_at: ago(1), voided_at: null, void_reason: null });
  })();

  // ---------------------------------------------------------------------------
  // Access rules (a simplified mirror of the real policies)

  const me = () => db.profiles.find((p) => p.id === meId) ?? null;
  const role = () => me()?.role ?? null;
  const isStaff = () => ['admin', 'tutor'].includes(role());
  const teaches = (studentId) => db.tutor_students.some((l) => l.tutor_id === meId && l.student_id === studentId);
  const childOf = (studentId) => db.parent_students.some((l) => l.parent_id === meId && l.student_id === studentId);
  const canSee = (studentId) => {
    switch (role()) {
      case 'admin': return true;
      case 'tutor': return teaches(studentId);
      case 'parent': return childOf(studentId);
      case 'student': return studentId === meId;
      default: return false;
    }
  };
  const canTeach = (studentId) => role() === 'admin' || (role() === 'tutor' && teaches(studentId));
  const adminOnly = () => role() === 'admin';
  const gradeVisible = (g) => canTeach(g.student_id) || (g.released_at && canSee(g.student_id));

  const READ = {
    profiles: (r) => r.id === meId || role() === 'admin'
      || (role() === 'tutor' && (['admin', 'tutor'].includes(r.role) || teaches(r.id) || db.parent_students.some((l) => l.parent_id === r.id && teaches(l.student_id))))
      || (role() === 'parent' && childOf(r.id))
      || (role() === 'student' && db.parent_students.some((l) => l.student_id === meId && l.parent_id === r.id)),
    tutor_students: (r) => role() === 'admin' || r.tutor_id === meId || canSee(r.student_id),
    parent_students: (r) => role() === 'admin' || r.parent_id === meId || (role() === 'tutor' && teaches(r.student_id)) || r.student_id === meId,
    tasks: (r) => canSee(r.student_id),
    submissions: (r) => canSee(r.student_id),
    grades: gradeVisible,
    submission_drafts: (r) => r.student_id === meId,
    updates: (r) => canTeach(r.student_id) || (role() === 'parent' && childOf(r.student_id)) || (role() === 'student' && r.visible_to_student && r.student_id === meId),
    sessions: (r) => canSee(r.student_id) || (isStaff() && r.tutor_id === meId),
    session_series: (r) => canSee(r.student_id) || (isStaff() && r.tutor_id === meId),
    materials: (r) => canSee(r.student_id),
  };
  const WRITE = {
    tasks: (r) => canTeach(r.student_id),
    grades: (r) => canTeach(r.student_id),
    updates: (r) => canTeach(r.student_id) && (role() === 'admin' || r.author_id === meId),
    sessions: (r) => role() === 'admin' || (r.tutor_id === meId && teaches(r.student_id)),
    session_series: (r) => role() === 'admin' || (r.tutor_id === meId && teaches(r.student_id)),
    materials: (r) => canTeach(r.student_id),
    submissions: (r) => canTeach(r.student_id) || (role() === 'student' && r.student_id === meId),
    submission_drafts: (r) => r.student_id === meId,
    tutor_students: () => role() === 'admin',
    parent_students: () => role() === 'admin',
    profiles: (r) => role() === 'admin' || r.id === meId,
  };
  const INSERT = {
    tasks: (r) => canTeach(r.student_id),
    updates: (r) => canTeach(r.student_id),
    sessions: (r) => canTeach(r.student_id),
    session_series: (r) => canTeach(r.student_id),
    materials: (r) => canTeach(r.student_id),
    // student_id defaults to the signed-in student, like the real column
    submissions: (r) => role() === 'student' && (r.student_id ?? meId) === meId,
    submission_drafts: (r) => (r.student_id ?? meId) === meId,
    tutor_students: () => role() === 'admin',
    parent_students: () => role() === 'admin',
    grades: (r) => canTeach(r.student_id),
  };
  const ADMIN_TABLES = ['referrals', 'site_reviews', 'review_invites', 'portal_invites', 'billing_settings', 'billing_policies', 'family_rates',
    'tutor_rates', 'session_billing', 'session_edits', 'payments', 'payouts', 'billing_adjustments', 'billing_contacts', 'statements'];
  for (const t of ADMIN_TABLES) {
    READ[t] = adminOnly;
    WRITE[t] = adminOnly;
    INSERT[t] = adminOnly;
  }
  const extraRpc = {};
  const extraFetch = {};
  const DEFAULTS = {};
  const KEYS = {
    submission_drafts: ['student_id', 'task_id'], session_billing: ['session_id'], billing_contacts: ['parent_id'],
    statements: ['parent_id', 'period'], grades: ['submission_id'], tutor_students: ['tutor_id', 'student_id'], parent_students: ['parent_id', 'student_id'],
  };

  // New rows get the defaults the database would fill in
  function create(table, v) {
    const stamp = new Date().toISOString();
    const base = { created_at: stamp };
    if (!KEYS[table] || table === 'grades') base.id = id();
    if (['tasks', 'sessions', 'session_series', 'materials', 'updates'].includes(table)) base.created_by = meId;
    if (table === 'updates') Object.assign(base, { author_id: meId, visible_to_student: true });
    if (table === 'tasks') Object.assign(base, { completed_at: null, details: null, due_at: null, session_id: null, series_id: null });
    if (table === 'sessions') {
      Object.assign(base, {
        tutor_id: meId, series_id: null, subject: null, location: null, meeting_url: null, notes: null, status: 'scheduled', attendance: null,
        recap: null, moved_from: null, changed_at: null, updated_at: stamp, cancelled_at: null, google_event_id: null, google_link: null, sync_state: 'local',
      });
    }
    if (table === 'session_series') {
      base.id = v.id ?? `ser-${id()}`;
      Object.assign(base, { until: null, updated_at: stamp });
    }
    if (table === 'submissions' || table === 'submission_drafts') base.student_id = meId;
    if (table === 'submissions') Object.assign(base, { status: 'pending', attempts: 1, error: null, status_changed_at: stamp, note: null, body: null, body_doc: null, storage_path: null, file_type: null });
    if (table === 'parent_students') base.bills = !db.parent_students.some((l) => l.student_id === v.student_id && l.bills);
    if (table === 'tutor_students') base.subject = null;
    if (['family_rates', 'tutor_rates', 'billing_policies', 'payments', 'payouts', 'billing_adjustments'].includes(table)) {
      Object.assign(base, { voided_at: null, void_reason: null, note: null, created_by: meId, recorded_by: meId });
    }
    if (table === 'portal_invites') Object.assign(base, { created_by: meId, expires_at: iso(Date.now() + 30 * DAY), used_at: null, emailed_to: null, emailed_at: null });
    if (table === 'review_invites') Object.assign(base, { created_by: meId, expires_at: iso(Date.now() + 60 * DAY), used_at: null });
    if (table === 'submission_drafts') base.updated_at = stamp;
    const extra = DEFAULTS[table] ? (typeof DEFAULTS[table] === 'function' ? DEFAULTS[table](v, helpers) : DEFAULTS[table]) : {};
    const row = { ...base, ...extra, ...v };
    // a new series makes its sessions, like the database trigger
    if (table === 'session_series') setTimeout(() => fillSeries(row), 0);
    return row;
  }

  function fillSeries(sr) {
    const start = new Date(`${sr.first_date}T12:00:00Z`);
    const until = sr.until ? new Date(`${sr.until}T12:00:00Z`) : new Date(start.getTime() + 70 * DAY);
    const offsetOf = (d) => Math.round((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(today[0], today[1] - 1, today[2])) / DAY);
    for (let d = start; d <= until; d = new Date(d.getTime() + 7 * DAY)) {
      const off = offsetOf(d);
      db.sessions.push(create('sessions', {
        student_id: sr.student_id, tutor_id: sr.tutor_id, series_id: sr.id, subject: sr.subject, location: sr.location, meeting_url: sr.meeting_url,
        notes: sr.notes, starts_at: pt(off, sr.start_time.slice(0, 5)), ends_at: pt(off, sr.end_time.slice(0, 5)), created_by: meId,
      }));
      sr.last_date = d.toISOString().slice(0, 10);
    }
    notify();
  }

  // Embedded relations in select strings, e.g. grade:grades(score, ...)
  function embed(table, row, cols) {
    const out = { ...row };
    for (const [, alias, target] of String(cols ?? '').matchAll(/(\w+):(\w+)(?:![\w]+)?\(/g)) {
      if (table === 'submissions' && target === 'grades') {
        const g = db.grades.find((x) => x.submission_id === row.id);
        out[alias] = g && gradeVisible(g) ? { ...g } : null;
      } else if (target === 'profiles') {
        const key = row.profile_id ?? row.student_id;
        const p = db.profiles.find((x) => x.id === key);
        out[alias] = p ? { ...p } : null;
      } else if (target === 'tasks') {
        const t = db.tasks.find((x) => x.id === row.task_id);
        out[alias] = t ? { ...t } : null;
      }
    }
    return out;
  }

  // For extend-*.js: the same building blocks the sample data and rules use
  const helpers = {
    get meId() { return meId; }, me, role, isStaff, teaches, childOf, canSee, canTeach, adminOnly, gradeVisible,
    id, iso, pt, ago, dayKey, dueAt, monthStart, NOW, DAY, PERSONAS,
  };

  // ---------------------------------------------------------------------------
  // The query builder

  const denied = (table) => ({ data: null, error: { code: '42501', message: `new row violates row-level security policy for table "${table}"` } });
  const cmp = (a, b) => (a === b ? 0 : a === null || a === undefined ? 1 : b === null || b === undefined ? -1 : a < b ? -1 : 1);

  class Query {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.filters = [];
      this.sorts = [];
      this.cols = '*';
      this.returning = null;
      this.opts = {};
    }
    select(cols = '*', opts = {}) {
      if (this.op === 'select') { this.cols = cols; this.opts = opts; } else this.returning = cols;
      return this;
    }
    insert(values) { this.op = 'insert'; this.values = [].concat(values); return this; }
    upsert(values, opts = {}) { this.op = 'upsert'; this.values = [].concat(values); this.upsertOpts = opts; return this; }
    update(values) { this.op = 'update'; this.values = values; return this; }
    delete() { this.op = 'delete'; return this; }
    filter(fn) { this.filters.push(fn); return this; }
    eq(c, v) { return this.filter((r) => String(r[c]) === String(v)); }
    neq(c, v) { return this.filter((r) => String(r[c]) !== String(v)); }
    in(c, vs) { const set = new Set([...vs].map(String)); return this.filter((r) => set.has(String(r[c]))); }
    is(c, v) { return this.filter((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); }
    not(c, op, v) { return op === 'is' && v === null ? this.filter((r) => r[c] !== null && r[c] !== undefined) : this.filter((r) => String(r[c]) !== String(v)); }
    gt(c, v) { return this.filter((r) => r[c] > v); }
    gte(c, v) { return this.filter((r) => r[c] >= v); }
    lt(c, v) { return this.filter((r) => r[c] < v); }
    lte(c, v) { return this.filter((r) => r[c] <= v); }
    ilike(c, p) { const re = new RegExp(`^${String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i'); return this.filter((r) => re.test(String(r[c] ?? ''))); }
    contains(c, v) { return this.filter((r) => [].concat(v).every((x) => [].concat(r[c] ?? []).includes(x))); }
    or(expr) {
      const parts = String(expr).split(',').map((p) => p.split('.'));
      return this.filter((r) => parts.some(([c, op, ...rest]) => {
        const v = rest.join('.');
        if (op === 'eq') return String(r[c]) === v;
        if (op === 'is') return v === 'null' ? r[c] === null || r[c] === undefined : String(r[c]) === v;
        return false;
      }));
    }
    match(obj) { for (const [c, v] of Object.entries(obj)) this.eq(c, v); return this; }
    order(c, { ascending = true } = {}) { this.sorts.push([c, ascending]); return this; }
    limit(n) { this.max = n; return this; }
    range(from, to) { this.from_ = from; this.to_ = to; return this; }
    maybeSingle() { this.single_ = 'maybe'; return this; }
    single() { this.single_ = 'one'; return this; }
    abortSignal() { return this; }
    throwOnError() { return this; }
    rows() {
      const read = READ[this.table] ?? (() => isStaff());
      return (db[this.table] ?? []).filter((r) => read(r) && this.filters.every((f) => f(r)));
    }
    shape(rows, cols) {
      let data = rows.map((r) => embed(this.table, r, cols));
      if (this.sorts.length) {
        data.sort((a, b) => {
          for (const [c, asc] of this.sorts) {
            const d = cmp(a[c], b[c]);
            if (d) return asc ? d : -d;
          }
          return 0;
        });
      }
      if (this.from_ !== undefined) data = data.slice(this.from_, this.to_ + 1);
      if (this.max) data = data.slice(0, this.max);
      if (this.single_ === 'one') return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
      if (this.single_ === 'maybe') return { data: data[0] ?? null, error: null };
      return { data, error: null, count: data.length };
    }
    run() {
      if (!meId) return { data: null, error: { code: '42501', message: 'permission denied' } };
      if (!db[this.table]) db[this.table] = [];
      const table = this.table;
      if (this.op === 'select') {
        if (this.opts.head) return { data: null, count: this.rows().length, error: null };
        return this.shape(this.rows(), this.cols);
      }
      if (this.op === 'insert' || this.op === 'upsert') {
        const check = INSERT[table] ?? (() => isStaff());
        const made = [];
        for (const v of this.values) {
          if (!check(v)) return denied(table);
          const keys = KEYS[table];
          const existing = this.op === 'upsert' && keys ? db[table].find((r) => keys.every((k) => String(r[k]) === String(v[k]))) : null;
          if (existing) { Object.assign(existing, v); made.push(existing); continue; }
          if (keys && db[table].some((r) => keys.every((k) => String(r[k]) === String(v[k])))) {
            return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${table}_pkey"` } };
          }
          if (v.client_key && db[table].some((r) => r.client_key === v.client_key)) {
            return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${table}_client_key_key"` } };
          }
          const row = create(table, v);
          db[table].push(row);
          made.push(row);
        }
        afterWrite(table, made, 'insert');
        return this.returning !== null ? this.shape(made, this.returning) : { data: null, error: null };
      }
      const write = WRITE[table] ?? (() => isStaff());
      const rows = this.rows().filter(write);
      if (this.op === 'update') {
        for (const r of rows) {
          if (table === 'sessions') logEdit(r, this.values);
          if (table === 'sessions' && this.values.status && this.values.status !== r.status) r.cancelled_at = this.values.status === 'cancelled' ? new Date().toISOString() : null;
          Object.assign(r, this.values);
          if (table === 'sessions') { r.updated_at = new Date().toISOString(); r.sync_state = 'local'; }
        }
        afterWrite(table, rows, 'update');
        return this.returning !== null ? this.shape(rows, this.returning) : { data: null, error: null };
      }
      // delete
      db[table] = db[table].filter((r) => !rows.includes(r));
      afterWrite(table, rows, 'delete');
      return this.returning !== null ? this.shape(rows, this.returning) : { data: null, error: null };
    }
    then(resolve, reject) {
      return new Promise((res) => setTimeout(() => res(this.run()), 60)).then(resolve, reject);
    }
  }

  function logEdit(r, v) {
    const keys = ['starts_at', 'ends_at', 'status', 'attendance'];
    if (!keys.some((k) => k in v && v[k] !== r[k])) return;
    db.session_edits.push({
      id: id(), session_id: r.id, student_id: r.student_id, tutor_id: r.tutor_id, editor: meId, action: 'update',
      old_starts_at: r.starts_at, new_starts_at: v.starts_at ?? r.starts_at, old_ends_at: r.ends_at, new_ends_at: v.ends_at ?? r.ends_at,
      old_status: r.status, new_status: v.status ?? r.status, old_attendance: r.attendance, new_attendance: 'attendance' in v ? v.attendance : r.attendance,
      at: new Date().toISOString(),
    });
  }

  function afterWrite(table, rows, kind) {
    // unlinking a tutor drops their sessions with that student that have not started
    if (table === 'tutor_students' && kind === 'delete') {
      for (const l of rows) db.sessions = db.sessions.filter((s) => !(s.tutor_id === l.tutor_id && s.student_id === l.student_id && Date.parse(s.starts_at) > Date.now()));
    }
    // a submission is graded a moment later, as a draft for the tutor to release
    if (table === 'submissions' && kind === 'insert') {
      for (const s of rows) setTimeout(() => gradeDraft(s), 2500);
    }
    notify();
  }

  function gradeDraft(s) {
    if (db.grades.some((g) => g.submission_id === s.id)) return;
    s.status = 'ai_graded';
    s.status_changed_at = new Date().toISOString();
    db.grades.push({ submission_id: s.id, student_id: s.student_id, score: 86, feedback: 'Demo draft: clear work on most problems. Check the last two answers.', reviewed_by: null, reviewed_at: null, released_at: null });
    notify();
  }

  // Lets open pages hear about writes made here (like realtime would)
  const listeners = new Set();
  function notify() { for (const fn of listeners) { try { fn(); } catch (e) { /* ignore */ } } }

  // ---------------------------------------------------------------------------
  // rpc

  async function rpc(name, args = {}) {
    await new Promise((r) => setTimeout(r, 60));
    if (!meId) return { data: null, error: { code: '42501', message: 'permission denied' } };
    switch (name) {
      case 'staff_names':
        return { data: db.profiles.filter((p) => ['tutor', 'admin'].includes(p.role)).map(({ id: pid, full_name }) => ({ id: pid, full_name })), error: null };
      case 'my_statements': {
        const rows = db.statements.filter((x) => x.parent_id === meId && x.snapshot).map((x) => ({
          period: x.period, sent_on: x.sent_on, due_cents: x.due_cents ?? x.snapshot.due_cents,
          paid_cents: db.payments.filter((p) => p.parent_id === meId && p.period === x.period && !p.voided_at).reduce((t, p) => t + p.amount_cents, 0),
          snapshot: x.snapshot,
        }));
        return { data: rows.sort((a, b) => b.period.localeCompare(a.period)), error: null };
      }
      case 'my_google_connection':
        return { data: [], error: null };
      case 'student_tutors': {
        if (!canSee(args.p_student)) return { data: [], error: null };
        const rows = db.tutor_students.filter((l) => l.student_id === args.p_student).map((l) => ({
          tutor_id: l.tutor_id, full_name: db.profiles.find((p) => p.id === l.tutor_id)?.full_name ?? '', subject: l.subject ?? null,
        }));
        return { data: rows.sort((a, b) => a.full_name.localeCompare(b.full_name)), error: null };
      }
      case 'set_task_done': {
        const t = db.tasks.find((x) => x.id === args.p_task_id && x.kind === 'task' && x.student_id === meId && role() === 'student');
        if (!t) return { data: null, error: { code: 'P0002', message: 'task not found' } };
        t.completed_at = args.p_done ? (t.completed_at ?? new Date().toISOString()) : null;
        notify();
        return { data: null, error: null };
      }
      case 'set_payer': {
        if (role() !== 'admin') return { data: null, error: { code: '42501', message: 'admin only' } };
        const links = db.parent_students.filter((l) => l.student_id === args.p_student);
        if (!links.some((l) => l.parent_id === args.p_parent)) return { data: null, error: { code: '22023', message: 'that parent is not linked to the student' } };
        for (const l of links) l.bills = l.parent_id === args.p_parent;
        notify();
        return { data: null, error: null };
      }
      case 'end_session_series': {
        const s = db.sessions.find((x) => String(x.id) === String(args.p_session));
        if (!s || !(role() === 'admin' || s.tutor_id === meId)) return { data: null, error: { code: '42501', message: 'not allowed' } };
        db.sessions = db.sessions.filter((x) => !(x.series_id === s.series_id && Date.parse(x.starts_at) >= Date.parse(s.starts_at)));
        const sr = db.session_series.find((x) => x.id === s.series_id);
        if (sr) sr.until = s.starts_at.slice(0, 10);
        notify();
        return { data: null, error: null };
      }
      case 'edit_following_sessions': {
        const s = db.sessions.find((x) => String(x.id) === String(args.p_session));
        if (!s || !(role() === 'admin' || s.tutor_id === meId)) return { data: { error: 'not allowed' }, error: null };
        const shift = (args.p_shift_minutes ?? 0) * 60000;
        const following = db.sessions.filter((x) => x.series_id === s.series_id && Date.parse(x.starts_at) >= Date.parse(s.starts_at));
        for (const x of following) {
          const start = Date.parse(x.starts_at) + shift;
          const length = args.p_minutes ? args.p_minutes * 60000 : Date.parse(x.ends_at) - Date.parse(x.starts_at);
          Object.assign(x, args.p_fields ?? {}, { starts_at: iso(start), ends_at: iso(start + length), updated_at: new Date().toISOString() });
        }
        notify();
        return { data: following.length, error: null };
      }
      default:
        if (extraRpc[name]) return extraRpc[name](args, helpers);
        return { data: null, error: { code: 'PGRST202', message: `function ${name} is not in the demo` } };
    }
  }

  // ---------------------------------------------------------------------------
  // /api answers (the real ones are Vercel functions)

  const realFetch = window.fetch.bind(window);
  const reply = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const sha256 = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');

  async function peopleApi(url, init, body) {
    const t = init.method === 'POST' ? body.t : url.searchParams.get('t');
    const hash = t ? await sha256(String(t)) : '';
    const inv = hash ? db.portal_invites.find((i) => i.token_hash === hash) : null;
    const person = inv && db.profiles.find((p) => p.id === inv.profile_id);
    const problem = !inv || !person ? 'invalid' : (inv.used_at || !person.no_login) ? 'used' : Date.parse(inv.expires_at) < Date.now() ? 'expired' : null;
    const kids = () => (person?.role === 'parent'
      ? db.parent_students.filter((l) => l.parent_id === person.id).map((l) => db.profiles.find((p) => p.id === l.student_id)?.full_name).filter(Boolean).sort() : []);
    const bad = () => reply(problem === 'invalid' ? 404 : 410, { error: problem });
    if (init.method !== 'POST' || body.action === 'lookup') return problem ? bad() : reply(200, { ok: true, name: person.full_name, role: person.role, children: kids(), email: inv.emailed_to ?? null });
    if (body.action === 'create') {
      if (role() !== 'admin') return reply(401, { error: 'unauthorized' });
      const name = String(body.full_name ?? '').trim();
      if (!name) return reply(422, { error: 'invalid', errors: { full_name: 'required' } });
      if (!['student', 'parent'].includes(body.role)) return reply(422, { error: 'invalid', errors: { role: 'invalid' } });
      const pid = `u-new-${id()}`;
      db.profiles.push(profile(pid, name, `no-login+${pid}@people.varunbaskaran.com`, body.role, { no_login: true, created_at: new Date().toISOString() }));
      return reply(201, { ok: true, id: pid });
    }
    if (body.action === 'email') {
      if (role() !== 'admin') return reply(401, { error: 'unauthorized' });
      if (problem) return bad();
      if (!/^\S+@\S+\.\S+$/.test(String(body.to ?? ''))) return reply(422, { error: 'invalid', errors: { to: 'invalid' } });
      Object.assign(inv, { emailed_to: String(body.to).trim().toLowerCase(), emailed_at: new Date().toISOString() });
      return reply(200, { ok: true });
    }
    if (body.action === 'use_signup') {
      if (role() !== 'admin') return reply(401, { error: 'unauthorized' });
      const signup = db.profiles.find((p) => p.id === body.signup_id);
      const target = db.profiles.find((p) => p.id === body.profile_id);
      if (!signup || signup.role !== 'pending') return reply(409, { error: 'not_pending' });
      if (!target || !target.no_login || !['student', 'parent'].includes(target.role)) return reply(409, { error: 'not_no_login' });
      db.profiles = db.profiles.filter((p) => p !== signup);
      db.portal_invites.push(create('portal_invites', { profile_id: target.id, token_hash: 'f'.repeat(64), emailed_to: signup.email, emailed_at: new Date().toISOString() }));
      return reply(200, { ok: true, to: signup.email });
    }
    if (body.action === 'join') {
      if (problem) return bad();
      const email = String(body.email ?? '').trim().toLowerCase();
      const errors = {};
      if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = 'invalid';
      if (String(body.password ?? '').length < 8) errors.password = 'too_short';
      if (Object.keys(errors).length) return reply(422, { error: 'invalid', errors });
      if (db.profiles.some((p) => p.email === email)) return reply(409, { error: 'email_taken' });
      inv.used_at = new Date().toISOString();
      Object.assign(person, { email, no_login: false });
      return reply(200, { ok: true, email });
    }
    return reply(400, { error: 'invalid' });
  }

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 120));
    const body = (() => { try { return JSON.parse(init.body ?? '{}'); } catch (e) { return {}; } })();
    if (extraFetch[url.pathname]) return extraFetch[url.pathname]({ url, init, body, reply, helpers });
    if (url.pathname === '/api/people') return peopleApi(url, init, body);
    if (url.pathname === '/api/grade') {
      const s = db.submissions.find((x) => String(x.id) === String(body.submission_id));
      if (!s) return reply(404, { error: 'Not found' });
      s.status = 'pending';
      setTimeout(() => gradeDraft(s), 1500);
      return reply(202, { ok: true });
    }
    if (url.pathname === '/api/testimonials') return reply(200, { ok: true });
    if (url.pathname === '/api/referral') return reply(201, { ok: true });
    if (url.pathname.startsWith('/api/google/')) {
      if (url.pathname === '/api/google/personal') return reply(200, { events: [] });
      return reply(503, { error: 'Google Calendar is not connected in the local demo.' });
    }
    return reply(404, { error: 'Not in the demo' });
  };

  // ---------------------------------------------------------------------------
  // The client

  const session = () => (meId ? { user: { id: meId, email: me()?.email }, access_token: 'demo-token' } : null);
  const authListeners = new Set();
  const setMe = (pid) => {
    meId = pid;
    try {
      if (pid) localStorage.setItem(KEY, Object.keys(PERSONAS).find((k) => PERSONAS[k] === pid) ?? pid);
      else localStorage.removeItem(KEY);
    } catch (e) { /* private mode */ }
    for (const fn of authListeners) fn(pid ? 'SIGNED_IN' : 'SIGNED_OUT', session());
  };
  const DEMO_FILE = (bucket) => (bucket === 'materials' ? '/tools/demo/demo-slides.svg' : '/tools/demo/demo-work.svg');
  // Files uploaded in this visit open as themselves; sample rows show demo pictures
  const uploads = new Map();
  const fileUrl = (bucket, path) => {
    const blob = uploads.get(`${bucket}/${path}`);
    return blob ? URL.createObjectURL(blob) : DEMO_FILE(bucket);
  };

  const client = {
    from: (table) => new Query(table),
    rpc,
    channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() {} }),
    removeChannel: () => {},
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (path) => ({ data: { signedUrl: fileUrl(bucket, path) }, error: null }),
        createSignedUrls: async (paths) => ({ data: paths.map((path) => ({ path, signedUrl: fileUrl(bucket, path), error: null })), error: null }),
        upload: async (path, body) => {
          await new Promise((r) => setTimeout(r, 400));
          if (body instanceof Blob) uploads.set(`${bucket}/${path}`, body);
          return { data: { path }, error: null };
        },
        copy: async (from, to) => {
          if (uploads.has(`${bucket}/${from}`)) uploads.set(`${bucket}/${to}`, uploads.get(`${bucket}/${from}`));
          return { data: { path: to }, error: null };
        },
        remove: async (paths) => ({ data: paths, error: null }),
      }),
    },
    auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
      getUser: async () => ({ data: { user: session()?.user ?? null }, error: null }),
      signInWithPassword: async ({ email }) => {
        const p = db.profiles.find((x) => x.email === String(email).trim().toLowerCase());
        if (!p) return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
        setMe(p.id);
        return { data: { user: session().user, session: session() }, error: null };
      },
      signUp: async ({ email, options }) => {
        const pid = `u-new-${id()}`;
        db.profiles.push(profile(pid, options?.data?.full_name ?? email, String(email).toLowerCase(), 'pending', { requested_role: options?.data?.requested_role ?? null, signup_note: options?.data?.signup_note ?? null, created_at: new Date().toISOString() }));
        return { data: { user: { id: pid, email }, session: null }, error: null };
      },
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
      updateUser: async () => ({ data: { user: session()?.user ?? null }, error: null }),
      signOut: async () => { setMe(null); return { error: null }; },
      onAuthStateChange: (fn) => {
        authListeners.add(fn);
        return { data: { subscription: { unsubscribe() { authListeners.delete(fn); } } } };
      },
    },
  };

  window.supabase = { createClient: () => client };
  // Feature branches extend the demo from tools/demo/extend-*.js (loaded right
  // after this file): add tables with rules and sample rows, rpc and /api answers.
  window.portalDemo = {
    db,
    helpers,
    as: (who) => { setMe(PERSONAS[who] ?? who); location.reload(); },
    onChange: (fn) => listeners.add(fn),
    notify,
    extend({ tables = {}, rpc: rpcs = {}, fetch: fetches = {} } = {}) {
      for (const [name, t] of Object.entries(tables)) {
        if (!db[name]) db[name] = [];
        if (t.rows) db[name].push(...(typeof t.rows === 'function' ? t.rows(helpers) : t.rows));
        if (t.read) READ[name] = t.read;
        if (t.write) WRITE[name] = t.write;
        if (t.insert) INSERT[name] = t.insert;
        if (t.keys) KEYS[name] = t.keys;
        if (t.defaults) DEFAULTS[name] = t.defaults;
      }
      Object.assign(extraRpc, rpcs);
      Object.assign(extraFetch, fetches);
    },
  };
})();
