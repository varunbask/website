import { sb } from './supabase.js';
import { h, clear, showMessage, withBusy } from './dom.js';
import { formatDateTime, one } from './format.js';
import { staffStatus, canRetry, FILE_LABELS } from './labels.js';
import { startGrading } from './grading.js';

const FIELDS = 'id, task_id, storage_path, file_type, note, status, error, attempts, status_changed_at, created_at, '
  + 'task:tasks(title, due_at), grade:grades(score, feedback, reviewed_at, released_at)';

// Score and feedback editor. Unreleased: save a draft or release. Released: save or unrelease.
function reviewForm(sub, grade, done) {
  const released = Boolean(grade?.released_at);
  const primary = h('button', { type: 'button', class: 'btn btn-primary btn-small' }, released ? 'Save' : 'Release to family');
  const secondary = h('button', { type: 'button', class: 'link-button' }, released ? 'Unrelease' : 'Save draft');
  const form = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'form-row' },
      h('label', { class: 'field' }, h('span', {}, 'Score (0 to 100)'),
        h('input', { type: 'number', name: 'score', min: 0, max: 100, step: 0.5, inputmode: 'decimal', value: grade?.score ?? '' }))),
    h('label', { class: 'field' }, h('span', {}, 'Feedback for the student'),
      h('textarea', { name: 'feedback', rows: 5, maxlength: 10000 }, grade?.feedback ?? '')),
    h('div', { class: 'form-actions' },
      primary,
      secondary),
    h('p', { class: 'form-message', role: 'alert', hidden: true }));
  const message = form.querySelector('.form-message');

  const read = () => {
    const raw = form.elements.score.value.trim();
    return { score: raw === '' ? null : Number(raw), feedback: form.elements.feedback.value.trim() || null };
  };
  const badScore = (score) => score !== null && (Number.isNaN(score) || score < 0 || score > 100);

  async function save(changes, successText, button) {
    await withBusy(button, 'Saving...', async () => {
      const { error } = await sb.from('grades').update(changes).eq('submission_id', sub.id);
      if (error) return showMessage(message, `That did not save: ${error.message}`);
      await done(successText);
    });
  }

  // Releasing (or saving an already released grade) needs a deliberate click on the primary button
  function releaseOrSave(button) {
    const values = read();
    if (values.score === null || badScore(values.score)) return showMessage(message, 'Enter a score from 0 to 100.');
    if (!values.feedback) return showMessage(message, 'Write feedback before releasing.');
    return save({ ...values, released_at: grade?.released_at ?? new Date().toISOString() },
      released ? 'Saved.' : 'Released. The student and parents can see it now.',
      button);
  }

  function saveDraft(button) {
    const values = read();
    if (badScore(values.score)) return showMessage(message, 'Enter a score from 0 to 100.');
    return save(values, 'Draft saved.', button);
  }

  primary.addEventListener('click', () => releaseOrSave(primary));

  // Enter in the score field must never publish: it only saves a draft, or saves edits to a grade that is already public
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (released) releaseOrSave(primary);
    else saveDraft(secondary);
  });

  secondary.addEventListener('click', () => {
    if (released) save({ released_at: null }, 'Unreleased. The family no longer sees this grade.', secondary);
    else saveDraft(secondary);
  });
  return form;
}

function submissionRow(sub, url, { done, message }) {
  const grade = one(sub.grade);
  const task = one(sub.task);
  const status = staffStatus(sub, grade);
  const late = Boolean(task?.due_at && Date.parse(sub.created_at) > Date.parse(task.due_at));
  const meta = [`submitted ${formatDateTime(sub.created_at)}`, FILE_LABELS[sub.file_type] ?? 'File'];
  if (late) meta.push('late');

  let retry = null;
  if (canRetry(sub)) {
    retry = h('button', { type: 'button', class: 'link-button' }, 'Retry grading');
    retry.addEventListener('click', () => withBusy(retry, 'Starting...', async () => {
      const problem = await startGrading(sub.id);
      showMessage(message, problem ?? 'Grading started. Refresh in a minute to see the draft.', problem ? 'error' : 'success');
    }));
  }

  const form = reviewForm(sub, grade, done);
  const review = grade?.released_at
    ? h('div', { class: 'grade-block' },
        h('p', { class: 'score-line' }, `Score ${grade.score}`),
        h('p', { class: 'feedback' }, grade.feedback),
        h('details', {}, h('summary', { class: 'link-button' }, 'Edit or unrelease'), form))
    : h('div', { class: 'grade-block' }, form);

  return h('li', {},
    h('div', { class: 'row' },
      h('div', { class: 'row-main' },
        h('span', { class: 'row-title' }, task?.title ?? 'Assignment'),
        h('span', { class: late ? 'meta overdue' : 'meta' }, meta.join(' · ')),
        sub.note ? h('p', { class: 'note' }, `Note from the student: ${sub.note}`) : null,
        sub.status === 'failed' && sub.error ? h('p', { class: 'meta' }, sub.error) : null),
      h('div', { class: 'row-actions' },
        h('span', { class: `status ${status.tone}` }, status.text),
        url ? h('a', { class: 'link-button', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open file') : null,
        retry)),
    review);
}

export async function renderSubmissions(container, { student, onChange }) {
  const message = h('p', { class: 'form-message', role: 'status', hidden: true });

  async function draw(successText = '') {
    const { data, error } = await sb.from('submissions').select(FIELDS)
      .eq('student_id', student.id).order('created_at', { ascending: false });
    if (error) {
      clear(container).append(h('p', { class: 'form-message error' }, 'Submissions could not be loaded. Refresh to try again.'));
      return;
    }
    // Signed links to the private files, valid for an hour
    const urls = new Map();
    if (data.length) {
      const signed = await sb.storage.from('homework').createSignedUrls(data.map((s) => s.storage_path), 3600);
      for (const item of signed.data ?? []) if (item.signedUrl) urls.set(item.path, item.signedUrl);
    }
    const done = async (text) => {
      await draw(text);
      onChange?.();
    };
    clear(container).append(message, data.length
      ? h('ul', { class: 'ruled-list' }, data.map((sub) => submissionRow(sub, urls.get(sub.storage_path), { done, message })))
      : h('p', { class: 'empty' }, 'No submissions yet.'));
    showMessage(message, successText, 'success');
  }

  await draw();
}
