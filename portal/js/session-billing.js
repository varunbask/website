// One lesson's billing exception (session_billing; admin only by row security):
// what the family pays for it, and why. The Account page and the admin's
// session form share these.
import { sb } from './supabase.js';

// The row for a session ({ session_id, charge_pct, reason, ... }), or null
export async function readSessionBilling(sessionId) {
  const { data, error } = await sb.from('session_billing').select('session_id, charge_pct, reason').eq('session_id', sessionId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

// Updates the row, or adds it: only the fields given change, so a group key
// or an Accept on the same lesson stays. -> the supabase result
export async function writeSessionBilling(sessionId, fields) {
  const existing = await sb.from('session_billing').select('session_id').eq('session_id', sessionId).maybeSingle();
  if (existing.error) return existing;
  if (existing.data) return sb.from('session_billing').update(fields).eq('session_id', sessionId).select('session_id');
  return sb.from('session_billing').insert({ session_id: sessionId, ...fields }).select('session_id');
}
