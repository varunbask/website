import { test, expect, vi } from 'vitest';
import { startLive, watchTyping } from '../../portal/js/live.js';
import { liveTables, backoffMs, MAX_ATTEMPTS, AWAY_REFRESH_MS } from '../../portal/js/live-model.js';
import { fakeClock } from './fake-clock.js';

// ---------------------------------------------------------------------------
// Fakes: the Supabase client's channel API, the store, the document and window,
// and BroadcastChannel

function fakeClient({ failChannel = false } = {}) {
  const channels = [];
  const removed = [];
  return {
    channels,
    removed,
    channel(name) {
      if (failChannel) throw new Error('no realtime');
      const ch = {
        name,
        bindings: [],
        callback: null,
        on(type, filter, handler) {
          ch.bindings.push({ type, filter, handler });
          return ch;
        },
        subscribe(cb) {
          ch.callback = cb;
          return ch;
        },
        // test helpers
        status(state) { ch.callback?.(state); },
        send(payload) {
          const table = payload.table;
          for (const b of ch.bindings) if (b.filter.table === table) b.handler(payload);
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) {
      removed.push(ch);
      return Promise.resolve('ok');
    },
    get live() { return channels[channels.length - 1]; },
  };
}

function fakeStore() {
  const calls = [];
  let live = false;
  const note = (name) => (...args) => { calls.push([name, ...args, live ? 'live' : 'own']); };
  return {
    calls,
    asLive(fn) {
      live = true;
      try { fn(); } finally { live = false; }
    },
    invalidate: note('invalidate'),
    invalidateAll: note('invalidateAll'),
    invalidatePeople: note('invalidatePeople'),
    invalidateBilling: note('invalidateBilling'),
    refreshTutorColors: async () => { calls.push(['colors']); },
  };
}

function fakeTarget(initial = {}) {
  const handlers = new Map();
  return {
    ...initial,
    addEventListener(type, fn) { handlers.set(type, [...(handlers.get(type) ?? []), fn]); },
    removeEventListener(type, fn) { handlers.set(type, (handlers.get(type) ?? []).filter((f) => f !== fn)); },
    emit(type, event = {}) { for (const fn of handlers.get(type) ?? []) fn(event); },
    count: (type) => (handlers.get(type) ?? []).length,
  };
}

function fakeBroadcast() {
  const made = [];
  class Fake {
    constructor(name) {
      this.name = name;
      this.closed = false;
      this.target = fakeTarget();
      made.push(this);
    }
    addEventListener(type, fn) { this.target.addEventListener(type, fn); }
    close() { this.closed = true; }
    receive(data) { this.target.emit('message', { data }); }
  }
  return { Fake, made };
}

const sessionRow = (over = {}) => ({
  schema: 'public', table: 'sessions', eventType: 'UPDATE', errors: null, old: {},
  new: { id: 12, student_id: 'maya', tutor_id: 'dan', attendance: 'present' },
  ...over,
});

function setup({ role = 'tutor', ...clientOptions } = {}) {
  const clock = fakeClock();
  const client = fakeClient(clientOptions);
  const store = fakeStore();
  const doc = fakeTarget({ visibilityState: 'visible' });
  const win = fakeTarget();
  const { Fake, made } = fakeBroadcast();
  const live = startLive({
    me: { id: 'u1', role }, client, store, doc, win, BroadcastChannelCtor: Fake,
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, random: () => 0.5,
  });
  return { clock, client, store, doc, win, live, broadcasts: made };
}

const flushMicrotasks = () => new Promise((resolve) => { setImmediate(resolve); });

// ---------------------------------------------------------------------------

test('one channel listens to every table the role may read, for every kind of change', () => {
  const { client } = setup({ role: 'admin' });
  expect(client.channels).toHaveLength(1);
  const [ch] = client.channels;
  expect(ch.bindings.map((b) => b.filter.table)).toEqual(liveTables('admin'));
  for (const b of ch.bindings) {
    expect(b.type).toBe('postgres_changes');
    expect(b.filter).toMatchObject({ event: '*', schema: 'public' });
  }
  expect(ch.callback).toBeTypeOf('function');
});

test('a student listens to fewer tables than the admin, and never to money', () => {
  const { client } = setup({ role: 'student' });
  const tables = client.live.bindings.map((b) => b.filter.table);
  expect(tables).toEqual(liveTables('student'));
  expect(tables).not.toContain('payments');
  expect(tables).not.toContain('statements');
});

test('a burst of session changes becomes one student invalidation, as a live change', async () => {
  const { client, store, clock } = setup();
  client.live.status('SUBSCRIBED');
  client.live.send(sessionRow());
  client.live.send(sessionRow({ new: { id: 13, student_id: 'maya' } }));
  client.live.send(sessionRow({ table: 'tasks', new: { id: 1, student_id: 'sam' } }));
  clock.advance(599);
  expect(store.calls).toEqual([]);
  clock.advance(1);
  await flushMicrotasks();
  expect(store.calls).toEqual([['invalidate', 'maya', 'live'], ['invalidate', 'sam', 'live']]);
});

test('a billing change drops the billing data alone', async () => {
  const { client, store, clock } = setup({ role: 'admin' });
  client.live.send({ schema: 'public', table: 'payments', eventType: 'INSERT', new: { id: 3 }, old: {}, errors: null });
  clock.advance(600);
  await flushMicrotasks();
  expect(store.calls).toEqual([['invalidateBilling', 'live']]);
});

test('a billing change next to a session change does not reload billing twice', async () => {
  const { client, store, clock } = setup({ role: 'admin' });
  client.live.send({ schema: 'public', table: 'payments', eventType: 'INSERT', new: { id: 3 }, old: {}, errors: null });
  client.live.send(sessionRow());
  clock.advance(600);
  await flushMicrotasks();
  expect(store.calls).toEqual([['invalidate', 'maya', 'live']]);
});

test('people and links drop the people lists, load the tutor colors first, and name the student', async () => {
  const { client, store, clock } = setup({ role: 'admin' });
  client.live.send({ schema: 'public', table: 'parent_students', eventType: 'INSERT', new: { parent_id: 'grace', student_id: 'maya' }, old: {}, errors: null });
  client.live.send({ schema: 'public', table: 'profiles', eventType: 'UPDATE', new: { id: 'dan', full_name: 'Daniel' }, old: {}, errors: null });
  clock.advance(600);
  await flushMicrotasks();
  expect(store.calls).toEqual([['colors'], ['invalidatePeople', 'live'], ['invalidate', 'maya', 'live']]);
});

test('a deleted person or a delete without a student refreshes everything', async () => {
  const { client, store, clock } = setup({ role: 'admin' });
  client.live.send({ schema: 'public', table: 'profiles', eventType: 'DELETE', new: {}, old: { id: 'sam' }, errors: null });
  clock.advance(600);
  await flushMicrotasks();
  expect(store.calls).toEqual([['colors'], ['invalidateAll', 'live']]);
});

test('another tab saying data-changed refreshes everything, once, through the same debounce', async () => {
  const { broadcasts, store, clock } = setup();
  expect(broadcasts).toHaveLength(1);
  expect(broadcasts[0].name).toBe('vb-portal');
  broadcasts[0].receive({ type: 'data-changed' });
  broadcasts[0].receive({ type: 'data-changed' });
  broadcasts[0].receive({ type: 'something-else' });
  broadcasts[0].receive(null);
  expect(store.calls).toEqual([]);
  clock.advance(600);
  await flushMicrotasks();
  expect(store.calls).toEqual([['colors'], ['invalidateAll', 'live']]);
});

test('changes that arrive while the tab is hidden wait for it to come back', async () => {
  const { client, store, clock, doc } = setup();
  doc.visibilityState = 'hidden';
  doc.emit('visibilitychange');
  client.live.send(sessionRow());
  clock.advance(5000);
  await flushMicrotasks();
  expect(store.calls).toEqual([]);
  clock.advance(1000);
  doc.visibilityState = 'visible';
  doc.emit('visibilitychange');
  await flushMicrotasks();
  // away for six seconds: a short absence, so only what was reported
  expect(store.calls).toEqual([['invalidate', 'maya', 'live']]);
});

test('a tab that was away a while loads everything once on its return', async () => {
  const { store, clock, doc } = setup();
  doc.visibilityState = 'hidden';
  doc.emit('visibilitychange');
  clock.advance(AWAY_REFRESH_MS);
  doc.visibilityState = 'visible';
  doc.emit('visibilitychange');
  await flushMicrotasks();
  expect(store.calls).toEqual([['colors'], ['invalidateAll', 'live']]);
  // switching back and forth quickly asks for nothing
  store.calls.length = 0;
  doc.visibilityState = 'hidden';
  doc.emit('visibilitychange');
  clock.advance(2000);
  doc.visibilityState = 'visible';
  doc.emit('visibilitychange');
  clock.advance(1000);
  await flushMicrotasks();
  expect(store.calls).toEqual([]);
});

// ---------------------------------------------------------------------------
// Reconnecting

test('a failed channel is replaced after the backoff, then everything loads once it is back', async () => {
  const { client, store, clock, live } = setup();
  const first = client.live;
  first.status('SUBSCRIBED');
  expect(live.status()).toBe('live');
  first.status('CHANNEL_ERROR');
  expect(live.status()).toBe('down');
  expect(client.channels).toHaveLength(1);
  clock.advance(backoffMs(0, () => 0.5) - 1);
  expect(client.channels).toHaveLength(1);
  clock.advance(1);
  expect(client.channels).toHaveLength(2);
  expect(client.removed).toEqual([first]);
  const second = client.live;
  expect(second.name).not.toBe(first.name);
  expect(second.bindings).toHaveLength(first.bindings.length);
  // the old channel's late messages do not count
  first.status('SUBSCRIBED');
  expect(live.status()).toBe('connecting');
  second.status('SUBSCRIBED');
  expect(live.status()).toBe('live');
  clock.advance(600);
  await flushMicrotasks();
  expect(store.calls).toEqual([['colors'], ['invalidateAll', 'live']]);
});

test('timeouts and closes retry too, and each retry waits twice as long', () => {
  const { client, clock } = setup();
  const waits = [];
  for (let i = 0; i < 4; i += 1) {
    const before = client.channels.length;
    client.live.status(i % 2 ? 'TIMED_OUT' : 'CLOSED');
    let waited = 0;
    while (client.channels.length === before && waited < 100_000) {
      clock.advance(100);
      waited += 100;
    }
    waits.push(waited);
  }
  expect(waits).toEqual([1000, 2000, 4000, 8000]);
});

test('a successful connection resets the backoff', () => {
  const { client, clock } = setup();
  client.live.status('CHANNEL_ERROR');
  clock.advance(1000);
  client.live.status('CHANNEL_ERROR');
  clock.advance(2000);
  expect(client.channels).toHaveLength(3);
  client.live.status('SUBSCRIBED');
  client.live.status('CLOSED');
  clock.advance(999);
  expect(client.channels).toHaveLength(3);
  clock.advance(1);
  expect(client.channels).toHaveLength(4);
});

test('after too many failures it stops trying until the tab or the network comes back', () => {
  const { client, clock, doc, win, live } = setup();
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    client.live.status('CHANNEL_ERROR');
    clock.advance(30_000);
  }
  expect(client.channels).toHaveLength(MAX_ATTEMPTS + 1);
  client.live.status('CHANNEL_ERROR');
  clock.advance(10 * 60_000);
  expect(client.channels).toHaveLength(MAX_ATTEMPTS + 1);
  expect(live.status()).toBe('gave-up');
  // the network returns
  win.emit('online');
  expect(client.channels).toHaveLength(MAX_ATTEMPTS + 2);
  client.live.status('CHANNEL_ERROR');
  expect(live.status()).toBe('down');
  clock.advance(1000);
  expect(client.channels).toHaveLength(MAX_ATTEMPTS + 3);
  // and again by returning to the tab
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    client.live.status('CHANNEL_ERROR');
    clock.advance(30_000);
  }
  client.live.status('CHANNEL_ERROR');
  expect(live.status()).toBe('gave-up');
  const before = client.channels.length;
  doc.visibilityState = 'hidden';
  doc.emit('visibilitychange');
  doc.visibilityState = 'visible';
  doc.emit('visibilitychange');
  expect(client.channels).toHaveLength(before + 1);
});

