import { describe, test, expect, vi } from 'vitest';
import {
  calendarClient, API, GoogleNotFound, GoogleGone, GoogleRateError, GoogleApiError,
} from '../../api/_lib/google/calendar.js';
import { GoogleAuthError } from '../../api/_lib/google/oauth.js';

const CAL = 'abc@group.calendar.google.com';
const CAL_ENC = 'abc%40group.calendar.google.com';

const reply = (status, body = {}) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

function setup(status = 200, body = { id: 'x' }) {
  const fetchImpl = reply(status, body);
  return { fetchImpl, client: calendarClient('tok', { fetchImpl }) };
}

const lastCall = (fetchImpl) => {
  const [url, init] = fetchImpl.mock.calls.at(-1);
  return { url: new URL(url), raw: url, init };
};

describe('calendarClient requests', () => {
  test('sends the bearer header on every call', async () => {
    const { fetchImpl, client } = setup();
    await client.listEvents(CAL);
    expect(lastCall(fetchImpl).init.headers.Authorization).toBe('Bearer tok');
    await client.insertEvent(CAL, { summary: 's' });
    expect(lastCall(fetchImpl).init.headers.Authorization).toBe('Bearer tok');
    expect(lastCall(fetchImpl).init.headers['Content-Type']).toBe('application/json');
  });

  test('insertCalendar posts summary and time zone', async () => {
    const { fetchImpl, client } = setup();
    await client.insertCalendar({ summary: 'VP Education sessions', timeZone: 'America/Los_Angeles' });
    const { raw, init } = lastCall(fetchImpl);
    expect(raw).toBe(`${API}/calendars`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ summary: 'VP Education sessions', timeZone: 'America/Los_Angeles' });
  });

  test('insertEvent posts with sendUpdates=all and encodes the calendar id', async () => {
    const { fetchImpl, client } = setup();
    await client.insertEvent(CAL, { summary: 's' });
    const { url, init } = lastCall(fetchImpl);
    expect(url.origin + url.pathname).toBe(`${API}/calendars/${CAL_ENC}/events`);
    expect(url.searchParams.get('sendUpdates')).toBe('all');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ summary: 's' });
  });

  test('patchEvent patches with sendUpdates=all', async () => {
    const { fetchImpl, client } = setup();
    await client.patchEvent(CAL, 'ev/1', { summary: 't' });
    const { url, init } = lastCall(fetchImpl);
    expect(url.origin + url.pathname).toBe(`${API}/calendars/${CAL_ENC}/events/ev%2F1`);
    expect(url.searchParams.get('sendUpdates')).toBe('all');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ summary: 't' });
  });

  test('deleteEvent deletes with sendUpdates=all and no body', async () => {
    const { fetchImpl, client } = setup(204);
    await client.deleteEvent(CAL, 'ev1');
    const { url, init } = lastCall(fetchImpl);
    expect(url.origin + url.pathname).toBe(`${API}/calendars/${CAL_ENC}/events/ev1`);
    expect(url.searchParams.get('sendUpdates')).toBe('all');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  test('listEvents sends the query and skips empty values', async () => {
    const { fetchImpl, client } = setup();
    await client.listEvents(CAL, { syncToken: 'st', pageToken: undefined, timeMin: null, maxResults: 250 });
    const { url, init } = lastCall(fetchImpl);
    expect(url.origin + url.pathname).toBe(`${API}/calendars/${CAL_ENC}/events`);
    expect(init.method).toBe('GET');
    expect(Object.fromEntries(url.searchParams)).toEqual({ syncToken: 'st', maxResults: '250' });
  });

  test('listEvents with no query has no query string', async () => {
    const { fetchImpl, client } = setup();
    await client.listEvents(CAL);
    expect(lastCall(fetchImpl).raw).toBe(`${API}/calendars/${CAL_ENC}/events`);
  });

  test('listInstances targets the instances of one event', async () => {
    const { fetchImpl, client } = setup();
    await client.listInstances(CAL, 'rec1', { timeMin: '2026-10-01T00:00:00Z' });
    const { url, init } = lastCall(fetchImpl);
    expect(url.origin + url.pathname).toBe(`${API}/calendars/${CAL_ENC}/events/rec1/instances`);
    expect(url.searchParams.get('timeMin')).toBe('2026-10-01T00:00:00Z');
    expect(init.method).toBe('GET');
  });

  test('watchEvents posts a web_hook channel with a string ttl', async () => {
    const { fetchImpl, client } = setup();
    await client.watchEvents(CAL, { id: 'ch1', token: 'tk', address: 'https://site.test/api/google/notify', ttlSeconds: 604800 });
    const { url, init } = lastCall(fetchImpl);
    expect(url.origin + url.pathname).toBe(`${API}/calendars/${CAL_ENC}/events/watch`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      id: 'ch1', token: 'tk', type: 'web_hook', address: 'https://site.test/api/google/notify', params: { ttl: '604800' },
    });
  });

  test('stopChannel posts the channel id and resource id', async () => {
    const { fetchImpl, client } = setup(204);
    await client.stopChannel({ id: 'ch1', resourceId: 'res1' });
    const { raw, init } = lastCall(fetchImpl);
    expect(raw).toBe(`${API}/channels/stop`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ id: 'ch1', resourceId: 'res1' });
  });

  test('returns the parsed json on success', async () => {
    const { client } = setup(200, { items: [{ id: 'e1' }], nextSyncToken: 'n' });
    expect(await client.listEvents(CAL)).toEqual({ items: [{ id: 'e1' }], nextSyncToken: 'n' });
  });

  test('a 204 returns null', async () => {
    const { client } = setup(204);
    expect(await client.stopChannel({ id: 'a', resourceId: 'b' })).toBeNull();
  });
});

