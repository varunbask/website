// SAT data: the content (sets, skills, guides, files and an index of the
// items), a student's access, attempts and responses, and the RPCs of the SAT
// migration. Kept apart from store.js on purpose: the runners save answers
// often, and a store change would redraw the page under a student taking a
// timed test. Content is read once per page load (the loader changes it
// rarely); progress is dropped after every answer and submit (dropProgress)
// and read again by the next page that needs it.
//
// Row level security decides what comes back: a student with access sees the
// items that are not held and the files that are not staff only, never the
// answer keys; staff see everything (views/sat*.js decide what to show).

import { sb } from './supabase.js';
import { setCounts } from './sat-model.js';

export const SAT_BUCKET = 'sat-files';
const SIGN_SECONDS = 600;
const RESIGN_AFTER_MS = 8 * 60_000;
const PAGE_ROWS = 1000;
const IN_CHUNK = 150;

const ITEM_FIELDS = 'id, set_id, module, position, domain, skill, difficulty, kind, passage, stem, choices, held';
const SET_FIELDS = 'id, kind, domain, skill, title, position, modules, origin';
const FILE_FIELDS = 'id, collection, domain, skill, difficulty, title, storage_path, bytes, pages, staff_only, position';
const ATTEMPT_FIELDS = 'id, student_id, set_id, module, sitting, mode, started_at, deadline_at, submitted_at, correct, total';
const RESPONSE_FIELDS = 'attempt_id, item_id, response, correct, flagged, answered_at';

// Pages through a select past the 1000-row cap with a stable order
async function selectAll(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await makeQuery().range(from, from + PAGE_ROWS - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_ROWS) return rows;
  }
}

async function call(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

// Keeps a promise until it fails
function remember(map, key, make) {
  if (map.has(key)) return map.get(key);
  const promise = make();
  map.set(key, promise);
  promise.catch(() => { if (map.get(key) === promise) map.delete(key); });
  return promise;
}

// The words of an RPC error ('time_up', 'already_taken', ...), or ''
export const errorCode = (error) => String(error?.message ?? '').trim();

// ---------------------------------------------------------------------------
// Content

let content = null;
const guides = new Map();
const items = new Map();

async function loadContent() {
  const [sets, skills, guideRows, files, index] = await Promise.all([
    selectAll(() => sb.from('sat_sets').select(SET_FIELDS).order('kind').order('position').order('id')),
    selectAll(() => sb.from('sat_skills').select('slug, domain, name, position').order('position').order('slug')),
    selectAll(() => sb.from('sat_guides').select('skill, domain, title, position').order('position').order('skill')),
    selectAll(() => sb.from('sat_files').select(FILE_FIELDS).order('position').order('id')),
    // Labels only: a test's questions are not readable until it is started
    call('sat_item_index', {}).then((rows) => rows ?? []),
  ]);
  return {
    sets,
    setsById: new Map(sets.map((s) => [s.id, s])),
    skills,
    skillsBySlug: new Map(skills.map((s) => [s.slug, s])),
    guides: guideRows,
    files,
    index: new Map(index.map((it) => [it.id, it])),
    counts: setCounts(index),
  };
}

// { sets, setsById, skills, skillsBySlug, guides (without bodies), files,
//   index: Map item id -> light item, counts: Map set id -> counts }
export function getContent() {
  if (!content) {
    const promise = loadContent();
    content = promise;
    promise.catch(() => { if (content === promise) content = null; });
  }
  return content;
}

// One study guide with its body, or null
export function getGuide(skill) {
  return remember(guides, String(skill), async () => {
    const { data, error } = await sb.from('sat_guides').select('skill, domain, title, position, body').eq('skill', skill).maybeSingle();
    if (error) throw error;
    return data ?? null;
  });
}

// A module key as the content uses them ('rw1', 'm'); anything else is never
// put into a filter
export const MODULE_KEY = /^[a-z0-9]{1,8}$/;

// The items of a set (one module of it, or all): Map id -> item, in order.
// A test's items come back only once the caller has started that module.
export function getItems(setId, module = null) {
  if (module && !MODULE_KEY.test(String(module))) return Promise.reject(new Error('bad module'));
  return remember(items, `${setId}|${module ?? ''}`, async () => {
    const rows = await selectAll(() => {
      let q = sb.from('sat_items').select(ITEM_FIELDS).eq('set_id', setId);
      if (module) q = q.or(`module.eq.${module},module.is.null`);
      return q.order('position').order('id');
    });
    return new Map(rows.map((it) => [it.id, it]));
  });
}

// Staff: the answer keys of some items (Map id -> { answer, accept, explanation })
export async function getKeys(itemIds) {
  const out = new Map();
  const ids = [...new Set(itemIds ?? [])];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await sb.from('sat_keys').select('item_id, answer, accept, explanation').in('item_id', ids.slice(i, i + IN_CHUNK));
    if (error) throw error;
    for (const k of data ?? []) out.set(k.item_id, k);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Access

const access = new Map();

// The student's sat_access row, or null when SAT is off
export function getAccess(studentId) {
  return remember(access, String(studentId), async () => {
    const { data, error } = await sb.from('sat_access').select('student_id, granted_by, granted_at').eq('student_id', studentId).maybeSingle();
    if (error) throw error;
    return data ?? null;
  });
}

// Whether a student may use the SAT tab; false when it cannot be read (the
// migration not run yet, a connection error), so the tab simply stays hidden
export async function isAllowed(studentId) {
  if (!studentId) return false;
  try {
    return Boolean(await getAccess(studentId));
  } catch {
    return false;
  }
}

// The admin turns SAT on or off for a student
export async function setAccess(studentId, on) {
  const result = on
    ? await sb.from('sat_access').insert({ student_id: studentId })
    : await sb.from('sat_access').delete().eq('student_id', studentId);
  if (result.error && !(on && result.error.code === '23505')) throw result.error;
  access.delete(String(studentId));
  return getAccess(studentId);
}

// ---------------------------------------------------------------------------
// Progress: attempts and responses of one student

const attempts = new Map();
const responses = new Map();

// A student's attempts, newest first. Modules left open past their time are
// submitted first (sat_settle), so an abandoned test reads as taken.
export function getAttempts(studentId) {
  return remember(attempts, String(studentId), async () => {
    await call('sat_settle', { p_student: studentId }).catch(() => 0);
    return selectAll(() => sb.from('sat_attempts').select(ATTEMPT_FIELDS)
      .eq('student_id', studentId)
      .order('started_at', { ascending: false })
      .order('id', { ascending: false }));
  });
}

// Every response of the student's attempts
export function getResponses(studentId) {
  return remember(responses, String(studentId), async () => {
    const ids = (await getAttempts(studentId)).map((a) => a.id);
    const out = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK);
      out.push(...await selectAll(() => sb.from('sat_responses').select(RESPONSE_FIELDS)
        .in('attempt_id', chunk).order('attempt_id').order('item_id')));
    }
    return out;
  });
}

