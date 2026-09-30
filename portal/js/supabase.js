import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// supabase-js is loaded as a pinned UMD script (window.supabase) before this module runs.
// The implicit flow lets an email link opened on another device still sign the person in.
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});
