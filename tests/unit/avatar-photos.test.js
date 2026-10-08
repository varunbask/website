import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// A small stand-in for the DOM calls avatar() and photos.js make
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.dataset = {};
    this.listeners = {};
    this.classes = new Set();
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self.classes.add(x)),
      remove: (...c) => c.forEach((x) => self.classes.delete(x)),
      contains: (c) => self.classes.has(c),
      toggle: (c, on) => (on ?? !self.classes.has(c) ? self.classes.add(c) : self.classes.delete(c)),
    };
  }
  set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(v) { this.children = [String(v)]; }
  get textContent() { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(type) { for (const fn of this.listeners[type] ?? []) fn({ type }); }
  append(...nodes) {
    for (const n of nodes) {
      if (n instanceof FakeElement) n.parent = this;
      this.children.push(n);
    }
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  replaceWith(other) {
    const i = this.parent.children.indexOf(this);
    other.parent = this.parent;
    this.parent.children[i] = other;
    this.parent = null;
  }
  querySelector(sel) {
    if (sel === ':scope > img') return this.children.find((c) => c instanceof FakeElement && c.tagName === 'IMG') ?? null;
    throw new Error(`fake DOM: ${sel}`);
  }
  get img() { return this.querySelector(':scope > img'); }
}

const calls = { cards: [], sign: [] };
let cards = [];
vi.mock('../../portal/js/supabase.js', () => ({
  sb: {
    rpc: async (name, args) => {
      if (name !== 'person_cards') throw new Error(name);
      calls.cards.push(args.p_ids);
      return { data: cards.filter((c) => args.p_ids.includes(c.id)), error: null };
    },
    storage: {
      from: (bucket) => ({
        createSignedUrls: async (paths, seconds) => {
          calls.sign.push({ bucket, paths, seconds });
          return { data: paths.map((path) => ({ path, signedUrl: `https://cdn.test/${path}?t=${calls.sign.length}`, error: null })), error: null };
        },
      }),
    },
  },
}));

const { avatar, setAvatarPhoto } = await import('../../portal/js/ui.js');
const photos = await import('../../portal/js/photos.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await tick();
};

beforeEach(() => {
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  globalThis.Node = FakeElement;
  photos.resetPhotos();
  calls.cards.length = 0;
  calls.sign.length = 0;
  cards = [
    { id: 'p1', full_name: 'Maya Lin', role: 'student', avatar_path: 'p1/aaaaaaaaaaaaaaaa.webp' },
    { id: 'p2', full_name: 'Daniel Ortiz', role: 'tutor', avatar_path: 'p2/bbbbbbbbbbbbbbbb.webp' },
    { id: 'p3', full_name: 'Grace Lin', role: 'parent', avatar_path: null },
  ];
});

afterEach(() => {
  delete globalThis.document;
  delete globalThis.Node;
  vi.useRealTimers();
});

describe('avatar()', () => {
  test('initials only, decorative, in the stylesheet size', () => {
    const el = avatar('Maya Chen', { size: 32 });
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toBe('avatar avatar-32');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.textContent).toBe('MC');
    expect(el.img).toBeNull();
  });

  test('with src, a lazy photo over the initials in the same box', () => {
    const el = avatar('Maya Chen', { size: 40, staff: true, src: 'https://cdn.test/a.webp' });
    expect(el.className).toBe('avatar avatar-40 is-staff has-photo');
    expect(el.img.attrs).toMatchObject({ src: 'https://cdn.test/a.webp', alt: '', loading: 'lazy', decoding: 'async' });
    // the initials stay underneath as the fallback
    expect(el.textContent).toBe('MC');
  });

  test('a photo that fails to load leaves the initials', () => {
    const el = avatar('Maya Chen', { src: 'https://cdn.test/broken.webp' });
    el.img.dispatch('error');
    expect(el.img).toBeNull();
    expect(el.classList.contains('has-photo')).toBe(false);
    expect(el.textContent).toBe('MC');
  });

  test('setAvatarPhoto swaps or removes the photo, and leaves the same one alone', () => {
    const el = avatar('Maya Chen');
    setAvatarPhoto(el, 'https://cdn.test/1.webp');
    const first = el.img;
    setAvatarPhoto(el, 'https://cdn.test/1.webp');
    expect(el.img).toBe(first);
    setAvatarPhoto(el, 'https://cdn.test/2.webp');
    expect(el.img.getAttribute('src')).toBe('https://cdn.test/2.webp');
    expect(el.children.filter((c) => c instanceof FakeElement)).toHaveLength(1);
    setAvatarPhoto(el, null);
    expect(el.img).toBeNull();
    expect(el.classList.contains('has-photo')).toBe(false);
  });
});

