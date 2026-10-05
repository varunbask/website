// Which files in the materials bucket no material row uses: files left behind
// by deleting an assignment, task or session before the portal removed them
// (2026-10-04). No network here; scripts/cleanup-material-files.js does the
// listing and removing.

// '<student uuid>/<uuid>.<ext>', the only names the portal ever uploads
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const MATERIAL_NAME = new RegExp(`^${UUID}/${UUID}\\.(pdf|pptx|ppt|docx|doc|png|jpg)$`);

// A file this new may be an upload whose row is still being added
export const MIN_AGE_MS = 60 * 60 * 1000;

// objects: [{ name, created_at, size }] in the bucket; used: the storage_path
// of every material row. -> { orphans, skipped: { young, unknown } }, where
// orphans are the files safe to remove: a portal name, older than an hour,
// and used by no row
export function findOrphans(objects, used, { now = Date.now(), minAgeMs = MIN_AGE_MS } = {}) {
  const inUse = new Set(used);
  const orphans = [];
  const skipped = { young: 0, unknown: 0 };
  for (const object of objects) {
    if (inUse.has(object.name)) continue;
    if (!MATERIAL_NAME.test(object.name)) {
      skipped.unknown += 1;
      continue;
    }
    const born = Date.parse(object.created_at ?? '');
    if (!Number.isFinite(born) || now - born < minAgeMs) {
      skipped.young += 1;
      continue;
    }
    orphans.push(object);
  }
  return { orphans, skipped };
}

// "3.4 MB"
export function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function chunks(list, size = 100) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
