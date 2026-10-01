// Checks and prepares a homework file before it goes to storage.

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 7 * 1024 * 1024;   // the grader's limit for a photo
export const EXTENSIONS = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'text/plain': 'txt' };
export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain';

// A message explaining what is wrong with the file, or null if it is fine
export function validateUpload(file) {
  if (!file) return 'Choose a file to upload.';
  if (!EXTENSIONS[file.type]) return 'Upload a PDF, a photo (JPG or PNG), or a text file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return 'Files must be under 20 MB.';
  return null;
}

// Storage path inside the private bucket: '<student id>/<random id>.<ext>'
export function storagePath(userId, mime, id = crypto.randomUUID()) {
  return `${userId}/${id}.${EXTENSIONS[mime]}`;
}

// Browser only: a JPEG copy whose long edge is at most maxEdge pixels
async function shrinkPhoto(file, { maxEdge = 2000, quality = 0.85 } = {}) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';   // transparent PNG areas become white, not black
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

// Photos are shrunk to a readable JPEG (smaller uploads, well under the grader's limit)
export async function prepareUpload(file) {
  if (file.type.startsWith('image/')) {
    try {
      return { body: await shrinkPhoto(file), type: 'image/jpeg' };
    } catch {
      /* this browser cannot shrink it: send the original if it is small enough */
    }
    if (file.size > MAX_PHOTO_BYTES) throw new Error('This photo is too large. Try a smaller photo or a PDF.');
  }
  return { body: file, type: file.type };
}