test('a channel the library rejoined by itself is not replaced', () => {
  const { client, clock } = setup();
  const first = client.live;
  first.status('CHANNEL_ERROR');
  clock.advance(500);
  first.status('SUBSCRIBED');
  clock.advance(5000);
  expect(client.channels).toHaveLength(1);
});

test('stopping closes the channel and the tab listener', () => {
  const { client, doc, win, live, broadcasts, clock } = setup();
  expect(doc.count('visibilitychange')).toBe(1);
  live.stop();
  expect(client.removed).toEqual([client.channels[0]]);
  expect(doc.count('visibilitychange')).toBe(0);
  expect(win.count('online')).toBe(0);
  expect(broadcasts[0].closed).toBe(true);
  client.channels[0].status('CHANNEL_ERROR');
  clock.advance(60_000);
  expect(client.channels).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Never throws

test('without Realtime the portal carries on: nothing throws', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { live, client, clock } = setup({ failChannel: true });
  expect(live.status()).toBe('down');
  clock.advance(1000);
  expect(client.channels).toHaveLength(0);
  expect(() => live.stop()).not.toThrow();
  warn.mockRestore();
});

test('a client with no channel API, a role with no tables, or no BroadcastChannel are all fine', () => {
  const store = fakeStore();
  expect(startLive({ me: { id: 'u', role: 'tutor' }, client: {}, store }).status()).toBe('off');
  expect(startLive({ me: { id: 'u', role: 'pending' }, client: fakeClient(), store }).status()).toBe('off');
  expect(startLive({ me: { id: 'u', role: 'tutor' }, client: null, store }).stop).toBeTypeOf('function');
  const live = startLive({
    me: { id: 'u', role: 'student' }, client: fakeClient(), store, doc: fakeTarget({ visibilityState: 'visible' }), win: fakeTarget(),
    BroadcastChannelCtor: class { constructor() { throw new Error('unsupported'); } },
  });
  expect(live.status()).toBe('connecting');
  live.stop();
});

test('a store that fails while applying a change does not break the next one', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { client, store, clock } = setup();
  let fail = true;
  store.invalidate = (id) => {
    if (fail) throw new Error('boom');
    store.calls.push(['invalidate', id]);
  };
  client.live.send(sessionRow());
  clock.advance(600);
  await flushMicrotasks();
  fail = false;
  client.live.send(sessionRow());
  clock.advance(600);
  await flushMicrotasks();
  expect(store.calls).toEqual([['invalidate', 'maya']]);
  warn.mockRestore();
});

