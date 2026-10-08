import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PHOTO_BUCKET, PHOTO_SIZE, MAX_SOURCE_BYTES, MAX_PHOTO_BYTES, SIGN_SECONDS, RENEW_BEFORE_MS, PHOTO_TYPES,
  checkPhotoFile, squareCrop, randomPhotoName, extForType, isPhotoName, photoPath, isPhotoPath, isFresh,
} from '../../portal/js/photo-model.js';

const sql = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20261025120000_profiles_and_photos.sql', import.meta.url)), 'utf8');
const ID = '9f150885-0b40-4c45-b141-c7362acb65a0';
const MB = 1024 * 1024;

describe('the chosen file', () => {
  test('a photo of any normal size is fine', () => {
    expect(checkPhotoFile({ type: 'image/jpeg', size: 3 * MB })).toBe('');
    expect(checkPhotoFile({ type: 'image/heic', size: 2 * MB })).toBe('');
    // Some browsers leave the type empty: decoding decides
    expect(checkPhotoFile({ type: '', size: 1000 })).toBe('');
  });

  test('over 15 MB is refused before it is decoded', () => {
    expect(MAX_SOURCE_BYTES).toBe(15 * MB);
    expect(checkPhotoFile({ type: 'image/png', size: 15 * MB })).toBe('');
    expect(checkPhotoFile({ type: 'image/png', size: 15 * MB + 1 })).toBe('That photo is over 15 MB. Choose a smaller one.');
  });

  test('not a picture, empty, or nothing chosen', () => {
    expect(checkPhotoFile({ type: 'application/pdf', size: 1000 })).toMatch(/not a photo/);
    expect(checkPhotoFile({ type: 'image/png', size: 0 })).toMatch(/empty/);
    expect(checkPhotoFile(null)).toBe('Choose a photo first.');
  });
});

describe('the square crop', () => {
  test('a landscape picture keeps its centered square', () => {
    expect(squareCrop(4032, 3024)).toEqual({ sx: 504, sy: 0, size: 3024 });
  });

  test('a portrait picture keeps its centered square', () => {
    expect(squareCrop(1080, 1920)).toEqual({ sx: 0, sy: 420, size: 1080 });
  });

  test('a square stays whole, odd leftovers round down', () => {
    expect(squareCrop(500, 500)).toEqual({ sx: 0, sy: 0, size: 500 });
    expect(squareCrop(101, 100)).toEqual({ sx: 0, sy: 0, size: 100 });
    expect(squareCrop(103, 100)).toEqual({ sx: 1, sy: 0, size: 100 });
  });

  test('a picture with no size has no crop', () => {
    expect(squareCrop(0, 100)).toBeNull();
    expect(squareCrop(NaN, 100)).toBeNull();
    expect(squareCrop(undefined, undefined)).toBeNull();
  });

  test('every photo ends up 256 x 256, under the bucket limit', () => {
    expect(PHOTO_SIZE).toBe(256);
    expect(MAX_PHOTO_BYTES).toBe(1048576);
    expect(sql).toContain(`'avatars', 'avatars', false, ${MAX_PHOTO_BYTES}`);
  });
});

describe('names and paths', () => {
  test('a random name is 16 url-safe characters and the extension', () => {
    for (let i = 0; i < 50; i += 1) {
      const name = randomPhotoName('webp');
      expect(name).toMatch(/^[A-Za-z0-9_-]{16}\.webp$/);
      expect(isPhotoName(name)).toBe(true);
    }
    expect(randomPhotoName('webp')).not.toBe(randomPhotoName('webp'));
  });

  test('the bytes map onto the url-safe alphabet', () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => i * 17);
    expect(randomPhotoName('jpg', bytes)).toBe('ARizEVm3IZq7Mdu_.jpg');
    expect(randomPhotoName('png', new Uint8Array(16).fill(255))).toBe('________________.png');
    expect(() => randomPhotoName('png', new Uint8Array(8))).toThrow();
  });

  test('WebP, JPEG and PNG, the types the bucket takes', () => {
    expect(PHOTO_TYPES).toEqual({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' });
    expect(extForType('image/webp')).toBe('webp');
    expect(extForType('image/gif')).toBeNull();
    expect(sql).toContain("array['image/webp', 'image/jpeg', 'image/png']");
  });

  test('a path is the person\'s folder and the name, as the database checks it', () => {
    const path = photoPath(ID, 'aB3_x-9kLmNoPqRs.webp');
    expect(path).toBe(`${ID}/aB3_x-9kLmNoPqRs.webp`);
    expect(isPhotoPath(path, ID)).toBe(true);
    expect(isPhotoPath(path, '00000000-0000-0000-0000-000000000000')).toBe(false);
    expect(isPhotoPath(`${ID}/short.webp`, ID)).toBe(false);
    expect(isPhotoPath(`${ID}/aB3_x-9kLmNoPqRs.gif`, ID)).toBe(false);
    expect(isPhotoPath(`${ID}/a/aB3_x-9kLmNoPqRs.webp`, ID)).toBe(false);
    expect(isPhotoPath(`${ID}/${'x'.repeat(65)}.webp`, ID)).toBe(false);
    // the same pattern the table, the bucket and set_avatar use
    const pattern = "'^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\\.(webp|jpg|png)$'";
    expect(sql.split(pattern).length - 1).toBe(3);
  });

  test('photos live in the avatars bucket', () => {
    expect(PHOTO_BUCKET).toBe('avatars');
  });
});

describe('signed addresses', () => {
  test('an hour long, and renewed in their last five minutes', () => {
    expect(SIGN_SECONDS).toBe(3600);
    expect(RENEW_BEFORE_MS).toBe(5 * 60 * 1000);
    const now = 1_000_000;
    expect(isFresh(now + 3600_000, now)).toBe(true);
    expect(isFresh(now + 5 * 60_000 + 1, now)).toBe(true);
    expect(isFresh(now + 5 * 60_000, now)).toBe(false);
    expect(isFresh(now - 1, now)).toBe(false);
    expect(isFresh(undefined, now)).toBe(false);
  });
});