describe('photos.js', () => {
  test('one render: one person_cards call and one signing call for every avatar on it', async () => {
    const els = [photos.personAvatar('p1', 'Maya Lin'), photos.personAvatar('p2', 'Daniel Ortiz', { staff: true }), photos.personAvatar('p3', 'Grace Lin'), photos.personAvatar('p1', 'Maya Lin', { size: 24 })];
    expect(els.every((el) => el.img === null)).toBe(true);
    expect(els[0].dataset.photoId).toBe('p1');
    await settle();
    expect(calls.cards).toEqual([['p1', 'p2', 'p3']]);
    expect(calls.sign).toEqual([{ bucket: 'avatars', paths: ['p1/aaaaaaaaaaaaaaaa.webp', 'p2/bbbbbbbbbbbbbbbb.webp'], seconds: 3600 }]);
    expect(els[0].img.getAttribute('src')).toBe('https://cdn.test/p1/aaaaaaaaaaaaaaaa.webp?t=1');
    expect(els[1].img.getAttribute('src')).toBe('https://cdn.test/p2/bbbbbbbbbbbbbbbb.webp?t=1');
    expect(els[2].img).toBeNull();
    expect(els[3].img).not.toBeNull();
  });

  test('the next render draws photos at once, with no calls', async () => {
    photos.personAvatar('p1', 'Maya Lin');
    photos.personAvatar('p3', 'Grace Lin');
    await settle();
    const before = [calls.cards.length, calls.sign.length];
    const again = photos.personAvatar('p1', 'Maya Lin');
    expect(again.img.getAttribute('src')).toMatch(/p1\/aaaa/);
    const none = photos.personAvatar('p3', 'Grace Lin');
    await settle();
    expect(none.img).toBeNull();
    expect([calls.cards.length, calls.sign.length]).toEqual(before);
  });

  test('paths from profile rows already loaded need no person_cards call', async () => {
    photos.rememberPaths([{ id: 'p1', avatar_path: 'p1/cccccccccccccccc.webp' }, { id: 'p9', full_name: 'no path column' }]);
    const el = photos.personAvatar('p1', 'Maya Lin');
    await settle();
    expect(calls.cards).toEqual([]);
    expect(calls.sign[0].paths).toEqual(['p1/cccccccccccccccc.webp']);
    expect(el.img.getAttribute('src')).toMatch(/cccc/);
  });

  test('someone the viewer may not see gets initials and is not asked for again soon', async () => {
    const el = photos.personAvatar('stranger', 'Some One');
    await settle();
    expect(calls.cards).toEqual([['stranger']]);
    expect(calls.sign).toEqual([]);
    expect(el.img).toBeNull();
    photos.personAvatar('stranger', 'Some One');
    await settle();
    expect(calls.cards).toHaveLength(1);
  });

  test('an address is signed again in its last five minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T10:00:00Z'));
    photos.personAvatar('p2', 'Daniel Ortiz');
    await settle();
    expect(photos.photoUrl('p2')).toMatch(/t=1$/);
    vi.setSystemTime(new Date('2026-10-08T10:54:00Z'));
    expect(photos.photoUrl('p2')).toMatch(/t=1$/);
    vi.setSystemTime(new Date('2026-10-08T10:56:00Z'));
    expect(photos.photoUrl('p2')).toBeNull();
    const el = photos.personAvatar('p2', 'Daniel Ortiz');
    expect(el.img).toBeNull();
    await settle();
    expect(calls.sign).toHaveLength(2);
    expect(el.img.getAttribute('src')).toMatch(/t=2$/);
    // its path came from person_cards over ten minutes ago, so that was asked again too
    expect(calls.cards).toHaveLength(2);
  });

  test('a new photo path after a change is signed on the next use', async () => {
    photos.personAvatar('p1', 'Maya Lin');
    await settle();
    photos.setPhotoPath('p1', 'p1/dddddddddddddddd.webp');
    expect(photos.photoUrl('p1')).toBeNull();
    await photos.ensurePhotos(['p1']);
    expect(photos.photoUrl('p1')).toMatch(/dddd/);
    photos.setPhotoPath('p1', null);
    expect(photos.photoUrl('p1')).toBeNull();
    expect(photos.photoPath('p1')).toBeNull();
  });

  test('no id: plain initials, nothing asked', async () => {
    const el = photos.personAvatar(null, 'Maya Lin');
    await settle();
    expect(el.dataset.photoId).toBeUndefined();
    expect(calls.cards).toEqual([]);
  });

  test('more than 500 unknown people are asked for in parts of 500', async () => {
    cards = [];
    await photos.ensurePhotos(Array.from({ length: 1201 }, (_, i) => `id-${i}`));
    expect(calls.cards.map((c) => c.length)).toEqual([500, 500, 201]);
  });
});
