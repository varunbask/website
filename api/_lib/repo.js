import { PermanentGradingError } from './errors.js';

const FIELDS = 'id, student_id, task_id, storage_path, file_type, status, attempts, status_changed_at, task:tasks(title, details)';

function check({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

export function createRepo(db) {
  return {
    async getSubmission(id) {
      return check(await db.from('submissions').select(FIELDS).eq('id', id).maybeSingle(), 'getSubmission');
    },

    async getRole(userId) {
      const row = check(await db.from('profiles').select('role').eq('id', userId).maybeSingle(), 'getRole');
      return row?.role ?? null;
    },

    async isAssigned(tutorId, studentId) {
      const { count, error } = await db.from('tutor_students')
        .select('tutor_id', { count: 'exact', head: true })
        .eq('tutor_id', tutorId).eq('student_id', studentId);
      if (error) throw new Error(`isAssigned: ${error.message}`);
      return count > 0;
    },

    // Compare-and-set: only one caller wins a given (status, attempts) state
    async claim(sub, now) {
      return check(await db.from('submissions')
        .update({ status: 'grading', attempts: sub.attempts + 1, status_changed_at: now.toISOString(), error: null })
        .eq('id', sub.id).eq('status', sub.status).eq('attempts', sub.attempts)
        .select(FIELDS).maybeSingle(), 'claim');
    },

    async download(path) {
      const { data, error } = await db.storage.from('homework').download(path);
      if (error) {
        if (error.status === 404 || error.statusCode === '404' || /object not found/i.test(error.message)) {
          throw new PermanentGradingError('The uploaded file could not be found.');
        }
        throw new Error(`download: ${error.message}`);
      }
      return new Uint8Array(await data.arrayBuffer());
    },

    // Never overwrites a grade a person has already touched or released
    async saveAiGrade(id, { score, feedback }) {
      check(await db.from('grades').update({ score, feedback })
        .eq('submission_id', id).is('released_at', null).is('reviewed_at', null), 'saveAiGrade');
    },

    async setStatus(id, { status, error, now }) {
      check(await db.from('submissions')
        .update({ status, error, status_changed_at: now.toISOString() }).eq('id', id), 'setStatus');
    },

    async listDue({ pendingBefore, staleGradingBefore, maxAttempts, limit }) {
      const pending = check(await db.from('submissions').select(FIELDS)
        .eq('status', 'pending').lt('status_changed_at', pendingBefore.toISOString()).lt('attempts', maxAttempts)
        .order('status_changed_at', { ascending: true }).limit(limit), 'listDue pending');
      const stale = check(await db.from('submissions').select(FIELDS)
        .eq('status', 'grading').lt('status_changed_at', staleGradingBefore.toISOString())
        .order('status_changed_at', { ascending: true }).limit(limit), 'listDue stale');
      return [...stale, ...pending].slice(0, limit);
    },
  };
}
