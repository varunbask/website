// The Claude Messages API, shared by homework drafts and the grader.

export const ANTHROPIC_VERSION = '2023-06-01';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The Messages API URL from LLM_ENDPOINT: its origin + /v1/messages when the
 * host is api.anthropic.com, else null (a setup problem). Only the local
 * preview server (tools/demo/serve-ai.mjs) allows a loopback host, for its
 * mock.
 */
export function nativeEndpoint(endpoint, { allowLoopback = false } = {}) {
  let url;
  try {
    url = new URL(String(endpoint ?? ''));
  } catch {
    return null;
  }
  const ok = (url.protocol === 'https:' && url.hostname === 'api.anthropic.com')
    || (allowLoopback && url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  return ok ? `${url.origin}/v1/messages` : null;
}

// The text of the reply: the first text block (Claude thinks first, so it is
// not the first block), or null
export function replyText(data) {
  const block = Array.isArray(data?.content) ? data.content.find((b) => b?.type === 'text') : null;
  return typeof block?.text === 'string' ? block.text : null;
}
