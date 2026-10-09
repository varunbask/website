#!/usr/bin/env node
// Uploads an SAT bundle (convert.mjs output) to Supabase with the service role.
//
//   node tools/sat/load.mjs --env-file <path> --dir OUT [--holds OUT/holds.json]
//        [--dry-run] [--prune] [--rehold]
//
// --dry-run    print what would be written and uploaded; reads no env file and
//              makes no network call
// --prune      also remove content rows the bundle no longer has. Attempts and
//              responses are never deleted: a question someone answered is
//              held instead, and a set someone attempted is kept.
// --rehold     hold again questions the admin released, and overwrite answers
//              the admin set (normally both are left as the admin left them)
//
// Reads only SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the env file and
// never prints them. Tables: sat_skills, sat_sets, sat_items, sat_keys,
// sat_files, sat_guides (upserts in batches of 200). Storage: every PDF and
// figure goes to the private bucket sat-files (upsert), skipping files that
// are unchanged since the last load (OUT/.loaded.json).

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parseEnvFile, chunks, planItems, skillRows, setRows, fileRows, guideRows, uploads, stale, BATCH } from './lib/load-plan.mjs';

const BUCKET = 'sat-files';
const PAGE = 1000;

const args = { flags: new Set() };
for (let k = 2; k < process.argv.length; k++) {
  const a = process.argv[k];
  if (a === '--dry-run' || a === '--prune' || a === '--rehold') args.flags.add(a.slice(2));
  else if (a.startsWith('--')) args[a.slice(2)] = process.argv[++k];
}
const dryRun = args.flags.has('dry-run');
if (!args.dir || (!dryRun && !args['env-file'])) {
  console.error('Usage: node tools/sat/load.mjs --env-file <path> --dir OUT [--holds OUT/holds.json] [--dry-run] [--prune] [--rehold]');
  process.exit(2);
}
const OUT = resolve(args.dir);
const content = JSON.parse(readFileSync(join(OUT, 'content.json'), 'utf8'));
const holds = args.holds ? JSON.parse(readFileSync(resolve(args.holds), 'utf8')) : null;
const STATE = join(OUT, '.loaded.json');
const last = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null;
const log = (msg) => console.log(msg);

const fileHash = (path) => createHash('sha1').update(readFileSync(path)).digest('hex');
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

function summary(plan, objects, toUpload) {
  const held = plan.itemRows.filter((r) => r.held).length;
  const noted = plan.itemRows.filter((r) => r.review_note).length;
  const kinds = {};
  for (const s of content.sets) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
  const files = {};
  for (const f of content.files) files[f.collection] = (files[f.collection] ?? 0) + 1;
  log(`sat_skills  ${content.skills.length}`);
  log(`sat_sets    ${content.sets.length} (${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  log(`sat_items   ${plan.itemRows.length} (held ${held}, with a review note ${noted}${plan.released.length ? `, kept released ${plan.released.length}` : ''})`);
  log(`sat_keys    ${plan.keyRows.length}${plan.keptAnswers.length ? ` (answers the admin set kept: ${plan.keptAnswers.length})` : ''}`);
  log(`sat_files   ${content.files.length} (${Object.entries(files).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  log(`sat_guides  ${(content.guides ?? []).length}`);
  const bytes = objects.reduce((n, o) => n + o.bytes, 0);
  const upBytes = toUpload.reduce((n, o) => n + o.bytes, 0);
  log(`storage     ${objects.length} objects, ${mb(bytes)} in ${BUCKET}; ${toUpload.length} to upload (${mb(upBytes)})`);
  const missing = objects.filter((o) => o.missing);
  if (missing.length) log(`missing     ${missing.length} local files: ${missing.slice(0, 5).map((o) => o.local).join(', ')}`);
  log(`batches     ${Math.ceil(plan.itemRows.length / BATCH)} item batches of up to ${BATCH}`);
}

// Every object with its size, and whether it changed since the last load
const objects = uploads(content, OUT, join).map((o) => {
  if (!existsSync(o.local)) return { ...o, bytes: 0, missing: true };
  return { ...o, bytes: statSync(o.local).size };
});
const changed = (o) => !o.missing && (!last?.uploaded?.[o.path] || last.uploaded[o.path] !== `${o.bytes}:${fileHash(o.local)}`);

if (dryRun) {
  const plan = planItems({ items: content.items, keys: content.keys, holds, existing: new Map(), last });
  log(`Dry run: nothing is read from an env file and nothing is sent.${last ? ` (last load: ${last.loaded_at})` : ' (no earlier load recorded)'}`);
  summary(plan, objects, objects.filter(changed));
  if (args.flags.has('prune')) log('prune       would compare the database with the bundle (needs the network; not done in a dry run)');
  process.exit(0);
}

// ---------- live load ----------
const { createClient } = await import('@supabase/supabase-js');
const env = parseEnvFile(readFileSync(resolve(args['env-file']), 'utf8'));
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('The env file needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

async function selectAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select(columns).order(columns.split(',')[0].trim()).range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE) return out;
  }
}

async function upsert(table, rows, onConflict) {
  let n = 0;
  for (const batch of chunks(rows)) {
    const { error } = await admin.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`Writing ${table} failed after ${n} rows: ${error.message}`);
    n += batch.length;
  }
  log(`  ${table}: ${n}`);
}

async function removeRows(table, column, ids) {
  for (const batch of chunks(ids)) {
    const { error } = await admin.from(table).delete().in(column, batch);
    if (error) throw new Error(`Removing from ${table} failed: ${error.message}`);
  }
}

