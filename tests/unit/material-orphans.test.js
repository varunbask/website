import { describe, test, expect } from 'vitest';
import { findOrphans, MATERIAL_NAME, MIN_AGE_MS, sizeText, chunks } from '../../scripts/material-orphans.js';

const S = '11111111-2222-4333-8444-555555555555';
const id = (n) => `${String(n).padStart(8, '0')}-aaaa-4bbb-8ccc-dddddddddddd`;
const NOW = Date.parse('2026-10-05T12:00:00Z');
const old = new Date(NOW - 2 * MIN_AGE_MS).toISOString();
const file = (n, ext = 'pdf', created_at = old) => ({ name: `${S}/${id(n)}.${ext}`, created_at, size: 1000 });

describe('unused material files', () => {
  test('a file no row uses is an orphan; files in use stay', () => {
    const objects = [file(1), file(2, 'png'), file(3, 'pptx')];
    const { orphans, skipped } = findOrphans(objects, [objects[1].name], { now: NOW });
    expect(orphans.map((o) => o.name)).toEqual([objects[0].name, objects[2].name]);
    expect(skipped).toEqual({ young: 0, unknown: 0 });
  });

  test('files under an hour old are left alone (an upload may be adding its row)', () => {
    const young = file(4, 'pdf', new Date(NOW - MIN_AGE_MS + 1000).toISOString());
    const undated = { ...file(5), created_at: null };
    const { orphans, skipped } = findOrphans([young, undated], [], { now: NOW });
    expect(orphans).toEqual([]);
    expect(skipped.young).toBe(2);
  });

  test('names the portal never makes are left alone', () => {
    const odd = [
      { name: `${S}/notes.pdf`, created_at: old },
      { name: `${S}/${id(6)}.exe`, created_at: old },
      { name: `${id(7)}.pdf`, created_at: old },
      { name: `${S}/sub/${id(8)}.pdf`, created_at: old },
    ];
    const { orphans, skipped } = findOrphans(odd, [], { now: NOW });
    expect(orphans).toEqual([]);
    expect(skipped.unknown).toBe(4);
  });

  test('the name pattern matches every type the portal uploads', () => {
    for (const ext of ['pdf', 'pptx', 'ppt', 'docx', 'doc', 'png', 'jpg']) expect(MATERIAL_NAME.test(`${S}/${id(1)}.${ext}`), ext).toBe(true);
    expect(MATERIAL_NAME.test(`${S}/${id(1)}.PDF`)).toBe(false);
  });

  test('sizes and batches', () => {
    expect(sizeText(512)).toBe('512 bytes');
    expect(sizeText(2048)).toBe('2.0 KB');
    expect(sizeText(3.5 * 1024 * 1024)).toBe('3.5 MB');
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
