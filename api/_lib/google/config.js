// Google Calendar settings from the environment. googleConfig() is null until
// the owner has set the Google variables (endpoints then answer 503).
export const TIME_ZONE = 'America/Los_Angeles';
export const CALENDAR_NAME = 'VP Education sessions';
export const MAX_PERSONAL_DAYS = 42;
export const CHANNEL_TTL_SECONDS = 7 * 24 * 3600;
export const RENEW_WITHIN_MS = 48 * 3600 * 1000;
export const SCOPES = Object.freeze({
  tutor: ['openid', 'email',
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.events.readonly'],
  student: ['openid', 'email'],
});

export function googleConfig(env = process.env) {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_TOKEN_KEY: tokenKey } = env;
  if (!clientId || !clientSecret || !tokenKey) return null;
  const siteUrl = String(env.SITE_URL || 'https://www.varunbaskaran.com').replace(/\/+$/, '');
  return {
    clientId, clientSecret, tokenKey, siteUrl,
    redirectUri: `${siteUrl}/api/google/callback`,
    notifyUrl: `${siteUrl}/api/google/notify`,
    portalUrl: `${siteUrl}/portal/`,
  };
}
