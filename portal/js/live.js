// Live updates (the owner's request: every open page follows the data without
// a reload). One Supabase Realtime channel listens to the tables this role may
// read; each message becomes the narrowest store invalidation (live-model.js),
// bursts are folded into one, and the app redraws the page the way it already
// does after any store change (app.js: off-screen render, scroll and focus
// kept, open forms left alone).
//
// startLive({ me, client, store }) never throws. Where Realtime is missing
// (the table is not published, the network blocks websockets) the portal works
// as before: the data still refreshes on a return to the tab and after the
// person's own changes.
//
// What can reach this page:
//   - Realtime messages for rows this person may read (the database filters
//     them), and deletes, which carry only the primary key
//   - a 'data-changed' message from another tab of this site (BroadcastChannel)
//   - the tab coming back after being away, and the connection coming back

import {
  liveTables, createCoalescer, backoffMs, MAX_ATTEMPTS, BROADCAST_NAME, isDataChanged, awayLongEnough,
  isTextEntry, holdsUnsentText,
} from './live-model.js';

const noop = () => {};

export function startLive({
  me,
  client,
  store,
  doc = globalThis.document,
  win = globalThis.window,
  BroadcastChannelCtor = globalThis.BroadcastChannel,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  random = Math.random,
  wait = 600,
  maxWait = 3000,
} = {}) {
  const tables = liveTables(me?.role);
  if (!client?.channel || !store || tables.length === 0) return { stop: noop, status: () => 'off' };

  let stopped = false;
  let channel = null;
  let generation = 0;          // a channel from before the latest connect() is ignored
  let status = 'connecting';   // connecting | live | down | gave-up
  let attempt = 0;
  let retryTimer = null;
  let hadTrouble = false;      // messages may have been missed while we were down
  let hiddenAt = null;
  let broadcast = null;

  const visible = () => !doc || doc.visibilityState !== 'hidden';

  // ---- applying a plan --------------------------------------------------

  async function apply(plan) {
    try {
      // People and colors can have changed: load the colors first so the
      // redraw that follows already paints them
      if (plan.all || plan.people) await store.refreshTutorColors?.();
      if (stopped) return;
      store.asLive(() => {
        if (plan.all) {
          store.invalidateAll();
          return;
        }
        if (plan.people) store.invalidatePeople();
        for (const id of plan.students) store.invalidate(id);
        // Sessions and people already drop the billing data; a billing table on
        // its own drops just that
        if (plan.billing && !plan.people && plan.students.length === 0) store.invalidateBilling();
      });
    } catch (error) {
      console.warn('Live update skipped', error);
    }
  }

  const coalescer = createCoalescer({
    wait, maxWait, now, setTimer, clearTimer, canFlush: visible, onFlush: apply,
  });

  // ---- the channel ------------------------------------------------------

  function dropChannel() {
    const old = channel;
    channel = null;
    generation += 1;
    if (!old) return;
    try {
      Promise.resolve(client.removeChannel?.(old)).catch(noop);
    } catch {
      // already gone
    }
  }

  function scheduleRetry() {
    if (stopped || retryTimer !== null) return;
    if (attempt >= MAX_ATTEMPTS) {
      status = 'gave-up';
      return;
    }
    const delay = backoffMs(attempt, random);
    attempt += 1;
    retryTimer = setTimer(() => {
      retryTimer = null;
      // The library may have rejoined by itself in the meantime
      if (!stopped && status !== 'live') connect();
    }, delay);
  }

  function onState(mine, state) {
    if (stopped || mine !== generation) return;
    if (state === 'SUBSCRIBED') {
      status = 'live';
      attempt = 0;
      if (retryTimer !== null) {
        clearTimer(retryTimer);
        retryTimer = null;
      }
      // Whatever happened while the connection was down is unknown: load it all once
      if (hadTrouble) {
        hadTrouble = false;
        coalescer.add({ all: true });
      }
      return;
    }
    if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
      status = 'down';
      hadTrouble = true;
      scheduleRetry();
    }
  }

  function connect() {
    if (stopped) return;
    dropChannel();
    const mine = generation;
    try {
      let next = client.channel(`portal-live-${mine}`);
      for (const table of tables) next = next.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => coalescer.add(payload));
      channel = next;
      status = 'connecting';
      next.subscribe((state) => {
        try {
          onState(mine, state);
        } catch (error) {
          console.warn('Live update state', error);
        }
      });
    } catch (error) {
      console.warn('Live updates unavailable', error);
      status = 'down';
      hadTrouble = true;
      scheduleRetry();
    }
  }

  // Back to the tab, or the network returned: try now, and start counting again
  function reconnectNow() {
    if (stopped || status === 'live' || status === 'connecting') return;
    if (retryTimer !== null) {
      clearTimer(retryTimer);
      retryTimer = null;
    }
    attempt = 0;
    connect();
  }

  // ---- the tab ----------------------------------------------------------

  function onVisibility() {
    if (!doc || stopped) return;
    if (doc.visibilityState === 'hidden') {
      hiddenAt = now();
      return;
    }
    const away = hiddenAt === null ? 0 : now() - hiddenAt;
    hiddenAt = null;
    reconnectNow();
    // The app already reloads a student whose data is older than five minutes
    // (app.js); this covers a shorter absence that missed messages
    if (awayLongEnough(away)) coalescer.add({ all: true });
    coalescer.flushNow();
  }

  doc?.addEventListener?.('visibilitychange', onVisibility);
  win?.addEventListener?.('online', reconnectNow);

  // Another tab changed data Realtime cannot report (it deleted a person)
  try {
    if (BroadcastChannelCtor) {
      broadcast = new BroadcastChannelCtor(BROADCAST_NAME);
      broadcast.addEventListener('message', (event) => {
        if (isDataChanged(event?.data)) coalescer.add({ all: true });
      });
    }
  } catch {
    broadcast = null;
  }

  connect();

  return {
    status: () => status,
    stop() {
      stopped = true;
      coalescer.cancel();
      if (retryTimer !== null) clearTimer(retryTimer);
      retryTimer = null;
      dropChannel();
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      win?.removeEventListener?.('online', reconnectNow);
      try {
        broadcast?.close();
      } catch {
        // already closed
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Typing

// Watches a page root for text a person is writing. busy() is true while the
// focus is in a text field there, or a field holds text that was typed and not
// yet sent; a live redraw waits then, so nothing typed is lost and the caret
// stays where it is. A search box rebuilds from the view's remembered query,
// so only its focus counts.
export function watchTyping(root, doc = globalThis.document) {
  const base = new WeakMap();   // field -> its value when the person first focused it
  const touched = new WeakSet();
  const valueOf = (el) => (el.isContentEditable ? String(el.textContent ?? '') : String(el.value ?? ''));

  root.addEventListener('focusin', (event) => {
    const el = event.target;
    if (isTextEntry(el) && !base.has(el)) base.set(el, valueOf(el));
  }, true);
  root.addEventListener('input', (event) => {
    const el = event.target;
    if (!isTextEntry(el)) return;
    if (!base.has(el)) base.set(el, String(el.defaultValue ?? ''));
    touched.add(el);
  }, true);

  return {
    busy() {
      const active = doc?.activeElement;
      if (active && active !== doc.body && root.contains(active) && isTextEntry(active)) return true;
      for (const el of root.querySelectorAll('input, textarea, [contenteditable="true"]')) {
        if (holdsUnsentText(el, { touched: touched.has(el), base: base.get(el) })) return true;
      }
      return false;
    },
  };
}
