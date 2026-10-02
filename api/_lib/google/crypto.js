import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM: 'v1.<iv>.<tag>.<ciphertext>', each base64url
function keyOf(keyB64) {
  const key = Buffer.from(String(keyB64 ?? ''), 'base64');
  if (key.length !== 32) throw new Error('GOOGLE_TOKEN_KEY must be 32 bytes, base64');
  return key;
}

export function encrypt(text, keyB64) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(keyB64), iv);
  const ct = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(blob, keyB64) {
  const [v, iv, tag, ct] = String(blob ?? '').split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Not an encrypted token');
  const decipher = createDecipheriv('aes-256-gcm', keyOf(keyB64), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
