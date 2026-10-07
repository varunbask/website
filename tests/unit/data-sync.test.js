import { describe, test, expect, vi } from 'vitest';
import { createDataSync, CHANNEL, DATA_CHANGED } from '../../portal/js/data-sync.js';

// A stand-in for BroadcastChannel: objects of one name hear each other, never themselves
function fakeBroadcast() {
  const open = new Set();
  class Channel {
    constructor(name) {
      this.name = name;
      this.listeners = new Set();
      open.add(this);
    }
    postMessage(data) {
      for (const other of open) if (other !== this && other.name === this.name) for (const fn of other.listeners) fn({ data });
    }
    addEventListener(type, fn) { if (type === 'message') this.listeners.add(fn); }
    removeEventListener(type, fn) { this.listeners.delete(fn); }
  }
  return Channel;
}

describe('telling the other tabs', () => {
  test('uses one channel named vb-portal and the message { type: "data-changed" }', () => {
    expect(CHANNEL).toBe('vb-portal');
    expect(DATA_CHANGED).toBe('data-changed');
    const Channel = fakeBroadcast();
    const sent = [];
    const tab = createDataSync(() => {
      const c = new Channel(CHANNEL);
      const post = c.postMessage.bind(c);
      c.postMessage = (data) => { sent.push(data); post(data); };
      return c;
    });
    expect(tab.announce()).toBe(true);
    expect(sent).toEqual([{ type: 'data-changed' }]);
  });

  test('another tab hears it; the tab that sent it does not', () => {
    const Channel = fakeBroadcast();
    const a = createDataSync(() => new Channel(CHANNEL));
    const b = createDataSync(() => new Channel(CHANNEL));
    const heardA = vi.fn();
    const heardB = vi.fn();
    a.listen(heardA);
    b.listen(heardB);
    a.announce();
    expect(heardB).toHaveBeenCalledTimes(1);
    expect(heardA).not.toHaveBeenCalled();
    b.announce();
    expect(heardA).toHaveBeenCalledTimes(1);
  });

  test('a tab listens and announces on the same channel, so it never answers itself', () => {
    const Channel = fakeBroadcast();
    let made = 0;
    const tab = createDataSync(() => { made += 1; return new Channel(CHANNEL); });
    const heard = vi.fn();
    tab.listen(heard);
    tab.announce();
    tab.announce();
    expect(made).toBe(1);
    expect(heard).not.toHaveBeenCalled();
  });

  test('other messages are ignored, and a listener that throws does not stop the next message', () => {
    const Channel = fakeBroadcast();
    const sender = new Channel(CHANNEL);
    const tab = createDataSync(() => new Channel(CHANNEL));
    let calls = 0;
    tab.listen(() => { calls += 1; if (calls === 1) throw new Error('boom'); });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    sender.postMessage({ type: 'something-else' });
    sender.postMessage('data-changed');
    sender.postMessage(null);
    expect(calls).toBe(0);
    sender.postMessage({ type: 'data-changed' });
    sender.postMessage({ type: 'data-changed' });
    expect(calls).toBe(2);
    quiet.mockRestore();
  });

  test('stop listening', () => {
    const Channel = fakeBroadcast();
    const a = createDataSync(() => new Channel(CHANNEL));
    const b = createDataSync(() => new Channel(CHANNEL));
    const heard = vi.fn();
    const stop = b.listen(heard);
    a.announce();
    stop();
    a.announce();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  test('without BroadcastChannel it does nothing and says so', () => {
    const none = createDataSync(() => null);
    expect(none.announce()).toBe(false);
    expect(none.listen(() => {})()).toBeUndefined();
    const broken = createDataSync(() => { throw new Error('SecurityError'); });
    expect(broken.announce()).toBe(false);
    expect(typeof broken.listen(() => {})).toBe('function');
  });

  test('a channel that throws on send is a quiet false', () => {
    const tab = createDataSync(() => ({ postMessage() { throw new Error('closed'); }, addEventListener() {}, removeEventListener() {} }));
    expect(tab.announce()).toBe(false);
  });

  test('the default talks to the browser’s own BroadcastChannel when there is one', () => {
    const Channel = fakeBroadcast();
    vi.stubGlobal('BroadcastChannel', Channel);
    try {
      const tab = createDataSync();
      const other = new Channel(CHANNEL);
      const heard = vi.fn();
      other.addEventListener('message', heard);
      expect(tab.announce()).toBe(true);
      expect(heard).toHaveBeenCalledWith({ data: { type: 'data-changed' } });
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal('BroadcastChannel', undefined);
    try {
      expect(createDataSync().announce()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
