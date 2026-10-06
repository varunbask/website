// node cdp.mjs <json steps file | inline json>
// Drives a private headless Chrome: [{ "go": url, "w": 1280, "h": 900, "wait": 1500, "js": "...", "shot": "out.png", "full": false, "media": "print", "dark": true }]
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const O = process.env.TMPDIR ?? '/tmp';
const arg = process.argv[2];
const steps = JSON.parse(existsSync(arg) ? readFileSync(arg, 'utf8') : arg);
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`,
  `--user-data-dir=${O}/chrome-profile-${port}`, '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i += 1) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* starting */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const waiting = new Map();
const logs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text));
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type.toUpperCase() + ' ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG ' + m.params.entry.text + ' ' + (m.params.entry.url ?? ''));
});
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
const out = [];
for (const s of steps) {
  if (s.w) await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h ?? 900, deviceScaleFactor: s.scale ?? 1, mobile: Boolean(s.mobile) });
  if (s.media !== undefined || s.dark !== undefined) await send('Emulation.setEmulatedMedia', { media: s.media ?? '', features: [{ name: 'prefers-color-scheme', value: s.dark ? 'dark' : 'light' }] });
  if (s.go) { await send('Page.navigate', { url: s.go }); await sleep(s.wait ?? 1500); }
  else if (s.wait) await sleep(s.wait);
  if (s.js) {
    const r = await send('Runtime.evaluate', { expression: s.js, awaitPromise: true, returnByValue: true });
    out.push(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? null);
    if (s.after) await sleep(s.after);
  }
  if (s.shot) {
    let clip;
    if (s.full) {
      const m = await send('Page.getLayoutMetrics');
      const { width, height } = m.result.cssContentSize;
      clip = { x: 0, y: 0, width, height: Math.min(height, 16000), scale: 1 };
    }
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: Boolean(s.full), ...(clip ? { clip } : {}) });
    writeFileSync(s.shot, Buffer.from(r.result.data, 'base64'));
    out.push('shot ' + s.shot);
  }
}
console.log(JSON.stringify({ out, logs }, null, 1));
ws.close(); chrome.kill('SIGKILL');
process.exit(0);