describe('calendarClient errors', () => {
  const failing = (status, body) => setup(status, body).client.patchEvent(CAL, 'e', {});

  test('404 is GoogleNotFound', async () => {
    await expect(failing(404)).rejects.toBeInstanceOf(GoogleNotFound);
  });

  test('410 is GoogleGone', async () => {
    await expect(failing(410)).rejects.toBeInstanceOf(GoogleGone);
  });

  test('401 is GoogleAuthError', async () => {
    await expect(failing(401)).rejects.toBeInstanceOf(GoogleAuthError);
  });

  test('429 is GoogleRateError', async () => {
    await expect(failing(429)).rejects.toBeInstanceOf(GoogleRateError);
  });

  test('a 403 with a rate-limit reason is GoogleRateError', async () => {
    for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']) {
      await expect(failing(403, { error: { errors: [{ reason }] } })).rejects.toBeInstanceOf(GoogleRateError);
    }
  });

  test('a 403 for another reason is GoogleApiError', async () => {
    const err = await failing(403, { error: { errors: [{ reason: 'forbidden' }] } }).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err.status).toBe(403);
  });

  test('a 500 is GoogleApiError with the status but not the body', async () => {
    const err = await failing(500, { error: { message: 'secret-event-title' } }).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err.status).toBe(500);
    expect(err.message).toContain('500');
    expect(err.message).not.toContain('secret-event-title');
  });

  test('copes with an error body that is not json', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => { throw new Error('html'); } }));
    const err = await calendarClient('tok', { fetchImpl }).listEvents(CAL).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err.status).toBe(503);
  });

  test('deleteEvent resolves on 404 and on 410', async () => {
    await expect(setup(404).client.deleteEvent(CAL, 'e')).resolves.toBeUndefined();
    await expect(setup(410).client.deleteEvent(CAL, 'e')).resolves.toBeUndefined();
  });

  test('deleteEvent still throws other errors', async () => {
    await expect(setup(401).client.deleteEvent(CAL, 'e')).rejects.toBeInstanceOf(GoogleAuthError);
    await expect(setup(500).client.deleteEvent(CAL, 'e')).rejects.toBeInstanceOf(GoogleApiError);
    await expect(setup(429).client.deleteEvent(CAL, 'e')).rejects.toBeInstanceOf(GoogleRateError);
  });
});
