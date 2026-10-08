// Profile photos for every avatar in the portal, signed in batches.
//
// Photos live in the private "avatars" bucket, so each one needs a signed
// address. This cache keeps, per person, the photo path and, per path, a
// signed address that lasts an hour (renewed once it has less than five
// minutes left). Nothing is ever signed one avatar at a time:
//
//   personAvatar(id, name, opts)  avatar() with the person's photo when it is
//       already signed. Otherwise it draws the initials and joins this tick's
//       batch: one person_cards() call for people whose path is not known yet,
//       then one createSignedUrls() call for every path that needs an address,
//       and the photos are put into the waiting avatars (same box, no shift).
//   rememberPaths(rows)           profile rows already loaded that carry
//       avatar_path (the workspace's students, a parent's children, People) so
//       those people need no person_cards() call
//   setPhotoPath(id, path)        after a person's own change (set_avatar)
//   ensurePhotos(ids)             the batch itself, for a caller that wants to
//       wait (the Profile page)
//   photoUrl(id)                  the signed address now, or null
//
// The database decides who may see whom (can_see_person): person_cards() and
// the bucket's read policy return nothing for anyone else, and that person
// keeps their initials.

import { sb } from './supabase.js';
import { avatar, setAvatarPhoto } from './ui.js';
import { PHOTO_BUCKET, SIGN_SECONDS, isFresh } from './photo-model.js';

// A path learned from person_cards() is asked for again after this long; one
// from a profile row is replaced whenever that row loads again. A lookup that
// failed is tried again much sooner.
const CARD_TTL_MS = 10 * 60 * 1000;
const RETRY_AFTER_MS = 30 * 1000;
const CARD_BATCH = 500;

const paths = new Map();      // person id -> { path, at, from: 'row' | 'card' }
const signed = new Map();     // path -> { url, expiresAt }
let queued = null;            // { ids: Set, els: Set } waiting for this tick's batch
let chain = Promise.resolve();

const key = (id) => (id === null || id === undefined || id === '' ? null : String(id));

// A path from person_cards() is still shown once it is old, but asked for again
const stale = (entry, now = Date.now()) => entry.from === 'card' && now - entry.at > CARD_TTL_MS;

// Profile rows (or person_cards rows) with an avatar_path column
export function rememberPaths(rows, { from = 'row' } = {}) {
  const at = Date.now();
  for (const row of rows ?? []) {
    const id = key(row?.id);
    if (!id || !row || !('avatar_path' in row)) continue;
    paths.set(id, { path: row.avatar_path || null, at, from });
  }
}

export function setPhotoPath(id, path) {
  const k = key(id);
  if (k) paths.set(k, { path: path || null, at: Date.now(), from: 'row' });
}

// The person's photo path when known: a string, null (no photo, or not
// allowed to see it) or undefined (not asked yet)
export function photoPath(id) {
  const k = key(id);
  return k ? paths.get(k)?.path : undefined;
}

// The signed address of this person's photo, if one is ready
export function photoUrl(id) {
  const k = key(id);
  const path = k ? paths.get(k)?.path : null;
  if (!path) return null;
  const s = signed.get(path);
  return s && isFresh(s.expiresAt) ? s.url : null;
}

// Whether a batch could bring this person's avatar something new
function needsBatch(id) {
  const entry = paths.get(id);
  if (!entry || stale(entry)) return true;
  return Boolean(entry.path) && !photoUrl(id);
}

async function loadCards(ids) {
  for (let i = 0; i < ids.length; i += CARD_BATCH) {
    const part = ids.slice(i, i + CARD_BATCH);
    const at = Date.now();
    const { data, error } = await sb.rpc('person_cards', { p_ids: part });
    if (error) {
      // Not this time (offline, or the migration is not there yet): initials,
      // and a new try in half a minute
      for (const id of part) paths.set(id, { path: null, at: at - CARD_TTL_MS + RETRY_AFTER_MS, from: 'card' });
      continue;
    }
    const found = new Set();
    for (const row of data ?? []) {
      found.add(String(row.id));
      paths.set(String(row.id), { path: row.avatar_path || null, at, from: 'card' });
    }
    // Someone the caller may not see: no photo, without asking again for a while
    for (const id of part) if (!found.has(id)) paths.set(id, { path: null, at, from: 'card' });
  }
}

async function signPaths(list) {
  if (!list.length) return;
  const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrls(list, SIGN_SECONDS);
  if (error) return;
  const expiresAt = Date.now() + SIGN_SECONDS * 1000;
  for (const item of data ?? []) {
    if (item?.signedUrl && !item.error && item.path) signed.set(item.path, { url: item.signedUrl, expiresAt });
  }
}

async function run(ids) {
  const unique = [...new Set(ids.map(key).filter(Boolean))];
  const unknown = unique.filter((id) => !paths.has(id) || stale(paths.get(id)));
  if (unknown.length) await loadCards(unknown);
  const toSign = [...new Set(unique.map((id) => paths.get(id)?.path).filter((p) => p && !isFresh(signed.get(p)?.expiresAt)))];
  await signPaths(toSign);
}

// Paths and addresses for these people, in as few calls as possible. Batches
// run one after another, so a second one only asks for what the first did not
// get. Never rejects.
export function ensurePhotos(ids) {
  const next = chain.then(() => run(ids)).catch((error) => console.error(error));
  chain = next;
  return next;
}

function flush() {
  const batch = queued;
  queued = null;
  if (!batch) return;
  ensurePhotos([...batch.ids]).then(() => {
    for (const el of batch.els) {
      const url = photoUrl(el.dataset.photoId);
      if (url) setAvatarPhoto(el, url);
    }
  });
}

// A photo that fails to load (replaced and deleted since it was signed, or
// its address ran out): forget what we knew, so the next draw asks again
function forget(id) {
  const entry = paths.get(id);
  if (entry?.path) signed.delete(entry.path);
  if (entry) paths.set(id, { ...entry, at: 0, from: 'card' });
}

// avatar(name, opts) for a person: their photo when it is signed already,
// otherwise the initials until this tick's batch brings it
export function personAvatar(id, name, opts = {}) {
  const k = key(id);
  const el = avatar(name, { ...opts, src: k ? photoUrl(k) : null });
  if (!k) return el;
  el.dataset.photoId = k;
  // error does not bubble, but it can be heard on the way down
  el.addEventListener('error', () => forget(k), true);
  if (needsBatch(k)) {
    if (!queued) {
      queued = { ids: new Set(), els: new Set() };
      setTimeout(flush, 0);
    }
    queued.ids.add(k);
    queued.els.add(el);
  }
  return el;
}

// Every avatar on the page for this person shows `url` (or the initials):
// after the person changed their photo, without waiting for a redraw
export function repaintPerson(id, root = typeof document === 'undefined' ? null : document) {
  const k = key(id);
  if (!k || !root) return;
  const url = photoUrl(k);
  for (const el of root.querySelectorAll(`.avatar[data-photo-id="${CSS.escape(k)}"]`)) setAvatarPhoto(el, url);
}

// For tests: forget everything
export function resetPhotos() {
  paths.clear();
  signed.clear();
  queued = null;
  chain = Promise.resolve();
}
