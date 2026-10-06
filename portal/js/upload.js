// Checks and prepares a homework file before it goes to storage.

import { packJpegsToPdf } from './pdf-pack.js';

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

// A problem the student can fix: its message is shown to them as written
export class UploadProblem extends Error {
  constructor(message) {
    super(message);
    this.name = 'UploadProblem';
  }
}

// Browser only: a JPEG copy whose long edge is at most maxEdge pixels, with
// its pixel size. Photos with a rotation flag (EXIF) come out upright.
async function renderJpeg(file, { maxEdge = 2000, quality = 0.85 } = {}) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';   // transparent PNG areas become white, not black
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return { blob, width: canvas.width, height: canvas.height };
}

async function shrinkPhoto(file, options) {
  return (await renderJpeg(file, options)).blob;
}

// Browser only: one page for the PDF, { bytes, width, height } (a baseline JPEG)
export async function photoToJpeg(file, options) {
  const { blob, width, height } = await renderJpeg(file, options);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
}

// Photos are shrunk to a readable JPEG (smaller uploads, well under the grader's limit)
export async function prepareUpload(file) {
  if (file.type.startsWith('image/')) {
    try {
      return { body: await shrinkPhoto(file), type: 'image/jpeg' };
    } catch {
      /* this browser cannot shrink it: send the original if it is small enough */
    }
    if (file.size > MAX_PHOTO_BYTES) throw new UploadProblem('This photo is too large. Try a smaller photo or a PDF.');
  }
  return { body: file, type: file.type };
}

// The tries when photos become a PDF: pages stay sharp at first (2000 px,
// quality .85); if the PDF is over the upload limit they are shrunk harder
// (1400 px, quality .7) before giving up
export const PAGE_TRIES = [{ maxEdge: 2000, quality: 0.85 }, { maxEdge: 1400, quality: 0.7 }];
export const PDF_NAME = 'pages.pdf';

// Several photos become the pages of one PDF, in the order given.
// onProgress({ page, of, smaller }) runs before each page is prepared (smaller
// is true on the second, harder try).
// Returns { body: File (pages.pdf), type: 'application/pdf' } like prepareUpload.
export async function preparePagesPdf(files, { convert = photoToJpeg, onProgress, maxBytes = MAX_UPLOAD_BYTES } = {}) {
  let size = 0;
  for (const options of PAGE_TRIES) {
    const pages = [];
    for (const [index, file] of files.entries()) {
      onProgress?.({ page: index + 1, of: files.length, smaller: options !== PAGE_TRIES[0] });
      try {
        pages.push(await convert(file, options));
      } catch (err) {
        console.error(`Page ${index + 1} could not be prepared`, err);
        throw new UploadProblem(`Page ${index + 1} could not be prepared. Remove it or choose a different photo, then try again.`);
      }
    }
    const pdf = packJpegsToPdf(pages);
    size = pdf.length;
    if (size <= maxBytes) {
      return { body: new File([pdf], PDF_NAME, { type: 'application/pdf' }), type: 'application/pdf' };
    }
  }
  const mb = (size / (1024 * 1024)).toFixed(1);
  throw new UploadProblem(`These ${files.length} pages add up to ${mb} MB, over the ${Math.round(maxBytes / (1024 * 1024))} MB limit. Remove a page or use smaller photos.`);
}
