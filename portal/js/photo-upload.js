// Adding and removing a profile photo (the Profile page).
//
//   preparePhoto(file) -> { blob, type, ext }
//       Checks the file (photo-model.js), decodes it, crops the centered
//       square, draws it at 256 x 256 and encodes it as WebP (JPEG where the
//       browser cannot write WebP). Drawing onto a canvas and encoding again
//       keeps only the pixels: the camera's EXIF data, the location it was
//       taken at included, never leaves the device.
//   savePhoto(personId, file, { onStep }) -> the new path
//       preparePhoto, upload to avatars/<person id>/<random name>.webp,
//       set_avatar, then delete the photo it replaced
//   removePhoto(personId) -> null
//       set_avatar(null), then delete the file
//
// onStep(key) reports progress with a PHOTO_STEPS key (photo-model.js).

import { sb } from './supabase.js';
import {
  PHOTO_BUCKET, PHOTO_SIZE, MAX_PHOTO_BYTES, checkPhotoFile, squareCrop, randomPhotoName, photoPath, extForType,
} from './photo-model.js';
import { setPhotoPath, ensurePhotos, repaintPerson } from './photos.js';

export class PhotoError extends Error {}

// The picture as something a canvas can draw, the right way up (the EXIF
// orientation is applied while decoding)
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Older Safari: no options object. Fall through to an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function preparePhoto(file) {
  const problem = checkPhotoFile(file);
  if (problem) throw new PhotoError(problem);
  let source;
  try {
    source = await decode(file);
  } catch {
    throw new PhotoError('We couldn’t open that picture. Try a JPG or PNG photo.');
  }
  const crop = squareCrop(source.naturalWidth || source.width, source.naturalHeight || source.height);
  if (!crop) throw new PhotoError('We couldn’t open that picture. Try a JPG or PNG photo.');
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, crop.sx, crop.sy, crop.size, crop.size, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  source.close?.();
  // A browser that cannot write WebP hands back a PNG (or nothing): use JPEG then
  for (const [type, quality] of [['image/webp', 0.86], ['image/jpeg', 0.86], ['image/jpeg', 0.7]]) {
    const blob = await toBlob(canvas, type, quality);
    if (blob && blob.type === type && blob.size <= MAX_PHOTO_BYTES) return { blob, type, ext: extForType(type) };
  }
  throw new PhotoError('We couldn’t get that picture ready. Try another photo.');
}

async function deleteFile(path) {
  if (!path) return;
  const { error } = await sb.storage.from(PHOTO_BUCKET).remove([path]);
  // The new photo is saved either way; an old file left behind is only clutter
  if (error) console.error(error);
}

async function afterChange(personId, path) {
  setPhotoPath(personId, path);
  await ensurePhotos([personId]);
  repaintPerson(personId);
}

export async function savePhoto(personId, file, { onStep = () => {} } = {}) {
  onStep('reading');
  const { blob, type, ext } = await preparePhoto(file);
  const path = photoPath(personId, randomPhotoName(ext));
  onStep('uploading');
  const up = await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: type, upsert: false, cacheControl: '3600' });
  if (up.error) throw up.error;
  onStep('saving');
  const { data: old, error } = await sb.rpc('set_avatar', { p_person: personId, p_path: path });
  if (error) {
    await deleteFile(path);
    throw error;
  }
  if (old && old !== path) await deleteFile(old);
  await afterChange(personId, path);
  return path;
}

export async function removePhoto(personId) {
  const { data: old, error } = await sb.rpc('set_avatar', { p_person: personId, p_path: null });
  if (error) throw error;
  if (old) await deleteFile(old);
  await afterChange(personId, null);
  return null;
}
