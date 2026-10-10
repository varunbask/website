// App runtime (spec 4.1 to 4.4, 4.8, 11.1 F7). Builds the shell, resolves the
// scope (which student is on screen), mounts views, keeps nav counts in step
// with the store, and applies the title, announcement, focus and scroll rules.
//
// startApp({ me, page, audience, table, defaultRoute(scope), loadScope, drawer })
//   page          'student' | 'parent' | 'staff' | 'people' | 'account'
//   audience      'family' | 'staff'
//   table         the page's route table (routes.js; fields in app-model.js)
//   defaultRoute  (scope) -> hash, the page default for that scope
//   loadScope     async ({ search, store, me }) -> {
//                   student,            the profile on screen, or null
//                   options,            profiles for the switcher
//                   kind,               'student' (staff) | 'child' (parents) | null
//                   search?, hash?,     replace the URL with these (replaceState)
//                   message?,           toast after that replacement
//                   ...anything else    kept on the scope (defaultRoute reads it)
//                 }
//   drawer        the drawer renderer (renderItemDrawer)
//
// Each view's mount(ctx) receives:
//   host, me, role, page, audience, readOnly, scope ({ student } | null),
//   route ({ view, sub, id, params }), now, signal, alive(), store,
//   setHeader({ title, display, lede, lead, actions, crumbs, docTitle, tabs,
//             subnav, tabsLabel }) -> header,
//     tabs: a Node, or [{ label, href, current, count, context }] built with
//     linkTabs(); pass subnav: true for tabs that mirror the sidebar sub-items
//     (Assignments), so they hide while those sub-items are visible (spec 3.8);
//     tabsLabel names the tab nav (default "Sections").
//   setTopbarActions(nodes), announce(text),
//   open(taskId, extra), openNew({ kind, due }), openSession(id),
//   openNewSession({ due, at }), go(url, { replace }),
//   setParams(params, { replace }), toast, confirm, isRefresh,
//   refreshNav(), switchScope(id)
// Views must look up their own elements inside ctx.host (host.querySelector),
// never with document.getElementById: during a refresh the old render and the
// new, hidden one are both in the document, so a fixed id (#people-message)
// exists twice until the swap.
// mount may return a promise that settles after its first data render. On a
// refresh (store change) the new render is swapped in when it settles, keeping
// the scroll position and the focused data-focus-key. setParams with
// { replace: true } refines the current view: the URL changes, the view is not
// remounted and ctx.route is updated in place.

import { h } from './dom.js';
import * as store from './store.js';
import { sb } from './supabase.js';
import { startLive, watchTyping } from './live.js';
import { startRouter, sameView, buildHash, withParams } from './router.js';
import { mountShell } from './shell.js';
import { mountPalette } from './palette.js';
import { initDrawer, showDrawer, hideDrawer, drawerOpen, syncDrawerRow } from './drawer.js';
import { navModel, ADMIN_PAGES } from './nav-model.js';
import { navCounts } from './buckets.js';
import { getSeen, hasNewSince } from './seen.js';
import { recentChanges } from './sessions-model.js';
import { toast, confirmDialog } from './overlays.js';
import { onDataChanged } from './data-sync.js';
import { dragInProgress, whenDragEnds } from './calendar-drag.js';
import { errorCallout, skeletonRows, linkTabs } from './ui.js';
import { displayName } from './format.js';
import { isStale } from './freshness.js';
import { profileProgress, profileKind } from './profile-model.js';
import {
  normalizeRoute, isNamed, viewTitle, viewLabel, documentTitle, defaultCrumbs,
  reviewCounts, switcherHref, isScoped, clockCrossed,
} from './app-model.js';

const STAFF = new Set(['tutor', 'admin']);
const SWAP_TIMEOUT_MS = 4000;
const SCOPE_PARAM = { staff: 'student', parent: 'child' };

