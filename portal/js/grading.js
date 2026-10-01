import { sb } from './supabase.js';

// Asks the server to grade a submission. Resolves with null when grading started, or a message.
export async function startGrading(submissionId, { keepalive = false } = {}) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    const response = await fetch('/api/grade', {
      method: 'POST',
      keepalive,
      headers: { Authorization: `Bearer ${session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ submission_id: submissionId }),
    });
    if (response.status === 202) return null;
    const body = await response.json().catch(() => ({}));
    return body.error ?? `Grading could not start (status ${response.status}).`;
  } catch {
    return 'Grading could not start. Check your connection and try again.';
  }
}
