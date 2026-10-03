import { waitUntil } from '@vercel/functions';
import { adminClient, verifyBearer } from '../supabase.js';
import { createGoogleRepo } from './repo.js';
import { googleConfig } from './config.js';

export const NOT_SET_UP = 'Google Calendar is not set up yet.';

// Turns a handler from handlers.js into an entry point for api/google/*.js:
// 503 until the Google variables are set, then the handler gets its real
// dependencies. A failure nobody handled is a plain 500 and a name-only log.
export function googleEndpoint(handler) {
  return async function endpoint(request) {
    const config = googleConfig();
    if (!config) return Response.json({ error: NOT_SET_UP }, { status: 503 });
    try {
      const db = adminClient();
      return await handler(request, {
        repo: createGoogleRepo(db),
        verify: (req) => verifyBearer(req, db),
        config,
        waitUntil,
        fetchImpl: fetch,
        now: () => new Date(),
      });
    } catch (error) {
      console.error('[google] endpoint:', error?.name ?? 'Error');
      return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
    }
  };
}
