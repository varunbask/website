// Pure parts of profile photos: checks on the chosen file, the square crop,
// file names and paths, and when a signed address needs renewing. No DOM, no
// network (photo-upload.js draws and uploads; photos.js caches the addresses).
//
// Photos live in the private "avatars" bucket at '<person id>/<name>.webp'
// (supabase/migrations/20261025120000_profiles_and_photos.sql). The path rules
// here are the same as the database's; a unit test checks the two agree.

export const PHOTO_BUCKET = 'avatars';

// Every photo is re-drawn as a 256 x 256 square
export const PHOTO_SIZE = 256;

// A file over this size is refused before it is decoded (a phone photo is a few MB)
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

// The bucket's own limit for the finished file
export const MAX_PHOTO_BYTES = 1024 * 1024;

// How long a signed address lasts, and how long before that it counts as old
export const SIGN_SECONDS = 3600;
export const RENEW_BEFORE_MS = 5 * 60 * 1000;

export const PHOTO_TYPES = Object.freeze({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' });

const NAME = /^[A-Za-z0-9_-]{8,64}\.(webp|jpg|png)$/;
const PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9_-]{8,64}\.(webp|jpg|png)$/;
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const MB = 1024 * 1024;

// '' when the file can be used, otherwise the sentence to show
export function checkPhotoFile(file) {
  if (!file) return 'Choose a photo first.';
  const type = String(file.type ?? '');
  if (type && !type.startsWith('image/')) return 'That file is not a photo. Choose a JPG, PNG or WebP picture.';
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) return 'That file is empty. Choose another photo.';
  if (size > MAX_SOURCE_BYTES) return `That photo is over ${MAX_SOURCE_BYTES / MB} MB. Choose a smaller one.`;
  return '';
}

// The largest centered square of a width x height picture: { sx, sy, size },
// or null when the picture has no size
export function squareCrop(width, height) {
  const w = Math.floor(Number(width));
  const h = Math.floor(Number(height));
  if (!(w > 0) || !(h > 0)) return null;
  const size = Math.min(w, h);
  return { sx: Math.floor((w - size) / 2), sy: Math.floor((h - size) / 2), size };
}

// A new random file name: 16 url-safe characters and the extension. `bytes`
// is for tests; the browser's random numbers are used otherwise. 256 is a
// multiple of 64, so every character is equally likely.
export function randomPhotoName(ext = 'webp', bytes = null) {
  const source = bytes ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(source.slice(0, 16), (b) => URL_SAFE[b & 63]).join('');
  if (chars.length < 16) throw new Error('A photo name needs 16 random bytes.');
  return `${chars}.${ext}`;
}

export function extForType(type) {
  return PHOTO_TYPES[type] ?? null;
}

export function isPhotoName(name) {
  return NAME.test(String(name ?? ''));
}

// '<person id>/<name>'
export function photoPath(personId, name) {
  return `${personId}/${name}`;
}

// Whether a path is one the database would accept for this person
export function isPhotoPath(path, personId) {
  const text = String(path ?? '');
  return text.length <= 200 && PATH.test(text) && text.split('/')[0] === String(personId);
}

// A signed address that expires at `expiresAt` (ms) is worth using now only
// while it has more than RENEW_BEFORE_MS left; after that it is signed again
export function isFresh(expiresAt, now = Date.now()) {
  return Number.isFinite(expiresAt) && expiresAt - now > RENEW_BEFORE_MS;
}

// The words under the photo while it is being added
export const PHOTO_STEPS = Object.freeze({
  reading: 'Getting your photo ready…',
  uploading: 'Uploading…',
  saving: 'Saving…',
  removing: 'Removing…',
});