// After an answer or a submit: the next page reads progress again
export function dropProgress(studentId) {
  if (studentId === null || studentId === undefined) {
    attempts.clear();
    responses.clear();
    return;
  }
  attempts.delete(String(studentId));
  responses.delete(String(studentId));
}

// Everything (a "Try again" after an error)
export function resetSat() {
  content = null;
  guides.clear();
  items.clear();
  access.clear();
  dropProgress(null);
}

// ---------------------------------------------------------------------------
// RPCs (the caller is the signed-in person)

// Starting a module makes its questions readable: forget any empty read of them
export async function start(setId, module = null, sitting = null) {
  const started = await call('sat_start', { p_set: setId, p_module: module, p_sitting: sitting });
  items.delete(`${setId}|${started?.module ?? ''}`);
  items.delete(`${setId}|`);
  return started;
}
export const answer = (attemptId, itemId, response, flagged = null) => call('sat_answer', {
  p_attempt: attemptId, p_item: itemId, p_response: response, p_flagged: flagged,
});
export const submit = (attemptId) => call('sat_submit', { p_attempt: attemptId });
export const review = (attemptId) => call('sat_review', { p_attempt: attemptId });
export const releaseItem = (itemId, answerText = null) => call('sat_release_item', { p_item: itemId, p_answer: answerText });
export const heldItems = async () => (await call('sat_held_items', {})) ?? [];

// ---------------------------------------------------------------------------
// Files

const signed = new Map();   // path -> { url, at } | Promise

// A short-lived link to a figure (or any file) in the sat-files bucket,
// signed again after 8 minutes
export async function fileUrl(path) {
  const hit = signed.get(path);
  if (hit && !(hit instanceof Promise) && Date.now() - hit.at < RESIGN_AFTER_MS) return hit.url;
  if (hit instanceof Promise) return hit;
  const promise = sb.storage.from(SAT_BUCKET).createSignedUrl(path, SIGN_SECONDS).then(({ data, error }) => {
    if (error) throw error;
    signed.set(path, { url: data.signedUrl, at: Date.now() });
    return data.signedUrl;
  });
  signed.set(path, promise);
  promise.catch(() => { if (signed.get(path) === promise) signed.delete(path); });
  return promise;
}

// A file row in the shape materials-ui.js wireFileOpen expects
export const openable = (file) => ({ id: file.id, title: file.title, storage_path: file.storage_path, file_type: 'application/pdf' });

// After the admin releases a question: the item index and counts load again
export function dropContent() {
  content = null;
  items.clear();
}

// The caller's own answers on one attempt (a timed module picked up again)
export async function attemptResponses(attemptId) {
  const { data, error } = await sb.from('sat_responses').select(RESPONSE_FIELDS).eq('attempt_id', attemptId);
  if (error) throw error;
  return data ?? [];
}
