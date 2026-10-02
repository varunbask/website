import { randomBytes, createHash } from 'node:crypto';

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export class GoogleAuthError extends Error {
  constructor(message = 'Google access was revoked or expired') { super(message); this.name = 'GoogleAuthError'; }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// A fresh nonce for the state table and a PKCE pair (RFC 7636, S256)
export function newState(random = randomBytes) {
  const verifier = b64url(random(32));
  return {
    nonce: b64url(random(32)),
    verifier,
    challenge: b64url(createHash('sha256').update(verifier).digest()),
  };
}

export function authUrl({ clientId, redirectUri, scopes, state, challenge }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
  });
  return `${AUTH_URL}?${p}`;
}

async function tokenRequest(body, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.error === 'invalid_grant') throw new GoogleAuthError();
    throw new Error(`Google token request failed (${res.status})`);
  }
  return json;
}

export function exchangeCode({ code, verifier, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  return tokenRequest({
    code, code_verifier: verifier, client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri, grant_type: 'authorization_code',
  }, fetchImpl);
}

export function refreshAccess({ refreshToken, clientId, clientSecret, fetchImpl = fetch }) {
  return tokenRequest({
    refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token',
  }, fetchImpl);
}

// The verified, lowercased Google address of the account
export async function fetchEmail(accessToken, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.email || json.email_verified === false) throw new Error('Google did not share a verified email');
  return String(json.email).toLowerCase();
}

export async function revoke(token, { fetchImpl = fetch } = {}) {
  try {
    await fetchImpl(`${REVOKE_URL}?${new URLSearchParams({ token })}`, { method: 'POST' });
  } catch {
    // revoking is best effort; the connection row is deleted anyway
  }
}
