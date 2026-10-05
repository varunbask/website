// Removes files in the materials bucket that no material row uses: files left
// behind by deleting an assignment, task or session before 2026-10-04, when
// the portal started removing them itself.
//
//   npm run cleanup:material-files             lists what would be removed
//   npm run cleanup:material-files -- --delete removes it
//
// Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env (never printed).
// Only names the portal uploads ('<student>/<id>.<ext>') older than an hour
// are touched, and each batch is checked against the material rows again
// right before it is removed. Removing a file cannot be undone.

import { createClient } from '@supabase/supabase-js';
import { findOrphans, sizeText, chunks } from './material-orphans.js';

const BUCKET = 'materials';
const PAGE = 1000;

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  /* checked below */
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
  process.exit(1);
}
const doDelete = process.argv.includes('--delete');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const bucket = admin.storage.from(BUCKET);

// Every entry under a prefix, a page at a time
async function listAll(prefix) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`Listing ${prefix || 'the bucket'} failed: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return out;
  }
}

// The storage_path of every material row
async function usedPaths() {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('materials').select('storage_path')
      .not('storage_path', 'is', null).order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading materials failed: ${error.message}`);
    out.push(...data.map((r) => r.storage_path));
    if (data.length < PAGE) return out;
  }
}

// Files sit one level down, in a folder per student
const folders = (await listAll('')).filter((e) => !e.id).map((e) => e.name);
const objects = [];
for (const folder of folders) {
  for (const e of await listAll(folder)) {
    if (e.id) objects.push({ name: `${folder}/${e.name}`, created_at: e.created_at, size: e.metadata?.size ?? 0 });
  }
}
const used = await usedPaths();
// Files but not one row: the read went wrong, and every file would look unused
if (objects.length && !used.length) {
  console.error('Found files but no material rows, so nothing was checked. Stopping without removing anything.');
  process.exit(1);
}
const { orphans, skipped } = findOrphans(objects, used);
const total = orphans.reduce((n, o) => n + (Number(o.size) || 0), 0);

console.log(`Materials bucket: ${objects.length} file(s) in ${folders.length} student folder(s); ${used.length} in use.`);
if (skipped.young) console.log(`Skipped ${skipped.young} unused file(s) less than an hour old (they may still be uploading).`);
if (skipped.unknown) console.log(`Skipped ${skipped.unknown} unused file(s) with names the portal does not make.`);
if (!orphans.length) {
  console.log('No unused files to remove.');
  process.exit(0);
}
console.log(`${orphans.length} unused file(s), ${sizeText(total)}:`);
for (const o of orphans) console.log(`  ${o.name}  ${sizeText(o.size)}  ${o.created_at ?? ''}`);

if (!doDelete) {
  console.log('\nNothing was removed. Run again with --delete to remove these files.');
  process.exit(0);
}

let removed = 0;
let kept = 0;
let failed = 0;
for (const batch of chunks(orphans.map((o) => o.name))) {
  // Checked again just before removing: a row added since the listing keeps its file
  const { data, error } = await admin.from('materials').select('storage_path').in('storage_path', batch);
  if (error) {
    console.error(`Checking a batch failed, so it was left alone: ${error.message}`);
    failed += batch.length;
    continue;
  }
  const nowUsed = new Set(data.map((r) => r.storage_path));
  const go = batch.filter((name) => !nowUsed.has(name));
  kept += batch.length - go.length;
  if (!go.length) continue;
  const res = await bucket.remove(go);
  if (res.error) {
    console.error(`Removing a batch failed: ${res.error.message}`);
    failed += go.length;
  } else {
    removed += (res.data ?? []).length;
  }
}
console.log(`\nRemoved ${removed} file(s).${kept ? ` Kept ${kept} that came into use meanwhile.` : ''}`);
if (failed) {
  console.error(`${failed} file(s) could not be removed; run this again.`);
  process.exit(1);
}
