// The forms of the session drawer (spec "Session drawer"). Staff only.
//
//   sessionForm(dctx, options) -> HTMLElement
//     Create (no `session`) or edit (`session`) a tutoring session.
//       session    the session being edited, or null to create one
//       ws         the staff workspace (students, sessions, links)
//       names      Map of tutor and admin ids to names (staffNames())
//       students   create: profiles for the Student select, or null when the
//                  student is fixed (a student scope)
//       student    create: the profile the select starts on, or the fixed one
//       params     create: the drawer params (due, at) that prefill the form
//       siblings   edit: every session of the student (the series and the
//                  clash check)
//       onCancel   Cancel in edit mode (create closes the drawer)
//       onSaved    after a successful edit (create opens the new session)
//
//   sessionNotesForm(dctx, { session, onCancel, onSaved }) -> HTMLElement
//     Attendance and recap after a session. Saves only those two columns.
//
// Each puts its title in an h2.drawer-title and its buttons in the drawer
// footer (dctx.setFooter). The caller inserts the element into dctx.body and
// then calls dctx.setTitle(el.dataset.title).

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import {
  button, field, select, segmented, setSegmented, setFieldError, busy, drawerHref,
} from './ui.js';
import { sb } from './supabase.js';
import { choiceDialog } from './overlays.js';
import { displayName, canHaveSessions } from './format.js';
import { viewerIsInBusinessZone, dayKey } from './dates.js';
import { getGoogleStatus, personalEvents, syncSoon } from './google.js';
import { personalClashes, mergePersonalClashes, dayRange } from './google-model.js';
import { ATTENDANCE, addMinutesToTime, followingInSeries, sessionTitle } from './sessions-model.js';
import {
  QUICK_DURATIONS, DEFAULT_START, DEFAULT_MINUTES, MIN_REPEAT_COUNT, MAX_REPEAT_COUNT, MAX_RECAP_LENGTH, GONE,
  createDefaults, editDefaults, minutesBetween, tutorChoices, subjectsFor, defaultSubject,
  checkSessionForm, plannedTimes, buildInsertRow, buildSeriesRow, buildUpdates, changedUpdates, followingChange,
  mergeSessions, scheduleLabel, repeatChoices, repeatSummary, clashReport, saveErrorText, whenText,
} from './session-form-model.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const sameId = (a, b) => String(a) === String(b);

// A callout in the portal's shape. lines: a bulleted list under the title.
export function callout({ tone = 'neutral', icon: iconName = 'info', title, text, role, lines, className } = {}) {
  const glyph = icon(iconName, { size: 20 });
  glyph.classList.add('callout-icon');
  return h('div', { class: ['callout', `tone-${tone}`, className].filter(Boolean).join(' '), role },
    glyph,
    h('div', { class: 'callout-body' },
      title ? h('p', { class: 'callout-title' }, title) : null,
      lines?.length ? h('ul', { class: 'ses-callout-list' }, lines.map((line) => h('li', {}, line))) : null,
      text ? h('p', { class: 'callout-text' }, text) : null));
}

function dangerCallout(title, text) {
  return callout({ tone: 'danger', icon: 'warning-circle', title, text, role: 'alert', className: 'ses-form-error' });
}

// A label above a control that is not a form control itself (a segmented group)
function groupField(label, group, hint) {
  return h('div', { class: 'field' },
    h('span', { class: 'field-label', 'aria-hidden': 'true' }, label),
    group,
    hint || null);
}

// Enter in a single-line field saves (a textarea keeps its new lines)
function submitOnEnter(form, submit) {
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type === 'checkbox' || t.type === 'radio') return;
    e.preventDefault();
    form.requestSubmit(submit);
  });
}

// ---------------------------------------------------------------------------
// Create and edit

