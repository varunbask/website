// Pure helpers shared by the portal pages. No DOM access, so they run in unit tests.

const DATE = { month: 'short', day: 'numeric', year: 'numeric' };

export function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-US', DATE) : '';
}

export function formatDateTime(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { ...DATE, hour: 'numeric', minute: '2-digit' }) : '';
}

// <input type="date"> value (a local day) -> ISO timestamp at 11:59 pm that day, local time
export function dueDateToIso(value) {
  return value ? new Date(`${value}T23:59:00`).toISOString() : null;
}

// ISO timestamp -> <input type="date"> value, in local time
export function isoToDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function firstName(fullName) {
  return (fullName ?? '').trim().split(/\s+/)[0] || 'there';
}

export function displayName(profile) {
  return profile?.full_name?.trim() || profile?.email || 'Unknown';
}

// PostgREST returns a to-one embed as an object (or null); tolerate an array too
export function one(embedded) {
  return Array.isArray(embedded) ? (embedded[0] ?? null) : (embedded ?? null);
}

export function isOverdue(task, now = new Date()) {
  return Boolean(task.due_at && !task.completed_at && Date.parse(task.due_at) < now.getTime());
}

// By due date, undated items last, then by creation time
export function byDue(a, b) {
  const da = a.due_at ? Date.parse(a.due_at) : Infinity;
  const db = b.due_at ? Date.parse(b.due_at) : Infinity;
  return (da - db) || (Date.parse(a.created_at ?? 0) - Date.parse(b.created_at ?? 0));
}