const isNode = (v) => typeof Node !== 'undefined' && v instanceof Node;
const call = (v, ...args) => (typeof v === 'function' ? v(...args) : v);
const modified = (e) => e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
const cssEscape = (s) => (globalThis.CSS?.escape ? CSS.escape(String(s)) : String(s).replace(/["\\]/g, '\\$&'));

export function startApp(config) {
  const { me, page, audience = 'family', table, defaultRoute, loadScope, drawer: renderDrawer } = config;
  const staff = STAFF.has(me.role);
  const readOnly = me.role === 'parent';
  const scopeParam = SCOPE_PARAM[page] ?? null;

  const shell = mountShell({ me, page });
  const root = shell.viewRoot;
  const announcer = document.getElementById('route-announcer');
  // Text a person is writing in the page (live redraws wait for them)
  const typing = watchTyping(root);

  let router = null;
  let scope = null;          // the loadScope result in use
  let scopeKey = null;       // the ?student / ?child value it was loaded for
  let scopeLoaded = false;
  let route = null;          // the applied route
  let view = null;           // { ctx, controller, host, entry, pendingFocus }
  let pending = null;        // a refresh render waiting to be swapped in
  let refineTarget = null;   // the hash a view's setParams(replace) is heading to
  let seq = 0;
  let navSeq = 0;
  let counts = {};
  let fresh = {};
  let profileDue = false;
  let perStudent = new Map();
  let lastRenderAt = Date.now();

  // Cmd+K / Ctrl+K / "/" and the top bar search button (palette.js)
  const palette = mountPalette({
    me,
    page,
    store,
    context: () => ({ scope: scopeCtx(), route, options: scope?.options ?? [] }),
    go: (url) => router.go(url),
    openDrawer: (id, extra) => router.openDrawer(id, extra),
    switchScope: (id) => switchScope(id),
  });

  try {
    history.scrollRestoration = 'manual';
  } catch {
    // not supported: the browser may restore scroll on back and forward
  }

  // -------------------------------------------------------------------------
  // Scope

  // sat: the student page's own SAT access (student.js), for the nav and the SAT view
  const scopeCtx = () => (scope?.student ? { student: scope.student, ...(scope.sat === undefined ? {} : { sat: scope.sat }) } : null);
  const scopeName = () => (page === 'parent' || page === 'staff') && scope?.student ? displayName(scope.student) : null;
  const namedScope = (entry, r) => (isNamed(entry, r) ? scopeName() : null);
  // The live pending count (admin) wins over the one read at scope load, so
  // the People default follows an approval without a reload (spec 4.2)
  const defaultHash = () => defaultRoute(
    scope && typeof counts.pending === 'number' ? { ...scope, pending: counts.pending } : scope,
  );

  function publishScope() {
    shell.setScope({
      kind: scope?.kind ?? null,
      current: scope?.student ?? null,
      options: scope?.options ?? [],
      counts: perStudent,
      onSwitch: switchScope,
      hrefFor: (id) => switcherHref({
        kind: scope?.kind,
        id,
        route: route ?? { view: null, params: {} },
        studentScoped: Boolean(route && isScoped(table[route.view], route)),
      }),
    });
    shell.setHome(defaultHash());
  }

  // Staff: ?student=<id> plus the current hash if it is student-scoped, else
  // #/overview. Parents: ?child=<id> plus the current hash. Pushes.
  function switchScope(id) {
    if (!scope?.kind || !route) return;
    router.go(switcherHref({ kind: scope.kind, id, route, studentScoped: isScoped(table[route.view], route) }));
  }

  async function resolveScope(my, key, search) {
    let result;
    try {
      // The tutors' colors load beside the scope (they never reject), so the first
      // lesson on any page is already in its tutor's color
      [result] = await Promise.all([loadScope({ search: new URLSearchParams(search), store, me }), store.getTutorColors()]);
    } catch (error) {
      if (my !== seq) return false;
      console.error(error);
      scopeLoaded = false;
      showPageError();
      return false;
    }
    if (my !== seq) return false;
    if (result?.search !== undefined || result?.hash !== undefined) {
      const url = `${location.pathname}${result.search ?? location.search}${result.hash ?? location.hash}`;
      router.go(url, { replace: true });
      if (result.message) toast({ text: result.message });
      return false;
    }
    // Switching to a student whose cache has gone stale (a sibling prefetched by
    // the Overview hours ago): load them again instead of showing old data
    if (result?.student) store.dropIfStale(result.student.id);
    const changedStudent = scope?.student?.id !== result?.student?.id;
    scope = result ?? { student: null, options: [], kind: null };
    scopeKey = key;
    scopeLoaded = true;
    if (changedStudent) {
      // Counts for the old student must never show next to the new one
      // (pending stays unknown until counted, so the People default still
      // reads the count loaded with the scope)
      counts = { reviewQueue: counts.reviewQueue ?? 0, ...(counts.pending === undefined ? {} : { pending: counts.pending }) };
      fresh = {};
      // A parent's Profile dot is about the child on screen
      if (me.role === 'parent') profileDue = false;
    }
    publishScope();
    return true;
  }

  // -------------------------------------------------------------------------
  // Sync: scope change, view change or drawer change (spec 4.1)

  function onSync({ route: next, search }) {
    const my = ++seq;
    const key = scopeParam ? new URLSearchParams(search).get(scopeParam) ?? '' : '';
    if (!scopeLoaded || key !== scopeKey) {
      const firstLoad = route === null && view === null;
      closeAll();
      abortView();
      if (!firstLoad) showLoading();
      resolveScope(my, key, search).then((ok) => {
        if (ok && my === seq) apply(next, { scopeChanged: true });
      });
      return;
    }
    apply(next, { scopeChanged: false });
  }

  function apply(next, { scopeChanged }) {
    const fix = normalizeRoute(next, {
      table,
      hasScope: Boolean(scope?.student),
      audience,
      staff,
      defaultHash: defaultHash(),
    });
    if (fix) {
      router.go(fix, { replace: true });
      return;
    }
    const prev = route;
    const first = prev === null;
    route = next;

    const refined = refineTarget !== null && buildHash(next) === refineTarget && prev
      && prev.view === next.view && (prev.sub ?? null) === (next.sub ?? null) && (prev.id ?? null) === (next.id ?? null);
    refineTarget = null;

    if (!view || scopeChanged || (!sameView(prev, next) && !refined)) {
      closeAll();
      requestReveal(null);
      mountView({ focus: !first });
    } else if (refined) {
      view.ctx.route = copyRoute(next);
      if (pending) pending.ctx.route = copyRoute(next);
    }
    syncDrawer();
    updateNav();
  }

  const copyRoute = (r) => ({ view: r.view, sub: r.sub ?? null, id: r.id ?? null, params: { ...(r.params ?? {}) } });

  // -------------------------------------------------------------------------
  // Views

  function abortView() {
    if (pending) {
      pending.controller.abort();
      pending.host.remove();
      pending = null;
    }
    view?.controller.abort();
    view = null;
  }

  function closeAll() {
    palette.close();
    hideDrawer({ restoreFocus: false });
    const confirmEl = document.getElementById('confirm');
    if (confirmEl?.open) confirmEl.close();
    shell.closeOverlays();
  }

  function showLoading() {
    root.replaceChildren(h('div', { class: 'view' }, skeletonRows(4)));
    root.setAttribute('aria-busy', 'true');
  }

  function showPageError() {
    root.replaceChildren(h('div', { class: 'view' }, errorCallout({
      title: 'We couldn’t load your portal.',
      text: 'Check your connection and try again.',
      onRetry: retryScope,
    })));
    root.setAttribute('aria-busy', 'false');
    updateNav();
  }

  function retryScope() {
    scopeLoaded = false;
    store.invalidateAll();
    const { route: r } = router.current();
    onSync({ route: r, search: location.search });
  }

  function activeFocusKey() {
    const active = document.activeElement;
    return active && root.contains(active) ? active.dataset?.focusKey ?? null : null;
  }

  // Where focus goes if the focused control leaves the list on a refresh (a
  // ticked task): the next keyed control in its card or list, then the one
  // before it, then the card's own link (e.g. "See all tasks"). Read from the
  // old render before it is removed: [{ key } | { href }]
  function focusFallbacks(active) {
    if (!active?.dataset?.focusKey) return [];
    const box = active.closest('section, .card') ?? active.closest('ul, ol');
    if (!box) return [];
    const keyed = [...box.querySelectorAll('[data-focus-key]')];
    const at = keyed.indexOf(active);
    const order = [...keyed.slice(at + 1), ...keyed.slice(0, Math.max(at, 0)).reverse()];
    const keys = [...new Set(order.map((el) => el.dataset.focusKey))]
      .filter((k) => k && k !== active.dataset.focusKey);
    const link = box.querySelector('.card-link[href], .card-foot a[href]');
    return [...keys.map((key) => ({ key })), ...(link ? [{ href: link.getAttribute('href') }] : [])];
  }

  function focusFirstOf(host, fallbacks) {
    for (const f of fallbacks) {
      const el = f.key
        ? host.querySelector(`[data-focus-key="${cssEscape(f.key)}"]`)
        : host.querySelector(`a[href="${cssEscape(f.href)}"]`);
      if (!el || el.disabled) continue;
      el.focus({ preventScroll: true });
      if (document.activeElement === el) return true;
    }
    return false;
  }

  // A just-created item to show once it is in the list and the drawer is shut:
  // opens a closed group (No due date) around its row and focuses the row
  let reveal = null;
  const REVEAL_MS = 10_000;

  function requestReveal(taskId) {
    reveal = taskId === null || taskId === undefined ? null : { key: `row-${taskId}`, until: Date.now() + REVEAL_MS };
  }

  function applyReveal() {
    if (!reveal || drawerOpen()) return;
    if (Date.now() > reveal.until) {
      reveal = null;
      return;
    }
    const el = view?.host.querySelector(`[data-focus-key="${cssEscape(reveal.key)}"]`);
    if (!el) return;
    reveal = null;
    for (let d = el.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) d.open = true;
    el.focus({ preventScroll: true });
    el.scrollIntoView?.({ block: 'nearest' });
  }

  function focusH1(target) {
    const h1 = target.host.querySelector('h1');
    if (!h1) return false;
    h1.focus({ preventScroll: true });
    target.pendingFocus = false;
    return true;
  }

  // What identifies the focused control inside the view header or its tabs
  function headerFocus(headerEl, tabs) {
    const active = document.activeElement;
    if (!active || active === document.body || active.tagName === 'H1') return null;
    const inside = (headerEl?.isConnected && headerEl.contains(active)) || (tabs?.isConnected && tabs.contains(active));
    if (!inside) return null;
    return {
      href: active.getAttribute('href'),
      key: active.dataset?.focusKey ?? null,
      label: active.getAttribute('aria-label') ?? active.textContent.trim(),
      tag: active.tagName,
    };
  }

  function restoreHeaderFocus(memo, headerEl, tabs) {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const pool = [headerEl, tabs].filter(Boolean)
      .flatMap((el) => [...el.querySelectorAll('a[href], button, [data-focus-key], [tabindex]')]);
    const match = (memo.key && pool.find((el) => el.dataset.focusKey === memo.key))
      || (memo.href && pool.find((el) => el.getAttribute('href') === memo.href))
      || pool.find((el) => el.tagName === memo.tag
        && (el.getAttribute('aria-label') ?? el.textContent.trim()) === memo.label);
    match?.focus({ preventScroll: true });
  }

  function applyDefaults(entry) {
    const named = namedScope(entry, route);
    document.title = documentTitle(viewTitle(entry, route), named);
    const crumbs = defaultCrumbs(entry, route, { scopeName: named });
    shell.setCrumbs(crumbs);
    shell.setTitle(crumbs.at(-1)?.label ?? viewLabel(entry, route));
    shell.setTopbarActions([]);
    shell.setTabbarHidden(Boolean(entry.hideTabbar?.(route)));
    shell.setBack(entry.back?.(route) ?? null);
  }

  // Mounts the current route's view into a fresh div.view. A refresh renders
  // off screen and swaps in when ready (no flash, same scroll, same focus).
  function mountView({ isRefresh = false, focus = false } = {}) {
    const entry = table[route.view];
    if (!entry) return;
    stopWaiting();
    if (pending) {
      pending.controller.abort();
      pending.host.remove();
      pending = null;
    }
    const controller = new AbortController();
    const host = h('div', { class: call(entry.wide, route) ? 'view is-wide' : 'view' });
    const now = new Date();
    lastRenderAt = now.getTime();
    const target = { host, controller, entry, pendingFocus: focus, ctx: null };
    target.ctx = makeCtx({ target, isRefresh, now });

    // On a refresh the visible view stays alive (listeners, alive(), object
    // URLs) until the new render is swapped in; it is aborted in swap()
    const old = view;

    if (!isRefresh) {
      old?.controller.abort();
      root.replaceChildren(host);
      root.setAttribute('aria-busy', 'false');
      view = target;
      applyDefaults(entry);
      window.scrollTo(0, 0);
    } else {
      const width = root.getBoundingClientRect().width;
      Object.assign(host.style, {
        position: 'fixed', top: '0px', left: '0px', width: `${width}px`,
        visibility: 'hidden', pointerEvents: 'none', zIndex: '-1',
      });
      host.inert = true;
      root.append(host);
      pending = target;
    }

    const swap = () => {
      if (pending !== target) return;
      pending = null;
      // Read scroll and focus now, not when the refresh started: the user may
      // have scrolled or tabbed while the data loaded
      const keepKey = activeFocusKey();
      const hadFocus = Boolean(old && old !== target && old.host.contains(document.activeElement));
      const fallbacks = hadFocus ? focusFallbacks(document.activeElement) : [];
      const keepY = window.scrollY;
      if (old && old !== target) {
        // An old view that had not focused its h1 yet hands that on
        if (old.pendingFocus) target.pendingFocus = true;
        old.controller.abort();
      }
      for (const el of [...root.children]) if (el !== host) el.remove();
      for (const prop of ['position', 'top', 'left', 'width', 'visibility', 'pointerEvents', 'zIndex']) host.style[prop] = '';
      if (!host.style.length) host.removeAttribute('style');
      host.inert = false;
      view = target;
      window.scrollTo(0, keepY);
      if (target.pendingFocus) focusH1(target);
      else if (keepKey) host.querySelector(`[data-focus-key="${cssEscape(keepKey)}"]`)?.focus({ preventScroll: true });
      // The focused control is gone from the new render (a ticked task that
      // left the list, a "Try again" that worked): its neighbour in the same
      // card or list, else the h1, never <body>
      const lost = !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected;
      if (hadFocus && lost && !focusFirstOf(host, fallbacks)) focusH1(target);
      applyReveal();
      syncDrawerRow();
    };

    let result;
    try {
      result = entry.mount(target.ctx);
    } catch (error) {
      console.error(error);
      showViewError(target);
    }
    if (target.pendingFocus) focusH1(target);

    const settle = () => {
      if (controller.signal.aborted) return;
      if (isRefresh) swap();
      else {
        if (target.pendingFocus) focusH1(target);
        applyReveal();
      }
      syncDrawerRow();
      updateNav();
    };
    if (result && typeof result.then === 'function') {
      if (isRefresh) setTimeout(swap, SWAP_TIMEOUT_MS);
      result.then(settle, (error) => {
        console.error(error);
        if (!controller.signal.aborted && !host.childElementCount) showViewError(target);
        settle();
      });
    } else {
      settle();
    }
  }

  function showViewError(target) {
    target.host.append(errorCallout({
      title: 'We couldn’t load this page.',
      text: 'Check your connection and try again.',
      onRetry: () => store.invalidateAll(),
    }));
  }

  // Never redraw the calendar under a drag: refresh once, after it is dropped
  let refreshAfterDrag = false;
  function refreshView() {
    if (!route || !view || !scopeLoaded) return;
    if (dragInProgress()) {
      if (!refreshAfterDrag) {
        refreshAfterDrag = true;
        whenDragEnds(() => {
          refreshAfterDrag = false;
          refreshView();
        });
      }
      return;
    }
    mountView({ isRefresh: true });
    if (drawerOpen()) syncDrawer({ isRefresh: true });
  }

  // A change another person made (live.js) redraws the page unless someone is
  // typing in it: an open form is never repainted. The change is already in the
  // store, so the page catches up the moment they stop. The drawer keeps its own
  // forms through a refresh (dctx.onRefresh), so it follows at once.
  const LIVE_RECHECK_MS = 1000;
  let liveTimer = null;

  function stopWaiting() {
    clearTimeout(liveTimer);
    liveTimer = null;
  }

  function refreshLive() {
    stopWaiting();
    if (!route || !view || !scopeLoaded) return;
    if (typing.busy()) {
      if (drawerOpen()) syncDrawer({ isRefresh: true });
      liveTimer = setTimeout(refreshLive, LIVE_RECHECK_MS);
      return;
    }
    refreshView();
  }

  // A person or a link changed elsewhere: the switcher's list (a parent's
  // children, a tutor's students) and the person on screen are read again. One
  // who is gone or no longer linked is sent where a fresh load would send them.
  async function refreshScope() {
    if (!scopeLoaded || !route) return;
    const my = seq;
    let result;
    try {
      result = await loadScope({ search: new URLSearchParams(location.search), store, me });
    } catch {
      return;
    }
    if (my !== seq || !scopeLoaded || !result) return;
    if (result.search !== undefined || result.hash !== undefined) {
      const url = `${location.pathname}${result.search ?? location.search}${result.hash ?? location.hash}`;
      router.go(url, { replace: true });
      if (result.message) toast({ text: result.message });
      return;
    }
    if ((result.student?.id ?? null) !== (scope?.student?.id ?? null)) return;
    const signature = (s) => JSON.stringify([s?.student?.id ?? null, displayName(s?.student ?? {}), (s?.options ?? []).map((o) => [o.id, displayName(o)])]);
    const changed = signature(result) !== signature(scope);
    scope = result;
    if (changed) publishScope();
  }

  function makeCtx({ target, isRefresh, now }) {
    const { host, controller, entry } = target;
    const signal = controller.signal;
    const alive = () => !signal.aborted;
    let header = null;
    let tabsEl = null;

    const ctx = {
      host,
      me,
      role: me.role,
      page,
      audience,
      readOnly,
      scope: scopeCtx(),
      route: copyRoute(route),
      now,
      signal,
      alive,
      store,
      isRefresh,
      toast,
      confirm: confirmDialog,

      // The view header: h1 (tabindex -1), optional lede, actions, link tabs.
      // Also sets the breadcrumb (crumbs) and document title (docTitle).
      setHeader(opts = {}) {
        if (!alive()) return null;
        const h1Class = opts.display ? 'view-title is-display' : 'view-title';
        let lede = null;
        if (isNode(opts.lede)) lede = opts.lede;
        else if (opts.lede) lede = h('p', { class: 'view-lede' }, opts.lede);
        const actions = [].concat(opts.actions ?? []).filter(Boolean);
        const actionsEl = actions.length ? h('div', { class: 'view-actions' }, actions) : null;
        const oldHeading = header?.isConnected ? header.querySelector(':scope > .view-heading') : null;
        const oldH1 = oldHeading?.querySelector(':scope > h1');
        // Focus on a tab or an action that is about to be rebuilt (a second
        // call once counts arrive) moves to its twin in the new header
        const refocus = headerFocus(header, tabsEl);
        if (oldH1) {
          // A second call updates the header in place: the h1 node (and focus
          // on it) survives, only its text, the lede, lead and actions change
          oldH1.className = h1Class;
          oldH1.textContent = opts.title ?? '';
          for (const el of [...oldHeading.children]) if (el !== oldH1) el.remove();
          if (lede) oldHeading.append(lede);
          for (const el of [...header.children]) if (el !== oldHeading) el.remove();
          if (opts.lead) oldHeading.before(opts.lead);
          if (actionsEl) header.append(actionsEl);
        } else {
          const h1 = h('h1', { class: h1Class, tabindex: '-1' }, opts.title ?? '');
          const next = h('header', { class: 'view-header' },
            opts.lead ?? null,
            h('div', { class: 'view-heading' }, h1, lede),
            actionsEl);
          if (header?.isConnected) header.replaceWith(next);
          else host.prepend(next);
          header = next;
        }

        let nextTabs = null;
        if (isNode(opts.tabs)) nextTabs = opts.tabs;
        else if (Array.isArray(opts.tabs) && opts.tabs.length) {
          nextTabs = linkTabs(opts.tabs, { subnav: Boolean(opts.subnav), label: opts.tabsLabel || undefined });
        }
        if (tabsEl?.isConnected) tabsEl.remove();
        tabsEl = nextTabs;
        if (tabsEl) header.after(tabsEl);
        if (refocus) restoreHeaderFocus(refocus, header, tabsEl);

        if (opts.docTitle) document.title = documentTitle(opts.docTitle, namedScope(entry, ctx.route));
        if (opts.crumbs) {
          shell.setCrumbs(opts.crumbs);
          shell.setTitle(opts.crumbs.at(-1)?.label ?? opts.title ?? '');
        }
        if (target.pendingFocus && view === target) focusH1(target);
        return header;
      },

      setTopbarActions(nodes) {
        if (alive()) shell.setTopbarActions(nodes);
      },

      // After a view change and its first data render (never on a refresh)
      announce(text) {
        if (isRefresh || !alive() || !announcer) return;
        announcer.textContent = '';
        setTimeout(() => {
          if (alive()) announcer.textContent = text ?? '';
        }, 60);
      },

      open: (taskId, extra) => router.openDrawer(taskId, extra),
      // session: homework set in that lesson (tasks.session_id)
      openNew: ({ kind, due, session } = {}) => router.openDrawer('new', { kind, due, session }),
      // Sessions use the same drawer: open=s<id>, or open=new-session with a
      // prefilled day (due) and start time (at, 'HH:MM')
      openSession: (id) => router.openDrawer(`s${id}`),
      openNewSession: ({ due, at } = {}) => router.openDrawer('new-session', { due, at }),
      go: (url, opts) => router.go(url, opts),
      setParams(params, opts = {}) {
        if (!alive()) return;
        const { route: cur } = router.current();
        const target = buildHash(withParams(cur, params));
        if (target === buildHash(cur) && `#${location.hash.replace(/^#/, '')}` === target) return;
        refineTarget = opts.replace ? target : null;
        router.setParams(params, opts);
      },
      refreshNav: () => updateNav(),
      switchScope: (id) => switchScope(id),
    };
    return ctx;
  }

  // -------------------------------------------------------------------------
  // Drawer

  function syncDrawer({ isRefresh = false } = {}) {
    const open = route?.params?.open;
    if (!open) {
      if (drawerOpen()) hideDrawer();
      applyReveal();
      return;
    }
    showDrawer({
      taskId: open,
      params: { ...route.params },
      me,
      role: me.role,
      audience,
      readOnly,
      scope: scopeCtx(),
      route: copyRoute(route),
      now: new Date(),
      store,
      toast,
      confirm: confirmDialog,
      go: (url, opts) => router.go(url, opts),
      reveal: requestReveal,
      isRefresh,
    });
  }

  initDrawer({ render: renderDrawer, onRequestClose: () => router.closeDrawer() });

  // -------------------------------------------------------------------------
  // Navigation model and counts

  function renderNav() {
    const model = navModel({ role: me.role, page, scope: scopeCtx(), route: route ?? {}, counts, fresh, profileDue });
    shell.setNav(model);
    shell.setMode(model.mode ?? 'workspace');
  }

  // Whose profile the Profile item is about: your own, or a parent's child on screen
  function profileTarget() {
    const kind = profileKind(me.role);
    if (kind === 'staff' || me.role === 'student') return { kind, id: me.id };
    if (me.role === 'parent' && scope?.student) return { kind, id: scope.student.id };
    return null;
  }

  async function computeCounts() {
    const out = { counts: {}, fresh: {}, perStudent: new Map(), profileDue: false };
    const now = new Date();
    const student = scope?.student;
    const jobs = [];
    const target = profileTarget();
    if (target) {
      jobs.push(store.getProfileStatus(target.kind, target.id)
        .then((status) => { out.profileDue = !profileProgress(target.kind, status).complete; })
        .catch(() => {}));
    }
    if (student && !ADMIN_PAGES.has(page)) {
      jobs.push((async () => {
        const data = await store.getStudentData(student.id);
        const items = store.itemsFor(data, { now, audience, viewerId: me.id });
        Object.assign(out.counts, navCounts(items, { audience }));
        if (audience === 'family') {
          const graded = items.filter((i) => i.bucket === 'graded').map((i) => i.grade?.released_at);
          out.fresh.graded = hasNewSince(graded, getSeen('graded', me.id, student.id), now);
          const updates = await store.getUpdates(student.id);
          out.fresh.updates = hasNewSince((updates ?? []).map((u) => u.created_at), getSeen('updates', me.id, student.id), now);
          // A moved or cancelled session the family has not seen on the calendar
          const changed = recentChanges(await store.getSessions(student.id), null, now).map((s) => s.changed_at);
          out.fresh.schedule = hasNewSince(changed, getSeen('schedule', me.id, student.id), now);
        }
      })().catch(() => {}));
    }
    if (staff) {
      jobs.push(store.getWorkspace().then((ws) => {
        out.students = ws.students;
        out.perStudent = reviewCounts(ws.submissions);
        out.counts.reviewQueue = [...out.perStudent.values()].reduce((a, b) => a + b, 0);
      }).catch(() => {}));
    }
    if (me.role === 'admin') {
      jobs.push(store.getPendingCount().then((n) => { out.counts.pending = n; }).catch(() => {}));
    }
    await Promise.all(jobs);
    return out;
  }

  // Renders at once with the last counts, then again when fresh counts arrive
  async function updateNav() {
    renderNav();
    const my = ++navSeq;
    const forStudent = scope?.student?.id;
    const next = await computeCounts();
    if (my !== navSeq || forStudent !== scope?.student?.id) return;
    counts = next.counts;
    fresh = next.fresh;
    profileDue = next.profileDue;
    if (staff) {
      perStudent = next.perStudent;
      // The switcher lists every student the workspace sees, kept in step
      // with the Students list after a reload of the workspace
      if (scope?.kind === 'student' && next.students) scope.options = next.students;
      publishScope();
    }
    renderNav();
  }

  // -------------------------------------------------------------------------
  // Store changes and returning to the tab (spec 4.4)

  store.onChange(({ ids = [], live = false } = {}) => {
    updateNav();
    if (live && (ids.includes('people') || ids.includes('*'))) refreshScope();
    if (live) refreshLive();
    else refreshView();
  });

  // Whether the person on screen (?student= or ?child=) is still in the lists
  // the portal loads for this person; true when that cannot be told
  async function scopeStillListed() {
    const id = scope?.student?.id;
    if (!id) return true;
    try {
      if (scope.kind === 'student') return (await store.getWorkspace()).students.some((s) => String(s.id) === String(id));
      if (scope.kind === 'child') return (await store.getChildren(me.id)).some((c) => String(c.id) === String(id));
    } catch {
      return true;
    }
    return true;
  }

  // The person on screen was deleted (in another tab): go to the page's default
  // route without them, and pick the scope again from what is left
  async function leaveDeletedScope() {
    const gone = scope?.student;
    if (!gone || !scopeParam || (await scopeStillListed())) return;
    if (scope?.student?.id !== gone.id) return;
    const params = new URLSearchParams(location.search);
    params.delete(scopeParam);
    const search = params.toString();
    scopeLoaded = false;
    toast({ text: `${displayName(gone)} is no longer in the portal.` });
    router.go(`${location.pathname}${search ? `?${search}` : ''}${defaultRoute(null)}`, { replace: true });
  }

  // Another tab of this browser changed data for everyone (a person was
  // deleted): drop everything this tab cached, which redraws the page, the nav
  // counts and the student switcher, then leave a student who is gone
  onDataChanged(() => {
    store.invalidateAll();
    leaveDeletedScope();
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !route || !view) return;
    const id = scope?.student?.id ?? null;
    const times = [id ? await store.loadedAt(id) : null, staff ? await store.loadedAt(null) : null].filter(Boolean);
    if (times.some((t) => isStale(t))) {
      store.invalidate(id);
      return;
    }
    let tasks = [];
    let submissions = [];
    let sessions = [];
    try {
      if (id && await store.loadedAt(id)) {
        const data = await store.getStudentData(id);
        tasks = data.tasks;
        submissions = data.submissions;
        sessions = await store.getSessions(id).catch(() => []);
      } else if (staff && await store.loadedAt(null)) {
        const ws = await store.getWorkspace();
        tasks = ws.tasks;
        submissions = ws.submissions;
        sessions = ws.sessions ?? [];
      }
    } catch {
      return;
    }
    if (clockCrossed(tasks, submissions, lastRenderAt, Date.now(), sessions)) {
      updateNav();
      refreshView();
    }
  });

  // Same-page links that change ?student= or ?child= (Students rows, People's
  // links on this page) push through the router instead of reloading the page
  document.addEventListener('click', (e) => {
    if (modified(e)) return;
    const a = e.target.closest?.('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search === location.search) return;
    e.preventDefault();
    router.go(`${url.pathname}${url.search}${url.hash}`);
  });

  // Realtime: pages follow changes other people make (no reload). Never throws.
  startLive({ me, client: sb, store });

  router = startRouter({ table, onSync });
  return {
    router,
    shell,
    get route() { return route; },
    get scope() { return scopeCtx(); },
    switchScope,
    refresh: refreshView,
  };
}
