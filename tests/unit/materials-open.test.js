import { test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// materials-ui.js reaches the Supabase client at import time: stand in for the CDN script
const sign = vi.fn();
let wireFileOpen;
beforeAll(async () => {
  globalThis.window = {
    supabase: { createClient: () => ({ storage: { from: () => ({ createSignedUrl: sign }) } }) },
    open: vi.fn(),
  };
  ({ wireFileOpen } = await import('../../portal/js/materials-ui.js'));
});

// Just enough of an element: events, tagName, href
function fakeEl(tagName) {
  const handlers = {};
  return {
    tagName, href: '',
    addEventListener: (type, fn) => { (handlers[type] ??= []).push(fn); },
    fire(type) {
      const event = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      return Promise.all((handlers[type] ?? []).map((fn) => fn(event))).then(() => event);
    },
  };
}
const PDF = { id: 1, title: 'Fractions', storage_path: 's1/a.pdf', file_type: 'application/pdf' };
const DOCX = { id: 2, title: 'Notes', storage_path: 's1/b.docx', file_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  sign.mockReset();
  sign.mockImplementation(async (path) => ({ data: { signedUrl: `https://files.test/${path}?t=${Date.now()}` }, error: null }));
  window.open.mockReset();
});
afterEach(() => vi.useRealTimers());

test('a link element is signed at once, and its href is the signed link', async () => {
  const a = fakeEl('A');
  wireFileOpen(a, PDF);
  await vi.advanceTimersByTimeAsync(1);
  expect(sign).toHaveBeenCalledTimes(1);
  expect(sign.mock.calls[0].slice(0, 2)).toEqual(['s1/a.pdf', 600]);
  expect(a.href).toMatch(/^https:\/\/files\.test\/s1\/a\.pdf/);
});

test('PDFs and images open in the tab; Office files download under the title', async () => {
  wireFileOpen(fakeEl('A'), PDF);
  wireFileOpen(fakeEl('A'), DOCX);
  await vi.advanceTimersByTimeAsync(1);
  expect(sign.mock.calls[0][2]).toBeUndefined();
  expect(sign.mock.calls[1][2]).toEqual({ download: 'Notes.docx' });
});

test('a fresh link is left to the browser; a stale one is signed again and opened', async () => {
  const a = fakeEl('A');
  wireFileOpen(a, PDF);
  await vi.advanceTimersByTimeAsync(1);
  expect((await a.fire('click')).defaultPrevented).toBe(false);
  expect(window.open).not.toHaveBeenCalled();

  vi.setSystemTime(new Date('2026-10-14T12:09:00Z'));   // past 8 minutes
  const click = a.fire('click');
  await vi.advanceTimersByTimeAsync(1);
  expect((await click).defaultPrevented).toBe(true);
  expect(sign).toHaveBeenCalledTimes(2);
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(window.open.mock.calls[0][1]).toBe('_blank');
  expect(window.open.mock.calls[0][2]).toBe('noopener');
});

test('a button opens the signed link on click, at once when it is fresh', async () => {
  const b = fakeEl('BUTTON');
  wireFileOpen(b, PDF);
  await vi.advanceTimersByTimeAsync(1);
  expect(b.href).toBe('');   // a button has no href to set
  const event = await b.fire('click');
  expect(event.defaultPrevented).toBe(true);
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(window.open.mock.calls[0][0]).toMatch(/^https:\/\/files\.test\/s1\/a\.pdf/);
  expect(sign).toHaveBeenCalledTimes(1);
});

test('a button clicked before it was signed waits for the link', async () => {
  const b = fakeEl('BUTTON');
  let resolve;
  sign.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  wireFileOpen(b, PDF);
  const click = b.fire('click');
  expect(window.open).not.toHaveBeenCalled();
  resolve({ data: { signedUrl: 'https://files.test/late' }, error: null });
  await click;
  expect(window.open).toHaveBeenCalledWith('https://files.test/late', '_blank', 'noopener');
  expect(sign).toHaveBeenCalledTimes(1);   // the click shared the signing already under way
});

test('hovering or focusing while a signing is under way does not sign twice', async () => {
  const a = fakeEl('A');
  wireFileOpen(a, PDF);
  a.fire('pointerenter');
  a.fire('focus');
  await vi.advanceTimersByTimeAsync(1);
  expect(sign).toHaveBeenCalledTimes(1);
});

test('hovering renews a stale link', async () => {
  const a = fakeEl('A');
  wireFileOpen(a, PDF);
  await vi.advanceTimersByTimeAsync(1);
  const first = a.href;
  vi.setSystemTime(new Date('2026-10-14T12:09:00Z'));
  a.fire('pointerenter');
  await vi.advanceTimersByTimeAsync(1);
  expect(sign).toHaveBeenCalledTimes(2);
  expect(a.href).not.toBe(first);
});

test('without an observer a lazy element signs at once; with one it waits to come near the screen', async () => {
  const a = fakeEl('A');
  wireFileOpen(a, PDF, { lazy: true });
  await vi.advanceTimersByTimeAsync(1);
  expect(sign).toHaveBeenCalledTimes(1);   // no IntersectionObserver here

  sign.mockClear();
  let notify;
  const observed = [];
  globalThis.IntersectionObserver = class {
    constructor(fn) { notify = fn; }
    observe(el) { observed.push(el); }
    unobserve() {}
  };
  try {
    const b = fakeEl('A');
    wireFileOpen(b, PDF, { lazy: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(sign).not.toHaveBeenCalled();
    expect(observed).toEqual([b]);
    notify([{ isIntersecting: false, target: b }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sign).not.toHaveBeenCalled();
    notify([{ isIntersecting: true, target: b }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(b.href).toMatch(/files\.test/);
  } finally {
    delete globalThis.IntersectionObserver;
  }
});

test('a failure to sign is reported on click, never thrown', async () => {
  sign.mockImplementation(async () => ({ data: null, error: new Error('nope') }));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const onError = vi.fn();
  const b = fakeEl('BUTTON');
  wireFileOpen(b, PDF, { onError });
  await vi.advanceTimersByTimeAsync(1);   // the warm-up failed quietly
  expect(onError).not.toHaveBeenCalled();
  const click = b.fire('click');
  await vi.advanceTimersByTimeAsync(1);
  await click;
  expect(onError).toHaveBeenCalledTimes(1);
  expect(window.open).not.toHaveBeenCalled();
  log.mockRestore();
});
