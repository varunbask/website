import { describe, test, expect } from 'vitest';
import { validateUpload, storagePath, prepareUpload, MAX_UPLOAD_BYTES, MAX_PHOTO_BYTES } from '../../portal/js/upload.js';

const file = (size, type, name = 'work') => new File([new Uint8Array(size)], name, { type });

describe('validateUpload', () => {
  test('accepts PDF, PNG, JPEG and text', () => {
    for (const type of ['application/pdf', 'image/png', 'image/jpeg', 'text/plain']) {
      expect(validateUpload(file(10, type))).toBeNull();
    }
  });

  test('explains what is wrong', () => {
    expect(validateUpload(undefined)).toMatch(/Choose a file/);
    expect(validateUpload(file(10, 'image/heic'))).toMatch(/PDF, a photo/);
    expect(validateUpload(file(0, 'text/plain'))).toMatch(/empty/);
    expect(validateUpload(file(MAX_UPLOAD_BYTES + 1, 'application/pdf'))).toMatch(/20 MB/);
  });
});

describe('storagePath', () => {
  test("puts the file in the student's folder with the right extension", () => {
    const uid = '11111111-2222-3333-4444-555555555555';
    expect(storagePath(uid, 'image/jpeg', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'))
      .toBe(`${uid}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg`);
    expect(storagePath(uid, 'application/pdf')).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/);
  });
});

describe('prepareUpload', () => {
  test('passes PDFs and text through unchanged', async () => {
    const pdf = file(10, 'application/pdf');
    expect(await prepareUpload(pdf)).toEqual({ body: pdf, type: 'application/pdf' });
  });

  test('falls back to the original photo when it cannot be shrunk, if it is small enough', async () => {
    // Node has no createImageBitmap, which is exactly the "cannot shrink" path
    const small = file(1000, 'image/png');
    expect(await prepareUpload(small)).toEqual({ body: small, type: 'image/png' });
    await expect(prepareUpload(file(MAX_PHOTO_BYTES + 1, 'image/jpeg'))).rejects.toThrow(/too large/);
  });
});
