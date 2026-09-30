// Hash router (spec 4.1). The pure part (parse, build, compare, drawer depth)
// runs in unit tests; startRouter() at the bottom is the browser runtime.
//
// Grammar: #/<view>[/<sub>][/<id>][?key=value&...]. A page's route table says
// whether a view's second segment is an id: { review: { id: true } }. Otherwise
// the second segment is a sub and the third, if any, an id.

// Params that only open, focus or prefill the drawer; they never change the view
export const DRAWER_PARAMS = Object.freeze(['open', 'focus', 'kind', 'due']);

const isBlank = (v) => v === null || v === undefined || v === '';

// A malformed escape stays as typed instead of throwing
function decode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseHash(hash, table = {}) {
  const raw = String(hash ?? '').replace(/^#/, '');
  const q = raw.indexOf('?');
  const path = q === -1 ? raw : raw.slice(0, q);
  const query = q === -1 ? '' : raw.slice(q + 1);
  const [view = null, second = null, third = null] = path.split('/').filter(Boolean).map(decode);
  const idOnly = Boolean(table?.[view]?.id) && !table?.[view]?.subs;
  const params = {};
  for (const [k, v] of new URLSearchParams(query)) params[k] = v;
  return {
    view,
    sub: idOnly ? null : second,
    id: idOnly ? second : third,
    params,
  };
}

// Inverse of parseHash; params are sorted and blank ones dropped, for stable URLs
export function buildHash({ view, sub = null, id = null, params = {} } = {}) {
  const path = [view, sub, id].filter((s) => !isBlank(s)).map((s) => encodeURIComponent(String(s))).join('/');
  const search = new URLSearchParams(
    Object.keys(params ?? {}).filter((k) => !isBlank(params[k])).sort().map((k) => [k, String(params[k])]),
  ).toString();
  return `#/${path}${search ? `?${search}` : ''}`;
}

// View-defining params only, as one sorted string for comparison
function viewParams(params) {
  return Object.keys(params ?? {})
    .filter((k) => !DRAWER_PARAMS.includes(k) && !isBlank(params[k]))
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join('&');
}

const norm = (v) => (isBlank(v) ? null : String(v));

// Same view, sub, id and non-drawer params: only the drawer may differ
export function sameView(a, b) {
  if (!a || !b) return !a && !b;
  return norm(a.view) === norm(b.view)
    && norm(a.sub) === norm(b.sub)
    && norm(a.id) === norm(b.id)
    && viewParams(a.params) === viewParams(b.params);
}

// A copy of the route with the drawer params removed
export function withoutDrawer(route) {
  const params = {};
  for (const [k, v] of Object.entries(route?.params ?? {})) if (!DRAWER_PARAMS.includes(k)) params[k] = v;
  return { view: route?.view ?? null, sub: route?.sub ?? null, id: route?.id ?? null, params };
}

// True for an app route ('#/...') or no hash at all. Any other fragment, such as
// the skip link's '#main', is an in-page anchor the router must leave alone.
export function isRouteHash(hash) {
  const h = String(hash ?? '');
  return h === '' || h === '#' || h.startsWith('#/');
}

const hasDrawer = (route) => DRAWER_PARAMS.some((k) => !isBlank(route?.params?.[k]));

// How many drawer entries sit on top of the entry the drawer was opened from,
// after a transition. Closing the drawer goes back that many entries; at 0 it
// replaces the entry without the drawer params instead (spec 4.1 history rule).
//   kind   'initial' | 'push' | 'replace' | 'pop'
//   state  history.state of the entry now current ({ vb: true, depth } or null)
export function nextDepth(kind, prev, route, prevDepth = 0, state = null) {
  if (!hasDrawer(route)) return 0;
  if (kind === 'pop' || kind === 'initial') {
    return state && state.vb && Number.isInteger(state.depth) && state.depth > 0 ? state.depth : 0;
  }
  if (!prev || !sameView(prev, route)) return 0;
  if (kind === 'push') {
    if (!hasDrawer(prev)) return 1;
    return prevDepth > 0 ? prevDepth + 1 : 0;
  }
  // replace: keeps the chain when a drawer entry is swapped for another
  return hasDrawer(prev) ? prevDepth : 0;
}

// Merges params into a route; null, undefined and '' remove a key
export function withParams(route, params = {}) {
  const next = { ...route, params: { ...(route?.params ?? {}) } };
  for (const [k, v] of Object.entries(params ?? {})) {
    if (isBlank(v)) delete next.params[k];
    else next.params[k] = String(v);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Runtime

// startRouter({ table, onSync }) -> { current(), go(url, { replace }),
//   setParams(params, { replace }), openDrawer(taskId, extra), closeDrawer() }
//
// Listens to hashchange (link clicks) and popstate (back and forward, pushState
// scope switches). Both call one idempotent sync() that diffs the location
// against the last applied one, so a double event syncs once. onSync receives
// { route, prev, search, prevSearch, kind } where kind is 'initial', 'push',
// 'replace' or 'pop'. go() called from inside onSync is queued and synced right
// after it returns. The first sync runs in a microtask, after startRouter returns.
export function startRouter({ table = {}, onSync } = {}) {
  let lastKey = null;
  let lastRoute = null;
  let lastSearch = null;
  let depth = 0;
  let pendingKind = null;
  let syncing = false;
  let again = false;
  let closing = false;

  const locationKey = () => `${location.pathname}${location.search}${location.hash}`;

  function stamp(d) {
    try {
      const state = history.state && typeof history.state === 'object' ? history.state : {};
      history.replaceState({ ...state, vb: true, depth: d }, '', location.href);
    } catch {
      // a sandboxed page can refuse history writes; the drawer then closes by replace
    }
  }

  function sync() {
    if (syncing) {
      again = true;
      return;
    }
    syncing = true;
    try {
      do {
        again = false;
        const key = locationKey();
        if (key === lastKey) {
          pendingKind = null;
          continue;
        }
        // An in-page anchor ('#main') is not a route: put the last applied URL
        // back without remounting anything. On the first load it normalizes.
        if (lastKey !== null && !isRouteHash(location.hash)) {
          pendingKind = null;
          try {
            history.replaceState({ vb: true, depth }, '', lastKey);
          } catch {
            // a sandboxed page can refuse history writes; the view stays as it is
          }
          continue;
        }
        const route = parseHash(location.hash, table);
        const prev = lastRoute;
        const prevSearch = lastSearch;
        const state = history.state;
        let kind;
        if (lastKey === null) kind = 'initial';
        else if (pendingKind) kind = pendingKind;
        else if (state && state.vb) kind = 'pop';
        else kind = 'push';   // a link click made a fresh entry with no state yet
        pendingKind = null;
        closing = false;
        depth = nextDepth(kind, prev, route, depth, state);
        stamp(depth);
        lastKey = key;
        lastRoute = route;
        lastSearch = location.search;
        onSync?.({ route, prev, search: location.search, prevSearch, kind });
      } while (again);
    } finally {
      syncing = false;
    }
  }

  // url: a hash ('#/tasks'), a search plus hash ('?student=5#/overview') or a
  // path. Another page is a normal navigation.
  function go(url, { replace = false } = {}) {
    const target = new URL(String(url), location.href);
    if (target.origin !== location.origin || target.pathname !== location.pathname) {
      if (replace) location.replace(target.href);
      else location.assign(target.href);
      return;
    }
    if (target.href === location.href) {
      sync();
      return;
    }
    pendingKind = replace ? 'replace' : 'push';
    const state = { vb: true, depth: 0 };
    if (replace) history.replaceState(state, '', target.href);
    else history.pushState(state, '', target.href);
    sync();
  }

  function current() {
    return { route: parseHash(location.hash, table), search: location.search };
  }

  // Refining filters pass { replace: true }
  function setParams(params, { replace = false } = {}) {
    go(buildHash(withParams(parseHash(location.hash, table), params)), { replace });
  }

  // Opening the drawer pushes: open=<taskId> plus focus, kind or due
  function openDrawer(taskId, extra = {}) {
    const base = withoutDrawer(parseHash(location.hash, table));
    const params = {};
    for (const [k, v] of Object.entries(extra ?? {})) if (DRAWER_PARAMS.includes(k) && !isBlank(v)) params[k] = String(v);
    go(buildHash({ ...base, params: { ...base.params, ...params, open: String(taskId) } }));
  }

  // The history rule: back to the entry the drawer opened from when it was
  // pushed, otherwise replace this entry without the drawer params
  function closeDrawer() {
    const route = parseHash(location.hash, table);
    if (!hasDrawer(route) || closing) return;
    if (depth > 0) {
      closing = true;
      history.go(-depth);
      // If the traversal never lands (nothing to go back to), replace instead
      setTimeout(() => {
        if (!closing) return;
        closing = false;
        go(buildHash(withoutDrawer(parseHash(location.hash, table))), { replace: true });
      }, 600);
      return;
    }
    go(buildHash(withoutDrawer(route)), { replace: true });
  }

  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
  queueMicrotask(sync);

  return { current, go, setParams, openDrawer, closeDrawer, sync };
}
