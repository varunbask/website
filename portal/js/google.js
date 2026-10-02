// Google Calendar sync in the browser: the status, the calls to /api/google/*,
// personal events, and the two controls built on them (the tutor's switch and
// the student's invite button). The pure parts live in google-model.js.
//
// Every call is same-origin and carries the person's session token. Nothing
// here ever sees a Google token: the server keeps those. A failed call rejects
// with an Error whose message is safe to show.

import { sb } from './supabase.js';
import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { button, busy } from './ui.js';
import { menu } from './overlays.js';
import {
  syncStatusText, inviteText, readGoogleReturn, normalizeStatus, safeErrorText, defaultReturnTo, OFF_STATUS as OFF,
} from './google-model.js';

const NOT_SET_UP = 'Google Calendar is not set up yet.';
const PERSONAL_TTL_MS = 60_000;
const UNAVAILABLE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Calls

async function authHeaders() {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Sign in again to use Google Calendar.');
  return { Authorization: `Bearer ${token}` };
}

const FALLBACKS = {
  400: 'That didn’t work. Try again.',
  401: 'Sign in again to use Google Calendar.',
  403: 'Google Calendar isn’t available for your account.',
  409: 'Connect Google Calendar first.',
  502: 'Google Calendar did not answer. Try again.',
};

async function call(path, { method = 'POST', body, query } = {}) {
  const headers = await authHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const url = query ? `${path}?${new URLSearchParams(query)}` : path;
  let response;
  try {
    response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('We couldn’t reach Google Calendar. Check your connection and try again.');
  }
  if (response.status === 503) throw new Error(NOT_SET_UP);
  let data = null;
  try {
    data = await response.json();
  } catch {
    // an empty or non-JSON body: the status decides
  }
  if (!response.ok) throw new Error(safeErrorText(data?.error) ?? FALLBACKS[response.status] ?? 'Something went wrong. Try again.');
  return data;
}

// ---------------------------------------------------------------------------
// Status

let statusCache = null;     // { promise, at }
let personalCache = new Map(); // 'from|to' -> { promise, value, at }

async function loadStatus() {
  try {
    const { data, error } = await sb.rpc('my_google_connection');
    if (error) throw error;
    return normalizeStatus(data);
  } catch (error) {
    console.error(error);
    return { ...OFF, unavailable: true };
  }
}

// { connected, purpose, google_email, sync_enabled, last_synced_at, last_error }
// of the signed-in person. Never rejects: if the status cannot be read it
// resolves to { connected: false, unavailable: true }, which the screens read
// as "leave Google out". Cached until invalidateGoogle(); an unavailable answer
// is tried again after half a minute.
export function getGoogleStatus() {
  if (statusCache && !(statusCache.unavailable && Date.now() - statusCache.at > UNAVAILABLE_TTL_MS)) return statusCache.promise;
  const entry = { at: Date.now(), unavailable: false, promise: null };
  entry.promise = loadStatus().then((status) => {
    entry.unavailable = Boolean(status.unavailable);
    return status;
  });
  statusCache = entry;
  return entry.promise;
}

// Forget what was read: the status, and the personal events, which depend on it
export function invalidateGoogle() {
  statusCache = null;
  personalCache = new Map();
}

// ---------------------------------------------------------------------------
// Actions

// Sends the browser to Google's consent screen and back to returnTo (this page,
// query and hash included, so a staff member's ?student= scope survives). Resolves
// once the browser is on its way; rejects with a message to show.
export async function connectGoogle(purpose, returnTo = defaultReturnTo()) {
  const data = await call('/api/google/start', { body: { purpose, return_to: returnTo } });
  if (typeof data?.url !== 'string' || !data.url) throw new Error('Google Calendar did not answer. Try again.');
  location.assign(data.url);
}

async function change(path, body) {
  try {
    return normalizeStatus(await call(path, body === undefined ? {} : { body }));
  } finally {
    invalidateGoogle();
  }
}

// Turns a tutor's sync on or off; resolves to the new status
export function setGoogleSync(on) {
  return change('/api/google/settings', { sync_enabled: Boolean(on) });
}

// Removes the connection (a tutor's sync, or a student's invites)
export function disconnectGoogle() {
  return change('/api/google/disconnect');
}

// Pushes and pulls now; resolves to the status
export function syncNow() {
  return change('/api/google/sync');
}

