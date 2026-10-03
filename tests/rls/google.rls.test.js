import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildWorld, hasService } from './world.js';

// Needs supabase/migrations/20261001200000_sessions.sql and
// 20261002120000_google_calendar.sql applied to the project the .env points
// at. Tests run in file order; later ones build on earlier ones.

const HOUR = 3_600_000;
const slot = (hoursAhead) => {
  const start = new Date(Math.ceil(Date.now() / HOUR) * HOUR + hoursAhead * HOUR);
  return { starts_at: start.toISOString(), ends_at: new Date(start.getTime() + HOUR).toISOString() };
};
const must = ({ error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
};

describe.skipIf(!hasService)('google calendar sync row-level security', () => {
  let w;
  let P;
  let session; // tutorA's session with studentA, while it exists

  beforeAll(async () => {
    w = await buildWorld();
    P = w.people;
  });

  afterAll(async () => {
    try {
      if (w) {
        // Service-role deletes leave no tombstone. A synced session must not
        // outlive its tutor's account, so these go before the users do.
        must(await w.admin.from('sessions').delete().eq('tutor_id', P.tutorA.id), 'remove sessions');
        must(await w.admin.from('google_deletions').delete().eq('tutor_id', P.tutorA.id), 'remove tombstones');
        must(await w.admin.from('google_connections').delete().eq('user_id', P.tutorA.id), 'remove connection');
      }
    } finally {
      await w?.cleanup();
    }
  });

  test('signed-in users cannot read the connection, state or tombstone tables', async () => {
    for (const who of ['studentA', 'tutorA', 'admin']) {
      for (const table of ['google_connections', 'google_oauth_states', 'google_deletions']) {
        // The migration revokes every privilege, so this is a permission error, not an empty result
        const { error } = await P[who].client.from(table).select('*');
        expect(error?.code, `${who} ${table}`).toBe('42501');
      }
    }
  });

  test('my_google_connection returns the caller’s own row and nobody else’s', async () => {
    const none = await P.tutorA.client.rpc('my_google_connection');
    expect(none.error).toBeNull();
    expect(none.data).toEqual([]);

    must(await w.admin.from('google_connections').insert({
      user_id: P.tutorA.id,
      purpose: 'tutor',
      google_email: 'tutor-a@example.com',
      refresh_token_enc: 'x',
    }), 'seed connection');

    const mine = await P.tutorA.client.rpc('my_google_connection');
    expect(mine.error).toBeNull();
    expect(mine.data).toEqual([{
      connected: true,
      purpose: 'tutor',
      google_email: 'tutor-a@example.com',
      sync_enabled: false,
      last_synced_at: null,
      last_error: null,
    }]);

    const theirs = await P.tutorB.client.rpc('my_google_connection');
    expect(theirs.error).toBeNull();
    expect(theirs.data).toEqual([]);
  });

  test('a tutor’s own change marks a session pending; the sync itself and a recap do not', async () => {
    must(await w.admin.from('google_connections').update({ sync_enabled: true }).eq('user_id', P.tutorA.id), 'switch sync on');

    const made = await P.tutorA.client.from('sessions')
      .insert({ student_id: P.studentA.id, subject: 'Algebra', ...slot(24) }).select('id, sync_state').single();
    expect(made.error).toBeNull();
    expect(made.data.sync_state).toBe('pending');
    session = made.data.id;

    const synced = await w.admin.from('sessions').update({ sync_state: 'synced' }).eq('id', session).select('sync_state').single();
    expect(synced.error).toBeNull();
    expect(synced.data.sync_state).toBe('synced');

    const recap = await P.tutorA.client.from('sessions').update({ recap: 'Covered fractions.' }).eq('id', session).select('sync_state').single();
    expect(recap.error).toBeNull();
    expect(recap.data.sync_state).toBe('synced');

    // A change to what Google shows does mark it, so the recap result above is not vacuous
    const plan = await P.tutorA.client.from('sessions').update({ notes: 'Bring the quiz' }).eq('id', session).select('sync_state').single();
    expect(plan.error).toBeNull();
    expect(plan.data.sync_state).toBe('pending');
  });

  test('a tutor cannot write the Google columns of a session, the etag included, but can read them', async () => {
    for (const column of ['google_event_id', 'google_calendar_id', 'google_recurring_id', 'google_link', 'sync_state', 'google_synced_at', 'google_etag']) {
      const value = column === 'google_synced_at' ? new Date().toISOString() : (column === 'google_link' ? 'https://calendar.google.com/x' : 'x');
      const { error } = await P.tutorA.client.from('sessions').update({ [column]: column === 'sync_state' ? 'synced' : value }).eq('id', session);
      expect(error?.code, column).toBe('42501');
    }

    must(await w.admin.from('sessions').update({ google_etag: '"etag-1"' }).eq('id', session), 'seed etag');
    const read = await P.tutorA.client.from('sessions').select('google_etag').eq('id', session).single();
    expect(read.error).toBeNull();
    expect(read.data.google_etag).toBe('"etag-1"');
  });

  test('the connection has a push lock column for the service role, and a state needs its browser hash', async () => {
    const lock = await w.admin.from('google_connections').update({ push_started_at: new Date().toISOString() }).eq('user_id', P.tutorA.id).select('push_started_at').single();
    expect(lock.error).toBeNull();
    expect(lock.data.push_started_at).not.toBeNull();
    must(await w.admin.from('google_connections').update({ push_started_at: null }).eq('user_id', P.tutorA.id), 'release the lock');

    const nonce = `nonce-${randomUUID()}`;
    const row = {
      nonce, user_id: P.tutorA.id, purpose: 'tutor', verifier: 'v', return_to: '/portal/',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    };
    const without = await w.admin.from('google_oauth_states').insert(row);
    expect(without.error?.code).toBe('23502'); // browser_hash is not null

    const withHash = await w.admin.from('google_oauth_states').insert({ ...row, browser_hash: 'a'.repeat(64) });
    expect(withHash.error).toBeNull();
    must(await w.admin.from('google_oauth_states').delete().eq('nonce', nonce), 'remove the state');
  });

  test('a tutor deleting a synced session leaves one tombstone', async () => {
    const eventId = `ev-${randomUUID()}`;
    const calendarId = `cal-${randomUUID()}`;
    must(await w.admin.from('sessions').update({ google_event_id: eventId, google_calendar_id: calendarId }).eq('id', session), 'mark synced');

    const gone = await P.tutorA.client.from('sessions').delete().eq('id', session).select('id');
    expect(gone.error).toBeNull();
    expect(gone.data).toHaveLength(1);
    session = null;

    const tombs = await w.admin.from('google_deletions').select('tutor_id, calendar_id, event_id').eq('event_id', eventId);
    expect(tombs.error).toBeNull();
    expect(tombs.data).toEqual([{ tutor_id: P.tutorA.id, calendar_id: calendarId, event_id: eventId }]);
  });
});