export function sessionForm(dctx, {
  session = null, ws = null, names = new Map(), students = null, student = null,
  params = {}, siblings = [], onCancel, onSaved,
} = {}) {
  const editing = Boolean(session);
  const me = dctx.me;
  const isAdmin = me?.role === 'admin';
  const links = ws?.links ?? [];
  const formId = uid('session-form');
  const now = new Date();
  const title = editing ? 'Edit session' : 'New session';

  const studentNames = new Map((ws?.students ?? []).map((s) => [String(s.id), displayName(s)]));
  if (student) studentNames.set(String(student.id), displayName(student));

  // The student: fixed, or chosen in a select
  const studentStart = editing ? String(session.student_id)
    : (student && (!students || students.some((s) => sameId(s.id, student.id))) ? String(student.id) : '');
  let studentSelect = null;
  let studentField = null;
  if (!editing && Array.isArray(students)) {
    const wrap = select({
      name: 'student',
      required: true,
      options: [
        { value: '', label: 'Choose a student', disabled: true },
        ...students.map((s) => ({ value: s.id, label: displayName(s) })),
      ],
      value: studentStart,
    });
    studentSelect = wrap.querySelector('select');
    studentField = field({ label: 'Student', control: wrap });
  }
  const currentStudentId = () => (studentSelect ? studentSelect.value : studentStart);

  // The tutor: an admin picks among the student's tutors; a tutor books as themselves
  let tutorSelect = null;
  let tutorField = null;
  if (!editing && isAdmin) {
    const wrap = select({ name: 'tutor', required: true, options: [{ value: '', label: 'Choose a student first' }] });
    tutorSelect = wrap.querySelector('select');
    tutorField = field({ label: 'Tutor', control: wrap });
  }
  const tutorsFor = (studentId) => tutorChoices({ links, studentId, me, names });
  const currentTutorId = () => {
    if (editing) return String(session.tutor_id);
    if (tutorSelect) return tutorSelect.value;
    return tutorsFor(currentStudentId())[0]?.value ?? '';
  };
  function fillTutors() {
    if (!tutorSelect) return;
    const choices = tutorsFor(currentStudentId());
    const before = tutorSelect.value;
    const list = choices.length ? choices : [{ value: '', label: currentStudentId() ? 'No tutor assigned' : 'Choose a student first' }];
    tutorSelect.replaceChildren(...list.map((c) => h('option', { value: c.value }, c.label)));
    tutorSelect.value = choices.some((c) => c.value === before) ? before : (choices[0]?.value ?? '');
  }

  // Starting values
  const defaults = editing
    ? editDefaults(session)
    : createDefaults({ params, now, subject: defaultSubject(links, tutorChoices({ links, studentId: studentStart, me, names })[0]?.value, studentStart) });
  let where = defaults.where;

  // Fields
  const heading = h('h2', { class: 'drawer-title', tabindex: '-1' }, title);

  const subjectListId = `${formId}-subjects`;
  const subjectInput = h('input', {
    type: 'text', class: 'input', name: 'subject', maxlength: '60', autocomplete: 'off', list: subjectListId, value: defaults.subject,
  });
  const subjectList = h('datalist', { id: subjectListId });
  const subjectField = field({ label: 'Subject', optional: true, control: subjectInput });
  const fillSubjects = () => subjectList.replaceChildren(...subjectsFor(links, currentStudentId()).map((s) => h('option', { value: s })));
  let subjectDirty = editing;
  subjectInput.addEventListener('input', () => { subjectDirty = true; });
  function applyDefaultSubject() {
    if (editing || subjectDirty) return;
    subjectInput.value = defaultSubject(links, currentTutorId(), currentStudentId());
  }

  const dateInput = h('input', { type: 'date', class: 'input ses-date', name: 'date', required: true, value: defaults.date });
  const dateField = field({ label: 'Date', control: dateInput });
  const startInput = h('input', { type: 'time', class: 'input', name: 'start', required: true, value: defaults.start });
  const startField = field({ label: 'Start', control: startInput });
  const endInput = h('input', { type: 'time', class: 'input', name: 'end', required: true, value: defaults.end });
  const endField = field({ label: 'End', control: endInput });

  let duration = minutesBetween(defaults.start, defaults.end) ?? DEFAULT_MINUTES;
  const lengthGroup = segmented({
    label: 'Length in minutes',
    className: 'ses-durations',
    block: true,
    options: QUICK_DURATIONS.map((m) => ({ value: m, label: `${m} min` })),
    value: duration,
    onChange: (m) => {
      if (!TIME_RE.test(startInput.value)) startInput.value = DEFAULT_START;
      duration = m;
      endInput.value = addMinutesToTime(startInput.value, m);
      onTimesChanged();
    },
  });
  const lengthField = groupField('Length', lengthGroup);
  const syncLength = () => setSegmented(lengthGroup, minutesBetween(startInput.value, endInput.value) ?? '');

  const whereGroup = segmented({
    label: 'Where',
    block: true,
    options: [{ value: 'in-person', label: 'In person' }, { value: 'online', label: 'Online' }],
    value: where,
    onChange: (value) => {
      where = value;
      showWhere();
      clearFixedErrors();
    },
  });
  const whereField = groupField('Where', whereGroup);
  const locationInput = h('input', {
    type: 'text', class: 'input', name: 'location', maxlength: '200', autocomplete: 'off', value: defaults.location,
  });
  const locationField = field({ label: 'Location', optional: true, control: locationInput });
  const urlInput = h('input', {
    type: 'url', class: 'input', name: 'meeting_url', maxlength: '500', autocomplete: 'off', inputmode: 'url', value: defaults.meeting_url,
  });
  const urlField = field({ label: 'Meeting link', optional: true, hint: 'Starts with https://', control: urlInput });
  function showWhere() {
    locationField.hidden = where !== 'in-person';
    urlField.hidden = where !== 'online';
  }
  showWhere();

  const notesInput = h('textarea', { class: 'input textarea', name: 'notes', rows: '4', maxlength: '2000' }, defaults.notes);
  const notesField = field({
    label: 'Plan for the session', optional: true, hint: 'The student and family can see this.', control: notesInput,
  });

  // Repeat (create only), like Google Calendar: "Does not repeat" or "Weekly
  // on Tuesday", which never ends unless it ends on a date or after a count
  let repeatSelect = null;
  let repeatGroup = null;
  let endsValue = defaults.ends;
  let untilInput = null;
  let untilField = null;
  let countInput = null;
  let countField = null;
  let endsBox = null;
  let repeatHint = null;
  if (!editing) {
    const repeatWrap = select({ name: 'repeat', options: repeatChoices(defaults.date), value: 'none' });
    repeatSelect = repeatWrap.querySelector('select');
    const repeatField = field({ label: 'Repeat', control: repeatWrap });
    const endsGroup = segmented({
      label: 'Ends',
      block: true,
      options: [{ value: 'never', label: 'Never' }, { value: 'on', label: 'On a date' }, { value: 'after', label: 'After' }],
      value: endsValue,
      onChange: (value) => {
        endsValue = value;
        showEnds();
        onTimesChanged();
      },
    });
    untilInput = h('input', { type: 'date', class: 'input ses-date', name: 'until', value: defaults.until });
    untilField = field({ label: 'Last day', control: untilInput });
    countInput = h('input', {
      type: 'number', class: 'input ses-weeks-input', name: 'count', min: String(MIN_REPEAT_COUNT), max: String(MAX_REPEAT_COUNT),
      inputmode: 'numeric', value: defaults.count,
    });
    countField = field({ label: 'Number of sessions', control: countInput });
    repeatHint = h('p', { class: 'field-hint ses-repeat-hint', role: 'status' });
    endsBox = h('div', { class: 'ses-repeat-ends' }, groupField('Ends', endsGroup), untilField, countField, repeatHint);
    repeatGroup = h('div', { class: 'ses-repeat' }, repeatField, endsBox);
  }
  function showEnds() {
    if (!repeatGroup) return;
    endsBox.hidden = repeatSelect.value !== 'weekly';
    untilField.hidden = endsValue !== 'on';
    countField.hidden = endsValue !== 'after';
  }
  showEnds();

  // Editing a session of a series asks, on save, whether the change is for
  // this session or this and following (Google Calendar asks the same)
  const rows = editing ? followingInSeries(siblings, session) : null;
  const inSeries = Boolean(editing && session.series_id && rows.length > 1);

  const zoneHint = viewerIsInBusinessZone(now) ? null : h('p', { class: 'field-hint ses-zone-hint' }, 'Times are Pacific time (PT).');
  const clashSlot = h('div', { class: 'ses-clash' });
  const errorSlot = h('div', { class: 'ses-form-errors' });

  const sub = editing
    ? h('p', { class: 'ses-form-sub' }, [
      studentNames.get(String(session.student_id)) ?? 'Student',
      names.get(String(session.tutor_id)) ? `with ${names.get(String(session.tutor_id))}` : null,
    ].filter(Boolean).join(', '))
    : null;

  const seriesNote = inSeries
    ? h('p', { class: 'note ses-series-note' }, icon('repeat'), h('span', {}, 'This session repeats weekly. When you save, you choose this session or this and following.'))
    : null;

  const form = h('form', { class: 'ses-form', id: formId, novalidate: true },
    seriesNote, studentField, tutorField,
    subjectField, subjectList,
    dateField,
    h('div', { class: 'ses-times' }, startField, endField),
    lengthField, zoneHint,
    repeatGroup,
    // Next to the times it is about, so it shows while the tutor picks them
    clashSlot,
    whereField, locationField, urlField,
    notesField,
    errorSlot);
  const root = h('div', { class: 'ses-form-wrap', dataset: { title } }, heading, sub, form);

  // Footer
  const submit = button({
    label: editing ? 'Save changes' : scheduleLabel(false),
    variant: 'primary',
    type: 'submit',
    focusKey: editing ? 'save-session' : 'create-session',
  });
  submit.setAttribute('form', formId);
  const cancel = button({
    label: 'Cancel', variant: 'ghost', onClick: () => (editing ? onCancel?.() : dctx.close()),
  });
  dctx.setFooter([cancel, submit]);
  submitOnEnter(form, submit);

  // Current values
  const read = () => ({
    date: dateInput.value,
    start: startInput.value,
    end: endInput.value,
    subject: subjectInput.value,
    where,
    location: locationInput.value,
    meeting_url: urlInput.value,
    notes: notesInput.value,
    repeat: repeatSelect?.value === 'weekly',
    ends: endsValue,
    until: untilInput?.value ?? '',
    count: countInput?.value ?? '',
  });

  const fields = {
    subject: subjectField, date: dateField, start: startField, end: endField,
    location: locationField, meeting_url: urlField, notes: notesField, until: untilField, count: countField,
  };
  const controls = {
    subject: subjectInput, date: dateInput, start: startInput, end: endInput,
    location: locationInput, meeting_url: urlInput, notes: notesInput, until: untilInput, count: countInput,
  };
  const ORDER = ['subject', 'date', 'start', 'end', 'until', 'count', 'location', 'meeting_url', 'notes'];

  // Errors already on screen go away as soon as the field is right
  function clearFixedErrors() {
    const { errors } = checkSessionForm(read(), { creating: !editing });
    for (const key of ORDER) {
      const el = fields[key];
      if (el?.querySelector(':scope > .field-error') && !errors[key]) setFieldError(el, '');
    }
  }

  // Clash warning --------------------------------------------------------

  const studentLists = new Map();   // student id -> every session of that student
  const loading = new Set();
  if (editing) studentLists.set(String(session.student_id), siblings);
  let clashKey = null;

  // A tutor (or teaching admin) scheduling their own session with Google sync on is also told what
  // their Google Calendar has at that time. One fetch per day; if it fails, or
  // sync is off, nothing extra is said.
  const personalDays = new Map();   // day key -> that day's personal events
  const personalLoading = new Set();
  let personalOn = false;
  if (canHaveSessions(me?.role)) {
    getGoogleStatus().then((status) => {
      if (!dctx.alive() || !status.connected || !status.sync_enabled) return;
      personalOn = true;
      refreshClash();
    });
  }

  function ensurePersonalDay(key) {
    if (personalDays.has(key) || personalLoading.has(key)) return;
    personalLoading.add(key);
    const { from, to } = dayRange(key);
    Promise.resolve(personalEvents(from, to))
      .catch(() => [])
      .then((events) => {
        personalDays.set(key, events);
        personalLoading.delete(key);
        if (dctx.alive()) refreshClash();
      });
  }

  function ensureStudentSessions(id) {
    if (!id || studentLists.has(id) || loading.has(id)) return;
    loading.add(id);
    Promise.resolve(dctx.store.getSessions(id))
      .then((list) => { studentLists.set(id, list ?? []); }, () => { studentLists.set(id, []); })
      .finally(() => {
        loading.delete(id);
        if (dctx.alive() && id === currentStudentId()) refreshClash();
      });
  }

  function refreshClash() {
    const sid = currentStudentId();
    const tid = currentTutorId();
    let report = null;
    if (sid && tid) {
      ensureStudentSessions(sid);
      const check = checkSessionForm(read(), { creating: !editing });
      if (!check.errors.date && !check.errors.start && !check.errors.end) {
        const planned = plannedTimes(check.values, { session });
        const list = mergeSessions(
          studentLists.get(sid) ?? [],
          (ws?.sessions ?? []).filter((s) => sameId(s.tutor_id, tid)),
        );
        report = clashReport({
          planned,
          studentId: sid,
          tutorId: tid,
          list,
          ignoreIds: editing ? planned.map((p) => p.id) : [],
          tutorNames: names,
          studentNames,
        });
        // The chosen day only, and only for the tutor's own sessions
        if (personalOn && sameId(tid, me.id)) {
          const key = dayKey(planned[0].starts_at);
          ensurePersonalDay(key);
          report = mergePersonalClashes(report, personalClashes(planned[0], personalDays.get(key) ?? []));
        }
      }
    }
    const key = report?.title ? [report.title, ...report.lines].join('|') : '';
    if (key === clashKey) return;
    clashKey = key;
    clashSlot.replaceChildren(...(report?.title
      ? [callout({
        tone: 'warning',
        icon: 'warning-circle',
        title: report.title,
        lines: report.lines,
        text: 'You can still save it.',
        role: 'status',
        className: 'ses-clash-callout',
      })]
      : []));
  }

  function updateScheduleLabel() {
    if (editing) return;
    const state = read();
    const label = submit.querySelector('.btn-label');
    if (label) label.textContent = scheduleLabel(state.repeat);
    // "Weekly on Tuesday" follows the date
    const choices = repeatChoices(dateInput.value);
    for (const opt of repeatSelect.options) {
      const c = choices.find((x) => x.value === opt.value);
      if (c && opt.textContent !== c.label) opt.textContent = c.label;
    }
    repeatHint.textContent = state.repeat ? repeatSummary(state) : '';
  }

  function onTimesChanged() {
    syncLength();
    clearFixedErrors();
    refreshClash();
    updateScheduleLabel();
  }

  // Changing the start keeps the length; changing the end sets a new length
  startInput.addEventListener('input', () => {
    if (TIME_RE.test(startInput.value)) endInput.value = addMinutesToTime(startInput.value, duration);
    onTimesChanged();
  });
  endInput.addEventListener('input', () => {
    duration = minutesBetween(startInput.value, endInput.value) ?? duration;
    onTimesChanged();
  });
  dateInput.addEventListener('input', onTimesChanged);
  dateInput.addEventListener('change', onTimesChanged);
  for (const el of [subjectInput, locationInput, urlInput, notesInput]) el.addEventListener('input', clearFixedErrors);
  repeatSelect?.addEventListener('change', () => {
    showEnds();
    onTimesChanged();
  });
  untilInput?.addEventListener('input', onTimesChanged);
  untilInput?.addEventListener('change', onTimesChanged);
  countInput?.addEventListener('input', onTimesChanged);

  studentSelect?.addEventListener('change', () => {
    setFieldError(studentField, '');
    fillTutors();
    fillSubjects();
    applyDefaultSubject();
    refreshClash();
  });
  tutorSelect?.addEventListener('change', () => {
    setFieldError(tutorField, '');
    applyDefaultSubject();
    refreshClash();
  });

  fillTutors();
  if (!editing) {
    // The tutor select starts on the first tutor of the chosen student
    applyDefaultSubject();
  }
  fillSubjects();
  refreshClash();
  syncLength();
  updateScheduleLabel();

  // Save -----------------------------------------------------------------

  let saving = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    errorSlot.replaceChildren();

    const state = read();
    const check = checkSessionForm(state, { creating: !editing });
    const sid = currentStudentId();
    const tid = currentTutorId();

    let firstInvalid = null;
    const flag = (fieldEl, control, message) => {
      if (!fieldEl) return;
      setFieldError(fieldEl, message);
      if (message && !firstInvalid) firstInvalid = control;
    };
    if (studentSelect) flag(studentField, studentSelect, sid ? '' : 'Choose a student.');
    if (tutorSelect) {
      flag(tutorField, tutorSelect, tid ? '' : (sid ? 'This student has no tutor yet. Link a tutor first.' : 'Choose a student first.'));
    }
    for (const key of ORDER) flag(fields[key], controls[key], check.errors[key] ?? '');
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }
    if (!sid || !tid) {
      errorSlot.append(dangerCallout('You can’t schedule this student.', 'You can only schedule sessions for students you tutor.'));
      return;
    }

    saving = true;
    try {
      // A series asks first (nothing to ask when nothing changed)
      let apply = 'this';
      if (editing && inSeries && followingChange({ values: check.values, session })) {
        apply = await choiceDialog({
          title: 'Edit repeating session',
          body: 'Change only this session, or this one and every session after it?',
          choices: [{ value: 'following', label: 'This and following' }, { value: 'this', label: 'This session', primary: true }],
        });
        if (!apply || !dctx.alive()) return;
      }
      await busy(submit, editing ? 'Saving…' : 'Scheduling…', async () => {
        if (editing && apply === 'following') await saveFollowing(check.values);
        else if (editing) await saveEdit(check.values);
        else if (check.values.repeat) await saveSeries(check.values, sid, tid);
        else await saveNew(check.values, sid, tid);
      });
    } finally {
      saving = false;
    }
  });

  function showError(titleText, text) {
    if (!dctx.alive()) return;
    errorSlot.append(dangerCallout(titleText, text));
    errorSlot.scrollIntoView?.({ block: 'nearest' });
  }

  async function saveNew(values, sid, tid) {
    const result = await sb.from('sessions').insert([buildInsertRow({ studentId: sid, tutorId: tid, values })]).select('id');
    if (result.error || !result.data?.length) {
      if (result.error) console.error(result.error);
      showError('We couldn’t schedule this.', saveErrorText(result.error));
      return;
    }
    scheduled(sid, tid, 'Session scheduled', result.data[0].id);
  }

  // A weekly series: the database makes its sessions (a year ahead, topped up daily)
  async function saveSeries(values, sid, tid) {
    const row = buildSeriesRow({ studentId: sid, tutorId: tid, values });
    const result = await sb.from('session_series').insert(row).select('id');
    if (result.error || !result.data?.length) {
      if (result.error) console.error(result.error);
      showError('We couldn’t schedule this.', saveErrorText(result.error));
      return;
    }
    const first = await sb.from('sessions').select('id').eq('series_id', row.id).order('starts_at').limit(1);
    if (first.error) console.error(first.error);
    scheduled(sid, tid, 'Weekly sessions scheduled', first.data?.[0]?.id ?? null);
  }

  function scheduled(sid, tid, text, firstId) {
    // Invalidate first, so what renders next reads the new sessions
    dctx.store.invalidate(sid);
    if (sameId(tid, me?.id)) syncSoon();
    dctx.toast({ text });
    if (!dctx.alive()) return;
    const id = Number(firstId);
    if (Number.isFinite(id)) {
      // Show the first new session in this drawer (replace: Back closes it)
      dctx.go(drawerHref(globalThis.location?.hash ?? '', `s${id}`), { replace: true });
    } else {
      dctx.close();
    }
  }

  // "This and following": one call moves and updates the rest of the series
  // (and the rule that makes later ones), all or nothing
  async function saveFollowing(values) {
    const change = followingChange({ values, session });
    if (!change) {
      if (dctx.alive()) onSaved?.();
      return;
    }
    const result = await sb.rpc('edit_following_sessions', change);
    if (result.error) {
      console.error(result.error);
      showError('We couldn’t save your changes.', result.error.code === '42501' ? GONE : saveErrorText(result.error));
      return;
    }
    dctx.store.invalidate(session.student_id);
    if (sameId(session.tutor_id, me?.id)) syncSoon();
    const n = Number(result.data) || 0;
    dctx.toast({ text: n > 1 ? `${n} sessions updated` : 'Session updated' });
    if (dctx.alive()) onSaved?.();
  }

  async function saveEdit(values) {
    // Rows that would not change are left alone (a no-op save writes nothing)
    const updates = changedUpdates(buildUpdates({ values, session }), [session, ...siblings]);
    if (!updates.length) {
      if (dctx.alive()) onSaved?.();
      return;
    }
    let done = 0;
    let failure = null;
    for (const u of updates) {
      const result = await sb.from('sessions').update(u.fields).eq('id', u.id).select('id');
      if (result.error) {
        console.error(result.error);
        failure = saveErrorText(result.error);
        break;
      }
      if (!result.data?.length) {
        failure = GONE;
        break;
      }
      done += 1;
    }
    // Rows already saved stay saved, so the store reloads even after a failure
    if (done > 0) dctx.store.invalidate(session.student_id);
    if (done > 0 && sameId(session.tutor_id, me?.id)) syncSoon();
    if (failure) {
      const partial = done > 0 ? `${done} of ${updates.length} sessions were updated. ` : '';
      showError('We couldn’t save your changes.', `${partial}${failure}`);
      return;
    }
    dctx.toast({ text: updates.length > 1 ? `${updates.length} sessions updated` : 'Session updated' });
    if (dctx.alive()) onSaved?.();
  }

  return root;
}

