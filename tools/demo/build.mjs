// npm run demo: copies the site into .demo/ with the portal wired to the
// in-memory demo client (tools/demo/demo-supabase.js), then serves it.
// Nothing in .demo/ talks to Supabase or the real APIs; it is for looking.
//
//   node tools/demo/build.mjs [outDir] [--src <checkout>]   (default: this checkout into .demo/)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const args = process.argv.slice(2);
const srcAt = args.indexOf('--src');
const root = srcAt === -1 ? here : resolve(args[srcAt + 1]);
const outArg = args.filter((a, i) => a !== '--src' && i !== srcAt + 1)[0];
const out = resolve(root, outArg ?? '.demo');
const SUPABASE = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+"[^>]*><\/script>/;
const SKIP = new Set(['.git', '.demo', '.worktrees', '.vercel', '.claude', '.agents', 'node_modules', 'supabase', 'tests', 'docs', 'api', 'scripts']);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
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
const extendTags = extensions.map((file) => `<script src="/tools/demo/${file.split('/').pop()}"></script>`).join('');
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
console.log(`demo built in ${out} (${rewired} portal pages use the demo client)`);
