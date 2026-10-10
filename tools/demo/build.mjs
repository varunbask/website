// npm run demo: copies the site into .demo/ with the portal wired to the
// in-memory demo client (tools/demo/demo-supabase.js), then serves it.
// Nothing in .demo/ talks to Supabase or the real APIs; it is for looking.
//
//   node tools/demo/build.mjs [outDir] [--src <checkout>]   (default: this checkout into .demo/)
//
//   --sat-content <dir>   show the real converted SAT content (a content bundle
//                         from the SAT converter: content.json, figures/,
//                         lessons/) instead of the made-up sample. It is copied
//                         into <outDir>/sat-local/, so outDir must be outside
//                         every checkout: the real content never goes in git.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = process.argv.slice(2);
let srcArg = null;
let outArg = null;
let satArg = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--src') { srcArg = args[i + 1]; i += 1; } else if (args[i] === '--sat-content') { satArg = args[i + 1]; i += 1; } else if (!outArg) outArg = args[i];
}
if (args.includes('--src') && !srcArg) throw new Error('--src needs a checkout path');
if (args.includes('--sat-content') && !satArg) throw new Error('--sat-content needs the folder of a SAT content bundle');
const root = srcArg ? resolve(srcArg) : here;
const out = resolve(root, outArg ?? '.demo');

// The real SAT content may only be copied outside every checkout
const within = (dir, parent) => {
  const rel = relative(parent, dir);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const satDir = satArg ? resolve(satArg) : null;
if (satDir) {
  if (!existsSync(join(satDir, 'content.json'))) throw new Error(`No content.json in ${satDir}`);
  if (within(out, root) || within(out, here)) {
    throw new Error(`--sat-content needs an output folder outside the repo (got ${out}): the real SAT content must never sit in a checkout.`);
  }
}
const SUPABASE = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+"[^>]*><\/script>/;
const SKIP = new Set(['.git', '.demo', '.worktrees', '.vercel', '.claude', '.agents', 'node_modules', 'supabase', 'tests', 'docs', 'api', 'scripts']);

// Only ever replace an earlier demo build (or an empty or missing folder), so a
// wrong argument can never delete a checkout or anything else
const MARK = '.demo-build';
const looksBuilt = (dir) => existsSync(join(dir, MARK)) || existsSync(join(dir, 'tools/demo/demo-supabase.js'));
if (existsSync(out) && readdirSync(out).length && !looksBuilt(out)) {
  throw new Error(`Refusing to replace ${out}: it is not an earlier demo build. Pick an empty or new folder.`);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, MARK), 'Built by tools/demo/build.mjs; safe to delete.\n');
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (SKIP.has(entry.name) || entry.name.startsWith('.env')) continue;
  cpSync(join(root, entry.name), join(out, entry.name), { recursive: true });
}
// the demo client and its sample files always come from this checkout; the
// checkout being built may add tools/demo/extend-*.js for its own features
mkdirSync(join(out, 'tools/demo'), { recursive: true });
for (const f of ['demo-supabase.js', 'demo-work.svg', 'demo-slides.svg']) cpSync(join(here, 'tools/demo', f), join(out, 'tools/demo', f));
const extensions = [...new Set([here, root].flatMap((dir) => (existsSync(join(dir, 'tools/demo'))
  ? readdirSync(join(dir, 'tools/demo')).filter((f) => /^extend-[\w-]+\.js$/.test(f)).map((f) => join(dir, 'tools/demo', f)) : [])))];
for (const file of extensions) cpSync(file, join(out, 'tools/demo', file.split('/').pop()));
// The real SAT content: content.json (and the converter's holds.json),
// figures/ and lessons/ go to sat-local/, and sat-local.js tells
// extend-sat.js where they are (it loads them in place of the sample)
let satTag = '';
if (satDir) {
  const local = join(out, 'sat-local');
  mkdirSync(local, { recursive: true });
  cpSync(join(satDir, 'content.json'), join(local, 'content.json'));
  const holds = existsSync(join(satDir, 'holds.json'));
  if (holds) cpSync(join(satDir, 'holds.json'), join(local, 'holds.json'));
  for (const sub of ['figures', 'lessons', 'keys/figures']) {
    if (existsSync(join(satDir, sub))) cpSync(join(satDir, sub), join(local, sub), { recursive: true });
  }
  const config = {
    content: '/sat-local/content.json', holds: holds ? '/sat-local/holds.json' : null,
    figures: '/sat-local/figures/', keyFigures: '/sat-local/keys/figures/', lessons: '/sat-local/lessons/',
  };
  writeFileSync(join(local, 'sat-local.js'), `window.portalDemoSatLocal = ${JSON.stringify(config)};\n`);
  satTag = '<script src="/sat-local/sat-local.js"></script>';
}
const extendTags = satTag + extensions.map((file) => `<script src="/tools/demo/${file.split('/').pop()}"></script>`).join('');
let rewired = 0;
for (const name of readdirSync(join(out, 'portal'))) {
  if (!name.endsWith('.html')) continue;
  const file = join(out, 'portal', name);
  const html = readFileSync(file, 'utf8');
  if (!SUPABASE.test(html)) continue;
  writeFileSync(file, html.replace(SUPABASE, `<script src="/tools/demo/demo-supabase.js"></script>${extendTags}`));
  rewired += 1;
}

if (!existsSync(join(out, 'tools/demo/demo-supabase.js'))) throw new Error('demo client missing');
console.log(`demo built in ${out} (${rewired} portal pages use the demo client${satDir ? `; real SAT content from ${satDir} in sat-local/` : ''})`);
