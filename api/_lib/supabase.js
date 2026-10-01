import { createClient } from '@supabase/supabase-js';

// Service-role client: bypasses RLS, so callers must scope every query themselves
export function adminClient(env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// The signed-in user behind a request's bearer token, or null
export async function verifyBearer(request, db) {
  const match = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  const { data, error } = await db.auth.getUser(match[1]);
  if (error || !data?.user) return null;
  return { id: data.user.id };
}
