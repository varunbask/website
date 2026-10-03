import { describe, test, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from '../../api/_lib/google/crypto.js';

const KEY = randomBytes(32).toString('base64');

describe('encrypt and decrypt', () => {
  test('round-trip', () => {
    expect(decrypt(encrypt('refresh-token-123', KEY), KEY)).toBe('refresh-token-123');
    expect(decrypt(encrypt('', KEY), KEY)).toBe('');
    expect(decrypt(encrypt('naive cafe é 中', KEY), KEY)).toBe('naive cafe é 中');
  });

  test('uses the v1 format with four dot-separated parts', () => {
    const parts = encrypt('x', KEY).split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  test('two encryptions of the same text differ', () => {
    expect(encrypt('same', KEY)).not.toBe(encrypt('same', KEY));
  });

  test('a changed ciphertext throws', () => {
    const parts = encrypt('secret value', KEY).split('.');
    const bytes = Buffer.from(parts[3], 'base64url');
    bytes[0] ^= 1;
    parts[3] = bytes.toString('base64url');
    expect(() => decrypt(parts.join('.'), KEY)).toThrow();
  });

  test('a changed tag throws', () => {
    const parts = encrypt('secret value', KEY).split('.');
    const bytes = Buffer.from(parts[2], 'base64url');
    bytes[0] ^= 1;
    parts[2] = bytes.toString('base64url');
    expect(() => decrypt(parts.join('.'), KEY)).toThrow();
  });

  test('the wrong key throws', () => {
    const other = randomBytes(32).toString('base64');
    expect(() => decrypt(encrypt('secret value', KEY), other)).toThrow();
  });

  test('a 16-byte key throws', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => encrypt('x', short)).toThrow(/32 bytes/);
    expect(() => decrypt(encrypt('x', KEY), short)).toThrow(/32 bytes/);
    expect(() => encrypt('x', undefined)).toThrow(/32 bytes/);
  });

  test('a value that is not an encrypted token throws', () => {
    expect(() => decrypt('plain text', KEY)).toThrow(/Not an encrypted token/);
    expect(() => decrypt('v2.a.b.c', KEY)).toThrow(/Not an encrypted token/);
    expect(() => decrypt(undefined, KEY)).toThrow(/Not an encrypted token/);
  });
});