// ---------------------------------------------------------------------------
// Typing

function fakeRoot(fields = []) {
  const root = fakeTarget({ querySelectorAll: () => fields, contains: (el) => fields.includes(el) });
  return root;
}
const textarea = (value = '') => ({ tagName: 'TEXTAREA', type: 'textarea', value, defaultValue: '', readOnly: false, disabled: false, getAttribute: () => null });

test('the page is busy while a text field has focus or holds typed text', () => {
  const box = textarea();
  const root = fakeRoot([box]);
  const doc = { activeElement: { tagName: 'BODY' }, body: { tagName: 'BODY' } };
  doc.activeElement = doc.body;
  const typing = watchTyping(root, doc);
  expect(typing.busy()).toBe(false);

  // focus alone
  doc.activeElement = box;
  expect(typing.busy()).toBe(true);
  doc.activeElement = doc.body;
  expect(typing.busy()).toBe(false);

  // typed text stays busy after the focus moves on, until it is sent or cleared
  root.emit('focusin', { target: box });
  box.value = 'half a note';
  root.emit('input', { target: box });
  expect(typing.busy()).toBe(true);
  box.value = '';
  expect(typing.busy()).toBe(false);
});

test('a field the person only focused, or a search box, never holds a refresh back once blurred', () => {
  const search = { tagName: 'INPUT', type: 'search', value: 'ma', defaultValue: '', readOnly: false, disabled: false, getAttribute: () => null };
  const root = fakeRoot([search]);
  const doc = { body: { tagName: 'BODY' } };
  doc.activeElement = doc.body;
  const typing = watchTyping(root, doc);
  root.emit('focusin', { target: search });
  root.emit('input', { target: search });
  expect(typing.busy()).toBe(false);
  doc.activeElement = search;
  expect(typing.busy()).toBe(true);
});
