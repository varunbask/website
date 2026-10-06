// parent.html?child=<id>: a linked child's work, read-only (spec 4.2). A parent
// with no linked child only has the Overview welcome.
import { requireRole } from './session.js';
import { startApp } from './app.js';
import { familyRoutes } from './routes.js';
import { renderItemDrawer } from './item-drawer.js';

const me = await requireRole(['parent']);

startApp({
  me,
  page: 'parent',
  audience: 'family',
  table: familyRoutes('parent'),
  defaultRoute: () => '#/overview',
  // ?child= must name a linked child; otherwise the first child (replaceState)
  loadScope: async ({ search, store }) => {
    const children = await store.getChildren(me.id);
    const wanted = search.get('child');
    if (!children.length) {
      return { student: null, options: [], kind: 'child', search: wanted !== null ? '' : undefined };
    }
    const chosen = children.find((c) => c.id === wanted) ?? children[0];
    return {
      student: chosen,
      options: children,
      kind: 'child',
      search: chosen.id === wanted ? undefined : `?child=${encodeURIComponent(chosen.id)}`,
    };
  },
  drawer: renderItemDrawer,
});
