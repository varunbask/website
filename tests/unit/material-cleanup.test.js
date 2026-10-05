import { describe, test, expect, vi, beforeEach } from 'vitest';

// A stand-in for the Supabase client: materials rows to read, and a record of
// what storage was asked to remove
const state = { rows: [], error: null, removed: [], query: null };
vi.mock('../../portal/js/supabase.js', () => ({
  sb: {
    from: () => ({
      select: () => ({
        in: async (column, ids) => {
          state.query = { column, ids };
          if (state.error) return { data: null, error: state.error };
          return { data: state.rows.filter((r) => ids.includes(r[column])), error: null };
        },
      }),
    }),
    storage: {
      from: () => ({
        remove: async (paths) => {
          state.removed.push(paths);
          return { data: paths, error: null };
        },
      }),
    },
  },
}));
const { filesOn, removeFilesOf } = await import('../../portal/js/materials-ui.js');

beforeEach(() => {
  state.rows = [];
  state.error = null;
  state.removed = [];
  state.query = null;
});

describe('files of deleted items', () => {
  test('reads the files on assignments, leaving out links', async () => {
    state.rows = [
      { task_id: 1, session_id: null, storage_path: 's/a.pdf' },
      { task_id: 1, session_id: null, storage_path: null },
      { task_id: 2, session_id: null, storage_path: 's/b.png' },
      { task_id: 3, session_id: null, storage_path: 's/c.pdf' },
    ];
    expect(await filesOn({ taskIds: [1, 2] })).toEqual([{ path: 's/a.pdf', owner: 1 }, { path: 's/b.png', owner: 2 }]);
    expect(state.query).toEqual({ column: 'task_id', ids: [1, 2] });
  });

  test('reads the files on sessions', async () => {
    state.rows = [{ task_id: null, session_id: 7, storage_path: 's/slides.pptx' }];
    expect(await filesOn({ sessionIds: [7] })).toEqual([{ path: 's/slides.pptx', owner: 7 }]);
    expect(state.query.column).toBe('session_id');
  });

  test('nothing to read, or a failed read: no files (they stay)', async () => {
    expect(await filesOn({})).toEqual([]);
    state.error = { message: 'offline' };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await filesOn({ taskIds: [1] })).toEqual([]);
    quiet.mockRestore();
  });

  test('removes only the files of items that were deleted', async () => {
    const files = [{ path: 'a', owner: 1 }, { path: 'b', owner: 2 }, { path: 'c', owner: 3 }];
    expect(await removeFilesOf(files, ['1', 3])).toBe(2);
    expect(state.removed).toEqual([['a', 'c']]);
  });

  test('a hundred files a request', async () => {
    const files = Array.from({ length: 250 }, (_, i) => ({ path: `p${i}`, owner: 1 }));
    await removeFilesOf(files, [1]);
    expect(state.removed.map((r) => r.length)).toEqual([100, 100, 50]);
  });

  test('nothing deleted: nothing removed', async () => {
    expect(await removeFilesOf([{ path: 'a', owner: 1 }], [])).toBe(0);
    expect(state.removed).toEqual([]);
  });
});
