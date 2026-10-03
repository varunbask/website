// Pure helpers shared by the portal pages. No DOM access, so they run in unit tests.

import { zonedIso, dayKey } from './dates.js';

const DATE = { month: 'short', day: 'numeric', year: 'numeric' };

export function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString('en-US', DATE) : '';
}

export function formatDateTime(iso) {
  return iso ? new Date(iso).toLocaleString('en-US', { ...DATE, hour: 'numeric', minute: '2-digit' }) : '';
}

// <input type="date"> value -> ISO timestamp at 11:59 pm Pacific that day
export function dueDateToIso(value) {
  return value ? zonedIso(value, '23:59') : null;
}

// ISO timestamp -> <input type="date"> value, the Pacific day
export function isoToDateInput(iso) {
  return iso ? dayKey(iso) : '';
}

export function firstName(fullName) {
  return (fullName ?? '').trim().split(/\s+/)[0] || 'there';
}

// Who can have sessions of their own: a tutor, or an admin, who may also be
// linked to students as their tutor
export function canTeach(role) {
  return role === 'tutor' || role === 'admin';
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
