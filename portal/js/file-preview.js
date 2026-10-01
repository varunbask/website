// The submitted file on the review page (spec 5.9).
//
// filePreview(sub, { signal, attempt }) -> HTMLElement
//   Signs the storage path for 10 minutes, fetches the file into a Blob and shows
//   it: photos as an <img> from an object URL (the CSP allows blob: images),
//   text in a Mono <pre> via textContent (first 200 KB), PDFs as a file card
//   that opens the signed URL in a new tab. Object URLs are revoked when
//   `signal` aborts (the view unmounts).
//
// A small cache keeps the last few files, so the refresh re-render after a
// save shows the file at once instead of loading it again.
//
// The signed URL is captured when the page renders, so every "Open" control
// checks its age when used and signs again once it is older than
// SIGN_REUSE_MS (a tutor may leave the page open for a long time).

import { h } from './dom.js';
import { icon } from './icons.js';
import { button, errorCallout } from './ui.js';
import { sb } from './supabase.js';
import { FILE_LABELS } from './labels.js';

const BUCKET = 'homework';
const SIGN_SECONDS = 600;
const SIGN_REUSE_MS = 8 * 60 * 1000;    // re-sign before the 10 minutes run out
const TEXT_LIMIT = 204800;              // 200 KB
const CACHE_SIZE = 4;

// storage_path -> { signedUrl, signedAt, blob }
const cache = new Map();

function remember(path, entry) {
  cache.delete(path);
  cache.set(path, entry);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
}

function cached(path) {
  const entry = cache.get(path);
  if (!entry) return null;
  if (Date.now() - entry.signedAt > SIGN_REUSE_MS) {
    cache.delete(path);
    return null;
  }
  return entry;
}

function kindOf(type) {
  if (type === 'application/pdf') return 'pdf';
  if (type === 'image/png' || type === 'image/jpeg') return 'image';
  if (type === 'text/plain') return 'text';
  return 'other';
}

const KIND_ICON = { pdf: 'file-pdf', image: 'image-square', text: 'file-text', other: 'file-text' };

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

async function sign(path) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, SIGN_SECONDS);
  if (error || !data?.signedUrl) throw error ?? new Error('No signed URL');
  return data.signedUrl;
}

