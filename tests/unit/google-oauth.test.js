import { describe, test, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  newState, authUrl, exchangeCode, refreshAccess, fetchEmail, revoke, GoogleAuthError,
  AUTH_URL, TOKEN_URL, USERINFO_URL, REVOKE_URL,
} from '../../api/_lib/google/oauth.js';

const reply = (status, body) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

describe('newState', () => {
  test('nonce and verifier are 43 characters, the challenge is the S256 of the verifier', () => {
    const { nonce, verifier, challenge } = newState();
    expect(nonce).toMatch(/^[\w-]{43}$/);
    expect(verifier).toMatch(/^[\w-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(challenge).toMatch(/^[\w-]{43}$/);
  });

  test('each call is fresh', () => {
    const a = newState();
    const b = newState();
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.nonce).not.toBe(a.verifier);
  });

  test('takes an injected random source', () => {
    const random = vi.fn((n) => Buffer.alloc(n, 1));
    const { nonce, verifier } = newState(random);
    expect(random).toHaveBeenCalledWith(32);
    expect(nonce).toBe(Buffer.alloc(32, 1).toString('base64url'));
    expect(verifier).toBe(nonce);
  });
});

describe('authUrl', () => {
  test('carries every parameter, with the scope space-joined', () => {
    const url = new URL(authUrl({
      clientId: 'cid', redirectUri: 'https://site.test/api/google/callback',
      scopes: ['openid', 'email'], state: 'st', challenge: 'ch',
    }));
    expect(`${url.origin}${url.pathname}`).toBe(AUTH_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid',
      redirect_uri: 'https://site.test/api/google/callback',
      response_type: 'code',
      scope: 'openid email',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
    });
  });
});

describe('exchangeCode', () => {
  test('posts a form with the code verifier and returns the json', async () => {
    const fetchImpl = reply(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3599 });
    const out = await exchangeCode({
      code: 'c', verifier: 'v', clientId: 'cid', clientSecret: 'sec', redirectUri: 'https://site.test/cb', fetchImpl,
    });
    expect(out).toEqual({ access_token: 'at', refresh_token: 'rt', expires_in: 3599 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      code: 'c', code_verifier: 'v', client_id: 'cid', client_secret: 'sec',
      redirect_uri: 'https://site.test/cb', grant_type: 'authorization_code',
    });
  });

  test('an invalid grant is a GoogleAuthError', async () => {
    const fetchImpl = reply(400, { error: 'invalid_grant' });
    await expect(exchangeCode({ code: 'c', fetchImpl })).rejects.toBeInstanceOf(GoogleAuthError);
  });
});

describe('refreshAccess', () => {
  test('posts the refresh grant', async () => {
    const fetchImpl = reply(200, { access_token: 'at2', expires_in: 3599 });
    const out = await refreshAccess({ refreshToken: 'rt', clientId: 'cid', clientSecret: 'sec', fetchImpl });
    expect(out.access_token).toBe('at2');
    expect(Object.fromEntries(new URLSearchParams(fetchImpl.mock.calls[0][1].body))).toEqual({
      refresh_token: 'rt', client_id: 'cid', client_secret: 'sec', grant_type: 'refresh_token',
    });
  });

  test('invalid_grant with a 400 throws GoogleAuthError', async () => {
    const fetchImpl = reply(400, { error: 'invalid_grant', error_description: 'Token has been revoked' });
    const err = await refreshAccess({ refreshToken: 'rt', fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleAuthError);
    expect(err.name).toBe('GoogleAuthError');
  });

  test('another failure throws a plain Error with the status but not the body', async () => {
    const fetchImpl = reply(500, { error: 'backend_error', error_description: 'secret-detail-xyz' });
    const err = await refreshAccess({ refreshToken: 'rt', fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GoogleAuthError);
    expect(err.message).toContain('500');
    expect(err.message).not.toContain('secret-detail-xyz');
    expect(err.message).not.toContain('backend_error');
  });

  test('copes with a failure body that is not json', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } }));
    await expect(refreshAccess({ refreshToken: 'rt', fetchImpl })).rejects.toThrow(/502/);
  });
});

describe('fetchEmail', () => {
  test('lowercases the address and sends the bearer token', async () => {
    const fetchImpl = reply(200, { email: 'Maya.Lin@Example.COM', email_verified: true });
    expect(await fetchEmail('at', { fetchImpl })).toBe('maya.lin@example.com');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(USERINFO_URL);
    expect(init.headers.Authorization).toBe('Bearer at');
  });

  test('throws when email_verified is false', async () => {
    const fetchImpl = reply(200, { email: 'a@b.com', email_verified: false });
    await expect(fetchEmail('at', { fetchImpl })).rejects.toThrow(/verified email/);
  });

  test('throws when there is no email or the request failed', async () => {
    await expect(fetchEmail('at', { fetchImpl: reply(200, {}) })).rejects.toThrow(/verified email/);
    await expect(fetchEmail('at', { fetchImpl: reply(401, { email: 'a@b.com' }) })).rejects.toThrow(/verified email/);
  });
});

describe('revoke', () => {
  test('posts the token to the revoke endpoint', async () => {
    const fetchImpl = reply(200, {});
    await revoke('tok en', { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${REVOKE_URL}?token=tok+en`);
    expect(init.method).toBe('POST');
  });

  test('swallows a network error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('network down'); });
    await expect(revoke('tok', { fetchImpl })).resolves.toBeUndefined();
  });
});
