// What a PDF says about itself without being drawn: how many pages it has and
// whether it is password-protected. Used by the draft panel (the page count
// on a file's chip, and the 100-page limit before upload) and by the server
// (api/_lib/source-files.js), which checks again. No DOM.
//
// The page count is the /Count of the page tree's root (the largest /Count
// of any /Type /Pages dictionary), else the number of /Type /Page
// dictionaries. Newer PDFs keep these dictionaries in compressed object
// streams, so those streams are inflated with the inflate() the caller passes
// (zlib on the server, DecompressionStream in the browser), up to a limit.

const MAX_INFLATED = 32 * 1024 * 1024;     // all object streams of one PDF together
const MAX_OBJECT_STREAMS = 400;

const latin1 = (bytes) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return out;
};

export const isPdf = (bytes) => bytes?.length >= 5 && latin1(bytes.subarray(0, Math.min(1024, bytes.length))).includes('%PDF-');

// The innermost dictionaries (no << >> inside them) that are page-tree nodes
function countsIn(text) {
  let pagesCount = 0;
  let pageDicts = 0;
  const inner = /<<((?:(?!<<|>>)[\s\S]){0,4000})>>/g;
  let m;
  while ((m = inner.exec(text))) {
    const body = m[1];
    if (/\/Type\s*\/Pages(?![A-Za-z])/.test(body)) {
      const c = /\/Count\s+(\d{1,6})(?!\d)/.exec(body);
      if (c) pagesCount = Math.max(pagesCount, Number(c[1]));
    }
  }
  pageDicts = (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  return { pagesCount, pageDicts };
}

// The raw bytes of every object stream (/Type /ObjStm) with /FlateDecode
function objectStreams(text, bytes) {
  const out = [];
  const head = /\/Type\s*\/ObjStm(?![A-Za-z])/g;
  let m;
  while ((m = head.exec(text)) && out.length < MAX_OBJECT_STREAMS) {
    const dictEnd = text.indexOf('stream', m.index);
    if (dictEnd < 0) break;
    const dict = text.slice(Math.max(0, text.lastIndexOf('obj', m.index)), dictEnd);
    if (!/\/FlateDecode/.test(dict) || /\/DecodeParms/.test(dict)) continue;
    let start = dictEnd + 'stream'.length;
    if (text[start] === '\r') start += 1;
    if (text[start] === '\n') start += 1;
    const end = text.indexOf('endstream', start);
    if (end < 0) break;
    // The data is /Length bytes long when the length is written out; else up
    // to endstream less the line end before it
    const length = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dict);
    let stop = end;
    if (length && start + Number(length[1]) <= end) stop = start + Number(length[1]);
    else {
      if (text[stop - 1] === '\n') stop -= 1;
      if (text[stop - 1] === '\r') stop -= 1;
    }
    out.push(bytes.subarray(start, stop));
    head.lastIndex = end;
  }
  return out;
}

/**
 * -> { pages: number | null, encrypted: boolean }
 * inflate(Uint8Array, maxBytes) -> Uint8Array (or a promise of one); it may
 * throw for a stream it cannot read, which is then skipped.
 */
export async function pdfFacts(bytes, { inflate = null } = {}) {
  const text = latin1(bytes);
  const encrypted = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(text);
  let { pagesCount, pageDicts } = countsIn(text);
  if (inflate && /\/Type\s*\/ObjStm/.test(text)) {
    let budget = MAX_INFLATED;
    for (const raw of objectStreams(text, bytes)) {
      if (budget <= 0) break;
      let plain;
      try {
        plain = await inflate(raw, budget);
      } catch {
        continue;
      }
      if (!plain?.length) continue;
      budget -= plain.length;
      const found = countsIn(latin1(plain));
      pagesCount = Math.max(pagesCount, found.pagesCount);
      pageDicts += found.pageDicts;
    }
  }
  const pages = pagesCount || pageDicts || null;
  return { pages, encrypted };
}
