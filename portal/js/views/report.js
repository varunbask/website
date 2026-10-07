// Progress report view, #/report. One student, one period (Last 30 days, Last
// 90 days or This school year): sessions and attendance, homework, released
// results (Completed, Missing, Extended), and the session notes. Families and
// staff see the same report, built only from what the portal already loads;
// results count only once released. "Print or save as PDF" prints just the
// report (report.css @media print). The numbers come from report-model.js.

import { h, uid } from '../dom.js';
import { icon } from '../icons.js';
import { button, segmented, emptyState, errorCallout, skeletonRows } from '../ui.js';
import { staffNames } from '../updates-feed.js';
import { displayName, firstName } from '../format.js';
import { SITE } from '../app-model.js';
import { rateText } from '../results.js';
import {
  PERIODS, DEFAULT_PERIOD, normalizePeriod, buildReport,
} from '../report-model.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Pieces of the sheet

// One figure: a label, a big value, an optional line under it
function stat(label, value, { note = null, tone = null, glyph = null, text = false } = {}) {
  const cls = ['rpt-stat', tone ? `is-${tone}` : null, text ? 'is-text' : null].filter(Boolean).join(' ');
  return h('div', { class: cls },
    h('dt', { class: 'rpt-stat-label' }, label),
    h('dd', { class: 'rpt-stat-value' }, glyph, h('span', {}, String(value))),
    note ? h('dd', { class: 'rpt-stat-note' }, note) : null);
}

function section(title, ...children) {
  const id = uid('rpt-sec');
  return h('section', { class: 'rpt-section', 'aria-labelledby': id },
    h('h3', { class: 'rpt-h', id }, title),
    children);
}

const stats = (...items) => h('dl', { class: 'rpt-stats' }, items);
const empty = (text) => h('p', { class: 'rpt-empty' }, text);
const foot = (text) => h('p', { class: 'rpt-foot' }, text);

function meta(label, ...value) {
  return h('div', {}, h('dt', {}, label), h('dd', {}, value));
}

function head(r) {
  const id = uid('rpt-student');
  const { people } = r;
  return {
    id,
    node: h('header', { class: 'rpt-head' },
      h('div', { class: 'rpt-title' },
        h('p', { class: 'rpt-org' }, SITE),
        h('p', { class: 'rpt-kicker' }, 'Progress report'),
        h('h2', { class: 'rpt-student', id }, r.studentName)),
      h('dl', { class: 'rpt-meta' },
        meta('Period', r.period.label, h('span', { class: 'rpt-meta-sub' }, r.period.text)),
        people.tutors.length ? meta(people.tutors.length === 1 ? 'Tutor' : 'Tutors', people.tutors.join(', ')) : null,
        people.subjects.length ? meta(people.subjects.length === 1 ? 'Subject' : 'Subjects', people.subjects.join(', ')) : null,
        meta('Prepared', r.preparedText))),
  };
}

function sessionsSection(r) {
  const s = r.sessions;
  if (!s.total) return section('Sessions', empty('No sessions in this period.'));
  const lines = [];
  if (s.attendancePercent !== null) lines.push(`Attendance rate: ${s.attendancePercent}% of sessions with attendance recorded.`);
  if (s.unrecorded) lines.push(`${plural(s.unrecorded, 'finished session has', 'finished sessions have')} no attendance recorded yet.`);
  return section('Sessions',
    stats(
      stat('Held', s.held),
      stat('Attended', s.attended, { note: s.late ? `${s.late} arrived late` : null }),
      stat('Absent', s.absent, { tone: s.absent ? 'warn' : null }),
      stat('Cancelled', s.cancelled),
      stat('Hours attended', s.hours)),
    lines.map(foot));
}

// Handed in (or ticked) by the due date or after it; the tutor's verdict on
// the work is in Results, so these say "Done" rather than "Completed"
function homeworkSection(r) {
  const w = r.homework;
  if (!w.assigned) return section('Homework', empty('No homework was due in this period.'));
  return section('Homework',
    stats(
      stat('Assigned', w.assigned),
      stat('Done on time', w.onTime),
      stat('Done late', w.late, { tone: w.late ? 'warn' : null }),
      stat('Not done', w.missing, { tone: w.missing ? 'bad' : null })),
    w.open ? foot(`${w.open} still open, not due yet.`) : null,
    foot('Homework is counted in the period it was due.'));
}

function resultsSection(r) {
  const c = r.results;
  if (!c.total && !c.extended) return section('Results', empty('No results in this period.'));
  return section('Results',
    stats(
      stat('Completed', c.completed, { note: `of ${plural(c.total, 'assignment', 'assignments')}` }),
      stat('Missing', c.missing, { tone: c.missing ? 'bad' : null }),
      c.rate === null
        ? stat('Completion rate', 'Not yet', { text: true, note: 'Needs a released result' })
        : stat('Completion rate', rateText(c.rate), { tone: c.rate >= 0.8 ? 'good' : null }),
      stat('Extended', c.extended, { note: c.extended ? 'more time, not counted yet' : null })),
    foot('Each assignment counts once, by the latest result the tutor released. Work never handed in counts as missing once it is past due, and extended work once its new due date has passed.'));
}