async function main() {
  // what the admin may have changed since the last load
  const existing = new Map();
  for (const r of await selectAll('sat_items', 'id, held')) existing.set(r.id, { held: r.held });
  for (const k of await selectAll('sat_keys', 'item_id, answer, accept')) {
    const e = existing.get(k.item_id);
    if (e) Object.assign(e, { answer: k.answer, accept: k.accept });
  }
  const plan = planItems({ items: content.items, keys: content.keys, holds, existing, last, rehold: args.flags.has('rehold') });
  const toUpload = objects.filter(changed);
  summary(plan, objects, toUpload);
  if (plan.released.length) log(`kept released (pass --rehold to hold them again): ${plan.released.join(', ')}`);
  if (plan.keptAnswers.length) log(`kept the admin's answer: ${plan.keptAnswers.join(', ')}`);

  log('writing rows');
  await upsert('sat_skills', skillRows(content), 'slug');
  await upsert('sat_sets', setRows(content), 'id');
  await upsert('sat_items', plan.itemRows, 'id');
  await upsert('sat_keys', plan.keyRows, 'item_id');
  await upsert('sat_guides', guideRows(content), 'skill');

  log(`uploading ${toUpload.length} objects`);
  const uploaded = { ...(last?.uploaded ?? {}) };
  let done = 0;
  const queue = [...toUpload];
  const worker = async () => {
    while (queue.length) {
      const o = queue.shift();
      const body = readFileSync(o.local);
      const { error } = await admin.storage.from(BUCKET).upload(o.path, body, { upsert: true, contentType: o.type });
      if (error) throw new Error(`Uploading ${o.path} failed: ${error.message}`);
      uploaded[o.path] = `${o.bytes}:${createHash('sha1').update(body).digest('hex')}`;
      done++;
      if (done % 100 === 0) log(`  ${done} of ${toUpload.length}`);
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  await upsert('sat_files', fileRows(content), 'id');

  if (args.flags.has('prune')) await prune();

  writeFileSync(STATE, JSON.stringify({ loaded_at: new Date().toISOString(), ...plan.state, uploaded }, null, 1));
  log('done');
}

async function prune() {
  log('pruning');
  const itemIds = content.items.map((i) => i.id);
  const oldItems = stale((await selectAll('sat_items', 'id')).map((r) => r.id), itemIds);
  const answered = new Set();
  for (const batch of chunks(oldItems)) {
    const { data, error } = await admin.from('sat_responses').select('item_id').in('item_id', batch);
    if (error) throw new Error(`Reading sat_responses failed: ${error.message}`);
    for (const r of data) answered.add(r.item_id);
  }
  const keepHeld = oldItems.filter((id) => answered.has(id));
  for (const batch of chunks(keepHeld)) {
    const { error } = await admin.from('sat_items').update({ held: true, hold_reason: 'No longer in the content bundle' }).in('id', batch);
    if (error) throw new Error(`Holding removed items failed: ${error.message}`);
  }
  await removeRows('sat_items', 'id', oldItems.filter((id) => !answered.has(id)));
  log(`  sat_items: ${oldItems.length - keepHeld.length} removed, ${keepHeld.length} held (they have answers)`);

  const oldSets = stale((await selectAll('sat_sets', 'id')).map((r) => r.id), content.sets.map((s) => s.id));
  const attempted = new Set();
  for (const batch of chunks(oldSets)) {
    const { data, error } = await admin.from('sat_attempts').select('set_id').in('set_id', batch);
    if (error) throw new Error(`Reading sat_attempts failed: ${error.message}`);
    for (const r of data) attempted.add(r.set_id);
  }
  // a set with attempts keeps its row (and its answered questions); others go
  const removable = [];
  for (const id of oldSets.filter((s) => !attempted.has(s))) {
    const { count, error } = await admin.from('sat_items').select('id', { count: 'exact', head: true }).eq('set_id', id);
    if (error) throw new Error(`Counting items failed: ${error.message}`);
    if (!count) removable.push(id);
  }
  await removeRows('sat_sets', 'id', removable);
  log(`  sat_sets: ${removable.length} removed, ${oldSets.length - removable.length} kept (attempted or still holding answered questions)`);

  const oldSkills = stale((await selectAll('sat_skills', 'slug')).map((r) => r.slug), content.skills.map((s) => s.slug));
  await removeRows('sat_skills', 'slug', oldSkills);
  const oldGuides = stale((await selectAll('sat_guides', 'skill')).map((r) => r.skill), (content.guides ?? []).map((g) => g.skill));
  await removeRows('sat_guides', 'skill', oldGuides);

  const files = await selectAll('sat_files', 'id, storage_path');
  const keepPaths = new Set(objects.map((o) => o.path));
  const oldFiles = files.filter((f) => !content.files.some((c) => c.id === f.id));
  await removeRows('sat_files', 'id', oldFiles.map((f) => f.id));
  const gone = oldFiles.map((f) => f.storage_path).filter((p) => !keepPaths.has(p));
  // figures nobody points at any more
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(BUCKET).list('figures', { limit: PAGE, offset });
    if (error) throw new Error(`Listing figures failed: ${error.message}`);
    for (const o of data) if (o.id && !keepPaths.has(`figures/${o.name}`)) gone.push(`figures/${o.name}`);
    if (data.length < PAGE) break;
  }
  for (const batch of chunks(gone, 100)) {
    const { error } = await admin.storage.from(BUCKET).remove(batch);
    if (error) throw new Error(`Removing objects failed: ${error.message}`);
  }
  log(`  removed: ${oldSkills.length} skills, ${oldGuides.length} guides, ${oldFiles.length} file rows, ${gone.length} objects`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