export function filePreview(sub, { signal, attempt } = {}) {
  const kind = kindOf(sub?.file_type);
  const typeLabel = FILE_LABELS[sub?.file_type] ?? 'File';
  const attemptText = attempt ? `attempt ${attempt}` : null;
  const urls = [];

  signal?.addEventListener('abort', () => {
    for (const u of urls.splice(0)) URL.revokeObjectURL(u);
  }, { once: true });

  const openLink = h('a', {
    class: 'btn btn-ghost btn-sm rvw-file-open',
    target: '_blank',
    rel: 'noopener noreferrer',
    hidden: true,
  }, icon('arrow-square-out'), h('span', { class: 'btn-label' }, 'Open in new tab'));

  const bar = h('div', { class: 'rvw-file-bar' },
    h('span', { class: 'rvw-file-kind' }, icon(KIND_ICON[kind]),
      h('span', {}, typeLabel),
      attemptText ? h('span', { class: 'rvw-file-attempt' }, attemptText) : null),
    h('span', { class: 'rvw-file-size num' }),
    openLink);
  const sizeEl = bar.querySelector('.rvw-file-size');
  const stage = h('div', { class: 'rvw-file-stage' });
  const root = h('section', { class: 'rvw-file', 'aria-label': 'Submitted file' }, bar, stage);

  const alive = () => !signal?.aborted;
  const path = sub?.storage_path;

  // The current signed URL and when it was made; every link that opens the
  // file carries data-signed-link so a re-sign can update them all
  let signed = null;   // { url, at }

  function setSigned(url, at) {
    signed = { url, at };
    openLink.href = url;
    // A PDF's card already has the open button
    openLink.hidden = kind === 'pdf';
    for (const a of root.querySelectorAll('a[data-signed-link]')) a.href = url;
  }

  const stale = () => !signed || Date.now() - signed.at > SIGN_REUSE_MS;

  async function freshUrl() {
    if (!stale()) return signed.url;
    const url = await sign(path);
    const at = Date.now();
    const entry = cache.get(path);
    if (entry) remember(path, { ...entry, signedUrl: url, signedAt: at });
    if (alive()) setSigned(url, at);
    return url;
  }

  async function openFresh() {
    try {
      window.open(await freshUrl(), '_blank', 'noopener');
    } catch (error) {
      console.error(error);
      // Only the PDF and other-file cards have nothing else to show; a shown
      // photo or text file stays in place
      if (alive() && (kind === 'pdf' || kind === 'other')) showFailure(null);
    }
  }

  // Middle-click and "Open in new tab" skip the click handler and use the href
  // as it is, so a stale link is signed again as soon as the pointer or focus
  // reaches it
  function prewarm(a) {
    const warm = () => { if (stale()) freshUrl().catch(() => {}); };
    a.addEventListener('pointerenter', warm);
    a.addEventListener('focus', warm);
  }

  // A plain link while its URL is fresh; signs again first when it is not
  function signedLink(attrs, ...children) {
    const a = h('a', { ...attrs, href: signed?.url ?? '', target: '_blank', rel: 'noopener noreferrer', dataset: { signedLink: '' } }, ...children);
    a.addEventListener('click', (event) => {
      if (!stale()) return;
      event.preventDefault();
      openFresh();
    });
    prewarm(a);
    return a;
  }
  openLink.dataset.signedLink = '';
  openLink.addEventListener('click', (event) => {
    if (!stale()) return;
    event.preventDefault();
    openFresh();
  });
  prewarm(openLink);

  function loading() {
    stage.setAttribute('aria-busy', 'true');
    stage.replaceChildren(h('div', { class: 'rvw-file-loading' },
      h('span', { class: 'skeleton rvw-file-skeleton' }),
      h('span', { class: 'visually-hidden' }, 'Loading the file…')));
  }

  function done(...nodes) {
    stage.removeAttribute('aria-busy');
    stage.replaceChildren(...nodes.filter(Boolean));
  }

  function fileCard({ title, text, actionLabel }) {
    return h('div', { class: 'rvw-file-card' },
      h('span', { class: 'rvw-file-card-icon' }, icon(KIND_ICON[kind], { size: 20 })),
      h('div', { class: 'rvw-file-card-body' },
        h('p', { class: 'rvw-file-card-title' }, title),
        text ? h('p', { class: 'rvw-file-card-text' }, text) : null),
      button({
        label: actionLabel,
        variant: 'secondary',
        icon: 'arrow-square-out',
        onClick: () => openFresh(),
      }));
  }

  function showImage(blob) {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const img = h('img', {
      class: 'rvw-img',
      src: url,
      alt: attempt ? `Submitted work, attempt ${attempt}` : 'Submitted work',
      decoding: 'async',
    });
    // The image's alt names the button; aria-pressed carries actual size
    const zoom = h('button', {
      type: 'button',
      class: 'rvw-zoom',
      'aria-pressed': 'false',
      title: 'Show at actual size',
    }, img);
    zoom.addEventListener('click', () => {
      const actual = zoom.getAttribute('aria-pressed') !== 'true';
      zoom.setAttribute('aria-pressed', String(actual));
      zoom.title = actual ? 'Fit to the panel' : 'Show at actual size';
      stage.classList.toggle('is-actual-size', actual);
    });
    done(zoom);
  }

  async function showText(blob) {
    const text = await blob.slice(0, TEXT_LIMIT).text();
    if (!alive()) return;
    const pre = h('pre', { class: 'rvw-text', tabindex: '0', role: 'region', 'aria-label': 'File contents' }, text);
    const more = blob.size > TEXT_LIMIT
      ? h('div', { class: 'rvw-file-more' },
        h('p', { class: 'note' }, icon('info'), h('span', {}, 'Showing the first part of this file.')),
        signedLink({ class: 'link' }, 'Open file'))
      : null;
    done(pre, more);
  }

  async function render(entry) {
    if (entry.blob && Number.isFinite(entry.blob.size)) sizeEl.textContent = formatSize(entry.blob.size);
    if (kind === 'pdf') {
      done(fileCard({
        title: attempt ? `PDF, attempt ${attempt}` : 'PDF',
        text: 'PDFs open in a new tab.',
        actionLabel: 'Open PDF',
      }));
    } else if (kind === 'image') {
      showImage(entry.blob);
    } else if (kind === 'text') {
      await showText(entry.blob);
    } else {
      done(fileCard({ title: typeLabel, text: 'This file can’t be shown here.', actionLabel: 'Open file' }));
    }
  }

  function showFailure(signedUrl) {
    const callout = errorCallout({
      title: 'We couldn’t load this file.',
      text: signedUrl ? 'Try again, or open it in a new tab.' : 'Try again.',
      onRetry: () => load(),
    });
    if (signedUrl) {
      callout.querySelector('.callout-actions')?.append(signedLink({ class: 'btn btn-ghost btn-sm' },
        icon('arrow-square-out'), h('span', { class: 'btn-label' }, 'Open in new tab')));
    }
    done(callout);
  }

  async function load() {
    const hit = path ? cached(path) : null;
    if (hit && (kind === 'pdf' || hit.blob)) {
      setSigned(hit.signedUrl, hit.signedAt);
      await render(hit);
      return;
    }
    loading();
    let signedUrl = null;
    try {
      if (!path) throw new Error('No file');
      signedUrl = await sign(path);
      const signedAt = Date.now();
      if (!alive()) throw abortError();
      setSigned(signedUrl, signedAt);
      let blob = null;
      if (kind !== 'pdf') {
        const res = await fetch(signedUrl, { signal });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        blob = await res.blob();
        if (!alive()) throw abortError();
      }
      const entry = { signedUrl, signedAt, blob };
      remember(path, entry);
      await render(entry);
    } catch (error) {
      if (!alive() || error?.name === 'AbortError') return;
      console.error(error);
      showFailure(signedUrl);
    }
  }

  load();
  return root;
}
