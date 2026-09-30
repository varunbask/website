// Data store (spec 4.4). One cache per scope: every list, badge, calendar and
// overview reads from here, so counts never disagree with lists.
//
// Every getter returns a cached promise. A failed load is dropped from the cache
// so the next call tries again. invalidate() clears a student's data (and the
// staff workspace, which summarizes every student), then emits one `change`;
// the app listens and refreshes the nav counts and the current view.

import { sb } from './supabase.js';
import { one, displayName } from './format.js';
import { deriveItems } from './buckets.js';
import { loadUpdates } from './updates-feed.js';

const students = new Map();   // studentId -> Promise<StudentData>
const updates = new Map();    // studentId -> Promise<Update[]>
const children = new Map();   // parentId -> Promise<Profile[]>
let workspace = null;         // Promise<Workspace> | null
let pending = null;           // Promise<number> | null

const listeners = new Set();
let queued = null;            // ids changed since the last emit ('*' for everything)

// Keeps a promise in a map until it fails
function remember(map, key, make) {
  if (map.has(key)) return map.get(key);
  const promise = make();
  map.set(key, promise);
  promise.catch(() => { if (map.get(key) === promise) map.delete(key); });
  return promise;
}

const byName = (a, b) => displayName(a).localeCompare(displayName(b));

// A submission row with its to-one grade embed as an object or null
function normalizeSub(sub) {
  return { ...sub, grade: one(sub.grade) };
}

// ---------------------------------------------------------------------------
// Student data

async function loadStudentData(studentId) {
  const [tasks, subs] = await Promise.all([
    sb.from('tasks')
      .select('id, student_id, kind, title, details, due_at, completed_at, created_at, created_by')
      .eq('student_id', studentId),
    sb.from('submissions')
      .select('id, task_id, student_id, file_type, note, status, error, attempts, status_changed_at, created_at, grade:grades(score, feedback, reviewed_by, reviewed_at, released_at)')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false }),
  ]);
  if (tasks.error) throw tasks.error;
  if (subs.error) throw subs.error;
  const submissions = (subs.data ?? []).map(normalizeSub);
  const subsByTask = new Map();
  for (const sub of submissions) {
    if (!subsByTask.has(sub.task_id)) subsByTask.set(sub.task_id, []);
    subsByTask.get(sub.task_id).push(sub);   // already newest first
  }
  return { studentId, loadedAt: Date.now(), tasks: tasks.data ?? [], submissions, subsByTask };
}

// { studentId, loadedAt, tasks, submissions, subsByTask }. RLS returns a null
// grade to students and parents for unreleased work, so one derivation serves
// every role.
export function getStudentData(studentId) {
  return remember(students, String(studentId), () => loadStudentData(studentId));
}

// Items for a student's data (buckets.deriveItems). Only the student may submit.
export function itemsFor(data, { now = new Date(), audience = 'family', viewerId = null } = {}) {
  const canSubmit = Boolean(viewerId) && String(viewerId) === String(data?.studentId);
  return deriveItems(data?.tasks ?? [], data?.submissions ?? [], now, { audience, canSubmit });
}

// ---------------------------------------------------------------------------
// Updates

export function getUpdates(studentId) {
  return remember(updates, String(studentId), () => loadUpdates(studentId));
}

// ---------------------------------------------------------------------------
// Staff workspace: every student the viewer can see, with their tasks and work

async function loadWorkspace() {
  const [people, tasks, subs] = await Promise.all([
    sb.from('profiles').select('id, full_name, email').eq('role', 'student'),
    sb.from('tasks').select('id, student_id, kind, title, due_at, completed_at, created_at'),
    sb.from('submissions')
      .select('id, task_id, student_id, file_type, status, error, attempts, status_changed_at, created_at, grade:grades(score, reviewed_at, released_at)')
      .order('created_at', { ascending: false }),
  ]);
  for (const result of [people, tasks, subs]) if (result.error) throw result.error;
  return {
    loadedAt: Date.now(),
    students: [...(people.data ?? [])].sort(byName),
    tasks: tasks.data ?? [],
    submissions: (subs.data ?? []).map(normalizeSub),
  };
}

// { loadedAt, students, tasks, submissions } (staff only)
export function getWorkspace() {
  if (!workspace) {
    const promise = loadWorkspace();
    workspace = promise;
    promise.catch(() => { if (workspace === promise) workspace = null; });
  }
  return workspace;
}

// ---------------------------------------------------------------------------
// Parents and admins

async function loadChildren(parentId) {
  const links = await sb.from('parent_students').select('student_id').eq('parent_id', parentId);
  if (links.error) throw links.error;
  const ids = (links.data ?? []).map((l) => l.student_id);
  if (!ids.length) return [];
  const kids = await sb.from('profiles').select('id, full_name, email').in('id', ids);
  if (kids.error) throw kids.error;
  return [...(kids.data ?? [])].sort(byName);
}

// The parent's linked children, sorted by name
export function getChildren(parentId) {
  return remember(children, String(parentId), () => loadChildren(parentId));
}

async function loadPendingCount() {
  const { count, error } = await sb.from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'pending');
  if (error) throw error;
  return count ?? 0;
}

// How many sign-ups wait for approval (admin)
export function getPendingCount() {
  if (!pending) {
    const promise = loadPendingCount();
    pending = promise;
    promise.catch(() => { if (pending === promise) pending = null; });
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Invalidation and change events

// Several invalidations in one task emit a single change
function emit(ids) {
  if (!queued) {
    queued = new Set();
    queueMicrotask(() => {
      const detail = { ids: [...queued] };
      queued = null;
      for (const fn of [...listeners]) {
        try {
          fn(detail);
        } catch (error) {
          console.error(error);
        }
      }
    });
  }
  for (const id of ids) queued.add(id);
}

// Clears one student's data and updates, and the workspace, then emits change
export function invalidate(studentId) {
  if (studentId !== null && studentId !== undefined) {
    students.delete(String(studentId));
    updates.delete(String(studentId));
  }
  workspace = null;
  emit([studentId === null || studentId === undefined ? '*' : String(studentId)]);
}

// Clears everything (people changes, "Try again" on a page-level error)
export function invalidateAll() {
  students.clear();
  updates.clear();
  children.clear();
  workspace = null;
  pending = null;
  emit(['*']);
}

// fn({ ids }) after every invalidation; returns an unsubscribe function
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// When the cached data for a student (or the workspace) was loaded, or null
export async function loadedAt(studentId) {
  const promise = studentId ? students.get(String(studentId)) : workspace;
  if (!promise) return null;
  try {
    return (await promise).loadedAt;
  } catch {
    return null;
  }
}
