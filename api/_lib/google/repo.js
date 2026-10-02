// Service-role queries for the Google Calendar sync. `db` is a supabase-js
// client built with the service key; every method throws
// Error('<name>: <message>') on a Supabase error, like api/_lib/repo.js.

const SESSION_FIELDS = 'id, tutor_id, student_id, subject, starts_at, ends_at, location, meeting_url, notes, status, '
  + 'updated_at, sync_state, google_event_id, google_calendar_id, google_recurring_id, google_link';
const PULL_LOCK_MS = 60_000;
const PENDING_WINDOW_MS = 30 * 24 * 3600 * 1000;

function check({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

export function createGoogleRepo(db) {
  const connections = () => db.from('google_connections');
  const sessions = () => db.from('sessions');

  return {
    // ---- connections
    async getConnection(userId) {
      return check(await connections().select('*').eq('user_id', userId).maybeSingle(), 'getConnection') ?? null;
    },

    async getConnectionByChannel(channelId) {
      return check(await connections().select('*').eq('channel_id', channelId).maybeSingle(), 'getConnectionByChannel') ?? null;
    },

    // Least recently synced first, so a run cut short by its time budget favors whoever waited longest
    async listSyncTutors() {
      return check(await connections().select('*').eq('purpose', 'tutor').eq('sync_enabled', true)
        .order('last_synced_at', { ascending: true, nullsFirst: true }), 'listSyncTutors');
    },

    async upsertConnection(row) {
      return check(await connections().upsert(row, { onConflict: 'user_id' }).select('*').single(), 'upsertConnection');
    },

    async updateConnection(userId, fields) {
      check(await connections().update(fields).eq('user_id', userId), 'updateConnection');
    },

    async deleteConnection(userId) {
      check(await connections().delete().eq('user_id', userId), 'deleteConnection');
    },

    // ---- OAuth states
    async saveState(row) {
      check(await db.from('google_oauth_states').insert(row), 'saveState');
    },

    // One use: the delete returns the row it removed, so a replayed state finds nothing
    async takeState(nonce, now) {
      const row = check(await db.from('google_oauth_states').delete().eq('nonce', nonce).select('*').maybeSingle(), 'takeState');
      if (!row || new Date(row.expires_at).getTime() <= now.getTime()) return null;
      return row;
    },

    // ---- people
    async getProfile(userId) {
      return check(await db.from('profiles').select('id, role, full_name, email').eq('id', userId).maybeSingle(), 'getProfile') ?? null;
    },

    // ---- sessions to push
    async pendingSessions(tutorId, limit) {
      const since = new Date(Date.now() - PENDING_WINDOW_MS).toISOString();
      return check(await sessions().select(SESSION_FIELDS)
        .eq('tutor_id', tutorId).in('sync_state', ['pending', 'error']).gt('starts_at', since)
        .order('starts_at', { ascending: true }).limit(limit), 'pendingSessions');
    },

    async tombstones(tutorId) {
      return check(await db.from('google_deletions').select('id, tutor_id, calendar_id, event_id')
        .eq('tutor_id', tutorId).order('id', { ascending: true }), 'tombstones');
    },

    async removeTombstone(id) {
      check(await db.from('google_deletions').delete().eq('id', id), 'removeTombstone');
    },

    // ---- session lookup and writes
    async sessionById(id) {
      return check(await sessions().select(SESSION_FIELDS).eq('id', id).maybeSingle(), 'sessionById') ?? null;
    },

    async sessionByEvent(calendarId, eventId) {
      return check(await sessions().select(SESSION_FIELDS)
        .eq('google_calendar_id', calendarId).eq('google_event_id', eventId).maybeSingle(), 'sessionByEvent') ?? null;
    },

    // With { ifUpdatedAt }, only a row still carrying that updated_at is changed
    // (compare-and-set); null comes back when no row matched
    async updateSession(id, fields, { ifUpdatedAt } = {}) {
      let query = sessions().update(fields).eq('id', id);
      if (ifUpdatedAt !== undefined) query = query.eq('updated_at', ifUpdatedAt);
      return check(await query.select(SESSION_FIELDS).maybeSingle(), 'updateSession');
    },

    async insertSession(row) {
      const { id } = check(await sessions().insert(row).select('id').single(), 'insertSession');
      return { id };
    },

    // ---- students
    async linkedStudents(tutorId) {
      const links = check(await db.from('tutor_students').select('student_id').eq('tutor_id', tutorId), 'linkedStudents');
      const ids = links.map((l) => l.student_id);
      if (!ids.length) return [];
      const profiles = check(await db.from('profiles').select('id, full_name, email').in('id', ids).order('full_name', { ascending: true }), 'linkedStudents');
      const google = check(await connections().select('user_id, google_email').eq('purpose', 'student').in('user_id', ids), 'linkedStudents');
      const byUser = new Map(google.map((g) => [g.user_id, g.google_email]));
      return profiles.map((p) => ({ id: p.id, full_name: p.full_name, email: p.email, google_email: byUser.get(p.id) ?? null }));
    },

    async studentGoogleEmail(studentId) {
      const row = check(await connections().select('google_email').eq('user_id', studentId).eq('purpose', 'student').maybeSingle(), 'studentGoogleEmail');
      return row?.google_email ?? null;
    },

    async tutorsWithSyncFor(studentId) {
      const links = check(await db.from('tutor_students').select('tutor_id').eq('student_id', studentId), 'tutorsWithSyncFor');
      const ids = links.map((l) => l.tutor_id);
      if (!ids.length) return [];
      return check(await connections().select('*').in('user_id', ids).eq('purpose', 'tutor').eq('sync_enabled', true), 'tutorsWithSyncFor');
    },

    // Scheduled sessions after `now`, of one tutor and/or one student, for the next push.
    // It does not look at whether the tutor has sync on: the callers only push for tutors who do.
    async markUpcomingPending({ tutorId, studentId, now }) {
      if (!tutorId && !studentId) throw new Error('markUpcomingPending: a tutor or a student is required');
      let query = sessions().update({ sync_state: 'pending' }).eq('status', 'scheduled').gt('starts_at', now.toISOString());
      if (tutorId) query = query.eq('tutor_id', tutorId);
      if (studentId) query = query.eq('student_id', studentId);
      check(await query, 'markUpcomingPending');
    },

    // A series deleted in Google: cancels the tutor's sessions of that series that have not ended
    // yet and returns how many it cancelled
    async cancelRecurring(tutorId, recurringId, now) {
      const rows = check(await sessions()
        .update({ status: 'cancelled', sync_state: 'synced', google_synced_at: now.toISOString() })
        .eq('tutor_id', tutorId).eq('google_recurring_id', recurringId)
        .gt('ends_at', now.toISOString()).neq('status', 'cancelled')
        .select('id'), 'cancelRecurring');
      return rows.length;
    },

    // ---- pull lock: true when this caller took it (a row came back from the update)
    async claimPull(userId, now) {
      const stale = new Date(now.getTime() - PULL_LOCK_MS).toISOString();
      const rows = check(await connections().update({ pull_started_at: now.toISOString() })
        .eq('user_id', userId).or(`pull_started_at.is.null,pull_started_at.lt.${stale}`).select('user_id'), 'claimPull');
      return rows.length > 0;
    },
  };
}
