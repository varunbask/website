import { describe, test, expect } from 'vitest';
import {
  googleConfig, SCOPES, CALENDAR_NAME, TIME_ZONE, MAX_PERSONAL_DAYS, CHANNEL_TTL_SECONDS, RENEW_WITHIN_MS,
} from '../../api/_lib/google/config.js';

const FULL = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_TOKEN_KEY: 'key' };

describe('googleConfig', () => {
  test('is null when any of the three Google variables is missing', () => {
    expect(googleConfig({})).toBeNull();
    expect(googleConfig({ ...FULL, GOOGLE_CLIENT_ID: undefined })).toBeNull();
    expect(googleConfig({ ...FULL, GOOGLE_CLIENT_SECRET: '' })).toBeNull();
    expect(googleConfig({ ...FULL, GOOGLE_TOKEN_KEY: undefined })).toBeNull();
  });

  test('uses the default site URL', () => {
    const c = googleConfig(FULL);
    expect(c.siteUrl).toBe('https://www.varunbaskaran.com');
    expect(c).toMatchObject({ clientId: 'id', clientSecret: 'secret', tokenKey: 'key' });
  });

  test('strips trailing slashes from SITE_URL', () => {
    expect(googleConfig({ ...FULL, SITE_URL: 'https://preview.test//' }).siteUrl).toBe('https://preview.test');
    expect(googleConfig({ ...FULL, SITE_URL: 'https://preview.test/' }).siteUrl).toBe('https://preview.test');
  });

  test('builds the redirect, notify and portal URLs', () => {
    expect(googleConfig({ ...FULL, SITE_URL: 'https://preview.test/' })).toMatchObject({
      redirectUri: 'https://preview.test/api/google/callback',
      notifyUrl: 'https://preview.test/api/google/notify',
      portalUrl: 'https://preview.test/portal/',
    });
  });
});

describe('constants', () => {
  test('hold the agreed values', () => {
    expect(TIME_ZONE).toBe('America/Los_Angeles');
    expect(CALENDAR_NAME).toBe('VP Education sessions');
    expect(MAX_PERSONAL_DAYS).toBe(42);
    expect(CHANNEL_TTL_SECONDS).toBe(7 * 24 * 3600);
    expect(RENEW_WITHIN_MS).toBe(48 * 3600 * 1000);
  });

  test('students ask only for sign-in scopes, tutors also for calendar access', () => {
    expect(SCOPES.student).toEqual(['openid', 'email']);
    expect(SCOPES.tutor).toEqual(expect.arrayContaining([
      'openid', 'email',
      'https://www.googleapis.com/auth/calendar.app.created',
      'https://www.googleapis.com/auth/calendar.events.readonly',
    ]));
    expect(Object.isFrozen(SCOPES)).toBe(true);
  });
});