function notesSection(r) {
  if (!r.notes.length) return section('Session notes', empty('No session notes in this period.'));
  return section('Session notes',
    h('ol', { class: 'rpt-notes' }, r.notes.map((n) => h('li', { class: 'rpt-note' },
      h('div', { class: 'rpt-note-head' },
        h('time', { class: 'rpt-note-date', datetime: n.day }, n.dateText),
        h('span', {}, n.subject),
        n.tutor ? h('span', {}, `with ${n.tutor}`) : null),
      h('p', { class: 'rpt-note-body' }, n.recap)))));
}

// The printable sheet for one report
function sheet(r) {
  const top = head(r);
  return h('article', { class: 'rpt-sheet', 'aria-labelledby': top.id },
    top.node,
    sessionsSection(r),
    homeworkSection(r),
    resultsSection(r),
    notesSection(r));
}

// ---------------------------------------------------------------------------
// View

export async function mount(ctx) {
  const student = ctx.scope?.student ?? null;
  const staff = ctx.audience === 'staff';
  const title = 'Progress report';

  const printButton = button({
    label: 'Print or save as PDF', icon: 'printer', variant: 'primary', disabled: true, onClick: () => window.print(),
  });
  const whose = ctx.role === 'student' ? 'Your' : `${student ? firstName(displayName(student)) : 'The student'}’s`;
  ctx.setHeader({
    title,
    lede: `${whose} sessions, homework, results and session notes. Print it or save it as a PDF to share.`,
    actions: printButton,
  });

  if (!student) {
    ctx.host.append(emptyState({ icon: 'file-text', text: 'Choose a student to see their progress report.' }));
    ctx.announce(title);
    return;
  }

  const studentId = student.id;
  const root = h('div', { class: 'rpt-root' }, skeletonRows(4));
  ctx.host.append(root);

  let data;
  let sessions;
  let tutors;
  let names;
  try {
    // Tutors and names only decorate the header and the notes: a failure there
    // leaves them out instead of blocking the report
    [data, sessions, tutors, names] = await Promise.all([
      ctx.store.getStudentData(studentId),
      ctx.store.getSessions(studentId),
      ctx.store.getTutors(studentId).catch(() => []),
      staffNames().catch(() => new Map()),
    ]);
  } catch (error) {
    if (!ctx.alive()) return;
    console.error(error);
    root.replaceChildren(errorCallout({
      title: 'We couldn’t load the report.',
      text: 'Check your connection and try again.',
      onRetry: () => ctx.store.invalidate(studentId),
    }));
    ctx.announce(`${title}, could not load`);
    return;
  }
  if (!ctx.alive()) return;

  let periodKey = normalizePeriod(ctx.route.params?.period);
  const sheetHost = h('div', { class: 'rpt-sheet-host' });
  const status = h('p', { class: 'visually-hidden', role: 'status' });

  function build() {
    return buildReport({
      studentName: displayName(student),
      sessions,
      tasks: data.tasks,
      submissions: data.submissions,
      tutors,
      names,
      periodKey,
      now: ctx.now,
    });
  }

  let report = build();
  function paint() {
    report = build();
    sheetHost.replaceChildren(sheet(report));
  }

  const control = segmented({
    label: 'Report period',
    options: PERIODS.map((p) => ({ value: p.key, label: p.label })),
    value: periodKey,
    onChange: (value) => {
      periodKey = normalizePeriod(value);
      ctx.setParams({ period: periodKey === DEFAULT_PERIOD ? null : periodKey }, { replace: true });
      paint();
      status.textContent = `Showing ${report.period.label}, ${report.period.text}.`;
    },
  });

  // Staff see drafts in the data; the report leaves them out, and says so here
  // (not in the sheet, which is the part that gets shared)
  const notes = [h('p', { class: 'field-hint' }, 'In the print dialog, turn off headers and footers so the page address is not printed.')];
  if (staff && report.unreleased) {
    const n = report.unreleased;
    notes.unshift(h('p', { class: 'field-hint rpt-draft-note' },
      icon('info'),
      h('span', {}, `${plural(n, 'graded assignment is', 'graded assignments are')} not released yet, so ${n === 1 ? 'its result is' : 'their results are'} left out of this report.`)));
  }

  paint();
  root.replaceChildren(
    h('div', { class: 'rpt-bar' },
      h('div', { class: 'rpt-period-scroll' }, control),
      notes),
    status,
    sheetHost);
  printButton.disabled = false;
  ctx.announce(`${title}, ${report.period.label}`);
}