// ---------------------------------------------------------------------------
// Personal events

const personalKey = (from, to) => `${from}|${to}`;
const fresh = (entry) => entry && Date.now() - entry.at < PERSONAL_TTL_MS;

// The tutor's own Google events between two instants: [{ id, title, start, end,
// all_day }]. Cached for a minute per range.
export function personalEvents(fromIso, toIso) {
  const key = personalKey(fromIso, toIso);
  const hit = personalCache.get(key);
  if (fresh(hit)) return hit.promise;
  const entry = { at: Date.now(), value: null, promise: null };
  entry.promise = call('/api/google/personal', { method: 'GET', query: { from: fromIso, to: toIso } })
    .then((data) => {
      entry.value = Array.isArray(data?.events) ? data.events : [];
      return entry.value;
    });
  personalCache.set(key, entry);
  entry.promise.catch(() => { if (personalCache.get(key) === entry) personalCache.delete(key); });
  return entry.promise;
}

// The events personalEvents already fetched for the range, or null when there
// are none to hand yet. Lets a view that was just rebuilt draw them at once.
export function cachedPersonalEvents(fromIso, toIso) {
  const hit = personalCache.get(personalKey(fromIso, toIso));
  return fresh(hit) && hit.value ? hit.value : null;
}

// ---------------------------------------------------------------------------
// Coming back from Google

// On a page that just returned from Google (the hash carries google=connected
// or google=error): reads the status afresh, says how it went, then takes the
// param out of the address.
// A page that did not come back from Google is left alone.
export function announceGoogleReturn({ toast } = {}) {
  const { result, cleanHash } = readGoogleReturn(location.hash);
  if (!result) return;
  invalidateGoogle(); // the connection changed on the server while the page was away
  toast?.({ text: result === 'connected' ? 'Google Calendar connected' : 'Google Calendar could not connect. Try again.' });
  try {
    history.replaceState(null, '', location.pathname + location.search + cleanHash);
  } catch {
    // a sandboxed page can refuse history writes; the toast was still shown
  }
}

// ---------------------------------------------------------------------------
// Controls

function say(toast, text) {
  toast?.({ text });
}

// The student's invite control: "Get Google Calendar invites" before they
// connect, "Invites go to maya@gmail.com" and "Stop invites" after. Left empty
// when the status cannot be read. Used on the calendar toolbar and Overview.
export function studentInviteControl({ toast } = {}) {
  const root = h('div', { class: 'google-invite', hidden: true });

  function paint(status, { focus = false } = {}) {
    if (status.unavailable) {
      root.hidden = true;
      root.replaceChildren();
      return;
    }
    root.hidden = false;
    if (status.connected) {
      root.replaceChildren(
        h('span', { class: 'google-invite-text' }, icon('calendar-blank'), h('span', {}, inviteText(status.google_email))),
        button({ label: 'Stop invites', variant: 'ghost', size: 'sm', focusKey: 'google-stop-invites', onClick: (e) => stop(e.currentTarget) }));
    } else {
      root.replaceChildren(button({
        label: 'Get Google Calendar invites',
        icon: 'calendar-blank',
        size: 'sm',
        focusKey: 'google-get-invites',
        onClick: (e) => connect(e.currentTarget),
      }));
    }
    if (focus) root.querySelector('button')?.focus();
  }

  async function connect(btn) {
    await busy(btn, 'Connecting…', async () => {
      try {
        await connectGoogle('student');
      } catch (error) {
        say(toast, error.message);
      }
    });
  }

  async function stop(btn) {
    const hadFocus = root.contains(document.activeElement);
    await busy(btn, 'Stopping…', async () => {
      try {
        await disconnectGoogle();
      } catch (error) {
        say(toast, error.message);
        return;
      }
      say(toast, 'Google Calendar invites stopped');
      paint({ ...OFF }, { focus: hadFocus });
    });
  }

  getGoogleStatus().then((status) => paint(status));
  return root;
}

