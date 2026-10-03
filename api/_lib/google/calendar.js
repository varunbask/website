import { GoogleAuthError } from './oauth.js';

export const API = 'https://www.googleapis.com/calendar/v3';

export class GoogleNotFound extends Error { constructor() { super('Google: not found'); this.name = 'GoogleNotFound'; } }
export class GoogleGone extends Error { constructor() { super('Google: gone'); this.name = 'GoogleGone'; } }
export class GoogleRateError extends Error { constructor() { super('Google: rate limited'); this.name = 'GoogleRateError'; } }
export class GoogleApiError extends Error {
  constructor(status) { super(`Google API error ${status}`); this.name = 'GoogleApiError'; this.status = status; }
}

const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']);

export function calendarClient(accessToken, { fetchImpl = fetch } = {}) {
  async function call(method, path, { query, body } = {}) {
    const params = new URLSearchParams(Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
    const qs = params.size ? `?${params}` : '';
    const res = await fetchImpl(`${API}${path}${qs}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    if (res.status === 404) throw new GoogleNotFound();
    if (res.status === 410) throw new GoogleGone();
    if (res.status === 401) throw new GoogleAuthError();
    const reason = json?.error?.errors?.[0]?.reason;
    if (res.status === 429 || (res.status === 403 && RATE_REASONS.has(reason))) throw new GoogleRateError();
    throw new GoogleApiError(res.status);
  }
  const enc = encodeURIComponent;
  return {
    insertCalendar: ({ summary, timeZone }) => call('POST', '/calendars', { body: { summary, timeZone } }),
    insertEvent: (cal, event) => call('POST', `/calendars/${enc(cal)}/events`, { query: { sendUpdates: 'all' }, body: event }),
    patchEvent: (cal, id, patch) => call('PATCH', `/calendars/${enc(cal)}/events/${enc(id)}`, { query: { sendUpdates: 'all' }, body: patch }),
    async deleteEvent(cal, id) {
      try {
        await call('DELETE', `/calendars/${enc(cal)}/events/${enc(id)}`, { query: { sendUpdates: 'all' } });
      } catch (error) {
        if (!(error instanceof GoogleNotFound) && !(error instanceof GoogleGone)) throw error;
      }
    },
    listEvents: (cal, query = {}) => call('GET', `/calendars/${enc(cal)}/events`, { query }),
    listInstances: (cal, id, query = {}) => call('GET', `/calendars/${enc(cal)}/events/${enc(id)}/instances`, { query }),
    watchEvents: (cal, { id, token, address, ttlSeconds }) => call('POST', `/calendars/${enc(cal)}/events/watch`, {
      body: { id, token, type: 'web_hook', address, params: { ttl: String(ttlSeconds) } },
    }),
    stopChannel: ({ id, resourceId }) => call('POST', '/channels/stop', { body: { id, resourceId } }),
  };
}