// ---------------------------------------------------------------------------
// Session notes: attendance and recap

export function sessionNotesForm(dctx, { session, onCancel, onSaved } = {}) {
  const formId = uid('session-notes-form');
  const title = 'Session notes';
  const heading = h('h2', { class: 'drawer-title', tabindex: '-1' }, title);
  const when = whenText(session);
  const sub = h('p', { class: 'ses-form-sub' }, `${sessionTitle(session)}, ${when.date}, ${when.time}`);

  let attendance = session.attendance ?? null;
  const group = segmented({
    label: 'Attendance',
    block: true,
    options: Object.entries(ATTENDANCE).map(([value, label]) => ({ value, label })),
    value: attendance,
    onChange: (value) => { attendance = value; },
  });
  const attendanceField = groupField('Attendance', group);

  const recapInput = h('textarea', {
    class: 'input textarea', name: 'recap', rows: '8', maxlength: String(MAX_RECAP_LENGTH),
  }, session.recap ?? '');
  const recapField = field({
    label: 'Recap',
    optional: true,
    hint: 'What you covered and what to practice next. The student and family can read this.',
    control: recapInput,
  });
  recapInput.addEventListener('input', () => {
    if (recapInput.value.trim().length <= MAX_RECAP_LENGTH) setFieldError(recapField, '');
  });

  const errorSlot = h('div', { class: 'ses-form-errors' });
  const form = h('form', { class: 'ses-form', id: formId, novalidate: true }, attendanceField, recapField, errorSlot);
  const root = h('div', { class: 'ses-form-wrap', dataset: { title } }, heading, sub, form);

  const submit = button({ label: 'Save notes', variant: 'primary', type: 'submit', focusKey: 'save-session-notes' });
  submit.setAttribute('form', formId);
  const cancel = button({ label: 'Cancel', variant: 'ghost', onClick: () => onCancel?.() });
  dctx.setFooter([cancel, submit]);

  let saving = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    errorSlot.replaceChildren();
    const recap = recapInput.value.trim();
    if (recap.length > MAX_RECAP_LENGTH) {
      setFieldError(recapField, `Use at most ${MAX_RECAP_LENGTH.toLocaleString('en-US')} characters.`);
      recapInput.focus();
      return;
    }
    setFieldError(recapField, '');

    saving = true;
    try {
      await busy(submit, 'Saving…', async () => {
        const result = await sb.from('sessions')
          .update({ attendance, recap: recap || null })
          .eq('id', session.id)
          .select('id');
        if (result.error || !result.data?.length) {
          if (result.error) console.error(result.error);
          if (!dctx.alive()) return;
          errorSlot.append(dangerCallout('We couldn’t save the notes.', result.error ? saveErrorText(result.error) : GONE));
          errorSlot.scrollIntoView?.({ block: 'nearest' });
          return;
        }
        dctx.store.invalidate(session.student_id);
        dctx.toast({ text: 'Session notes saved' });
        if (dctx.alive()) onSaved?.();
      });
    } finally {
      saving = false;
    }
  });
  submitOnEnter(form, submit);

  return root;
}