// The tutor's switch for the calendar toolbar: "Google Calendar" on or off with
// the sync status beside it and a small menu (Sync now, Disconnect). Off, it
// connects first. A change refreshes the whole store (invalidateAll, because
// invalidate(null) leaves a student's cached sessions in place). onStatus(status)
// hears the status each time it is painted, so the calendar can show or hide
// personal events. Left hidden when the status cannot be read. Call .refresh()
// on the element to read the status again.
export function tutorGoogleControl({ toast, store, signal, onStatus } = {}) {
  const root = h('div', { class: 'cal-google', hidden: true });
  const statusId = uid('cal-google-status');
  let status = null;
  let working = false;

  const isOn = (s) => Boolean(s?.connected && s.sync_enabled);

  function paint(next) {
    status = next;
    onStatus?.(next);
    if (next.unavailable) {
      root.hidden = true;
      root.replaceChildren();
      return;
    }
    root.hidden = false;
    // The controls are rebuilt, so keyboard focus is handed to their twin (or the switch)
    const keep = root.contains(document.activeElement) ? document.activeElement.dataset?.focusKey : null;
    const on = isOn(next);
    const reconnect = on && next.last_error === 'reconnect';

    const switchBtn = h('button', {
      type: 'button',
      class: 'cal-switch',
      role: 'switch',
      'aria-checked': on ? 'true' : 'false',
      'aria-describedby': statusId,
      dataset: { focusKey: 'cal-google-switch' },
      onClick: () => toggle(),
    },
    h('span', { class: 'cal-switch-track', 'aria-hidden': 'true' }, h('span', { class: 'cal-switch-thumb' })),
    h('span', { class: 'cal-switch-label' }, 'Google Calendar'));

    const text = syncStatusText(next);
    const parts = [switchBtn];
    if (reconnect) {
      parts.push(
        h('span', { class: 'visually-hidden', id: statusId }, text),
        h('button', {
          type: 'button',
          class: 'cal-google-reconnect',
          dataset: { focusKey: 'cal-google-reconnect' },
          onClick: (e) => reconnectNow(e.currentTarget),
        }, 'Reconnect Google Calendar'));
    } else {
      parts.push(h('span', { class: ['cal-google-status', on ? null : 'is-off'].filter(Boolean).join(' '), id: statusId }, text));
    }
    if (next.connected) {
      const options = menu({
        label: 'Google Calendar options',
        items: [
          { label: 'Sync now', icon: 'arrow-counter-clockwise', disabled: !on || reconnect, onSelect: () => sync() },
          { label: 'Disconnect', icon: 'x-circle', onSelect: () => disconnect() },
        ],
      });
      const trigger = options.querySelector('[aria-haspopup="menu"]');
      if (trigger) trigger.dataset.focusKey = 'cal-google-menu';
      parts.push(options);
    }
    root.replaceChildren(...parts);
    if (keep) (root.querySelector(`[data-focus-key="${keep}"]`) ?? root.querySelector('.cal-switch'))?.focus();
  }

  // Runs one action at a time; a failure is a toast and leaves the controls as they were
  async function run(action, { failure } = {}) {
    if (working) return;
    working = true;
    root.setAttribute('aria-busy', 'true');
    try {
      await action();
    } catch (error) {
      say(toast, error.message);
      failure?.();
    } finally {
      working = false;
      root.removeAttribute('aria-busy');
    }
  }

  function toggle() {
    return run(async () => {
      if (!isOn(status) && !status?.connected) {
        await connectGoogle('tutor');
        return;
      }
      const turnOn = !isOn(status);
      const next = await setGoogleSync(turnOn);
      paint(next);
      store?.invalidateAll();
      say(toast, turnOn ? 'Google Calendar sync is on' : 'Google Calendar sync is off');
    });
  }

  function reconnectNow(btn) {
    return busy(btn, 'Connecting…', () => run(() => connectGoogle('tutor')));
  }

  function sync() {
    return run(async () => {
      paint(await syncNow());
      store?.invalidateAll();
      say(toast, 'Google Calendar synced');
    }, { failure: () => root.refresh() });
  }

  function disconnect() {
    return run(async () => {
      paint(await disconnectGoogle());
      store?.invalidateAll();
      say(toast, 'Google Calendar disconnected');
    });
  }

  root.refresh = async () => {
    invalidateGoogle();
    paint(await getGoogleStatus());
  };

  // "Synced 2 minutes ago" ages while the page stays open
  const timer = setInterval(() => {
    const el = root.querySelector('.cal-google-status');
    if (el && status) el.textContent = syncStatusText(status);
  }, 60_000);
  signal?.addEventListener('abort', () => clearInterval(timer), { once: true });

  getGoogleStatus().then((s) => paint(s));
  return root;
}
