// Tells the other open portal tabs of this browser that data changed, so each
// drops its cached lists and redraws without a reload (a person was deleted).
// One BroadcastChannel named 'vb-portal' carries { type: 'data-changed' }. A tab
// never hears itself: it posts and listens on the same channel object, which
// BroadcastChannel does not echo back to. Everything is a no-op where
// BroadcastChannel is missing or throws (private windows, old browsers).

export const CHANNEL = 'vb-portal';
export const DATA_CHANGED = 'data-changed';

// The browser's channel, or null where there is none
const openBrowserChannel = () => (typeof globalThis.BroadcastChannel === 'function' ? new globalThis.BroadcastChannel(CHANNEL) : null);

// `open` makes the channel (null for none); tests pass their own
export function createDataSync(open = openBrowserChannel) {
  let channel;
  const get = () => {
    if (channel === undefined) {
      try {
        channel = open() ?? null;
      } catch {
        channel = null;
      }
    }
    return channel;
  };
  return {
    // Posts the change to the other tabs -> whether it could be sent
    announce() {
      try {
        const c = get();
        if (!c) return false;
        c.postMessage({ type: DATA_CHANGED });
        return true;
      } catch {
        return false;
      }
    },
    // Calls fn() when another tab announces a change -> a function that stops listening
    listen(fn) {
      try {
        const c = get();
        if (!c) return () => {};
        const onMessage = (event) => {
          if (event?.data?.type !== DATA_CHANGED) return;
          try {
            fn();
          } catch (error) {
            console.error(error);
          }
        };
        c.addEventListener('message', onMessage);
        return () => {
          try {
            c.removeEventListener('message', onMessage);
          } catch {
            // already closed
          }
        };
      } catch {
        return () => {};
      }
    },
  };
}

const shared = createDataSync();

export const announceDataChanged = () => shared.announce();
export const onDataChanged = (fn) => shared.listen(fn);
