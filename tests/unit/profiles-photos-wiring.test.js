import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('routes', () => {
  // routes.js pulls in every view, and with them the Supabase client: stand in for the CDN script
  let routes;
  beforeAll(async () => {
    globalThis.window ??= { supabase: { createClient: () => ({}) } };
    routes = await import('../../portal/js/routes.js');
  });

  test('a student\'s Profile is their own; a parent\'s needs the child on screen', () => {
    const student = routes.familyRoutes('student').profile;
    const parent = routes.familyRoutes('parent').profile;
    expect(student.title()).toBe('Profile');
    expect(Boolean(student.scoped)).toBe(false);
    expect(parent.scoped).toBe(true);
  });

  test('staff have their own Profile on the staff page, outside Student mode', () => {
    const entry = routes.staffRoutes().profile;
    expect(entry.title()).toBe('Profile');
    expect(Boolean(entry.scoped)).toBe(false);
    expect(routes.peopleRoutes().profile).toBeUndefined();
    expect(routes.accountRoutes().profile).toBeUndefined();
  });

  test('the Students list marks a student whose profile is not filled in, and nobody while profiles are unknown', async () => {
    const { studentSummaries } = await import('../../portal/js/views/students.js');
    const ws = { students: [{ id: 's1', full_name: 'Maya Lin' }, { id: 's2', full_name: 'Leo Park' }, { id: 's3', full_name: 'Ava Chen' }], tasks: [], submissions: [], sessions: [], links: [] };
    const profiles = new Map([['s1', { grade_level: '9th grade', school: 'Arcadia High', interests: 'Volleyball' }], ['s2', { grade_level: '8th grade' }]]);
    const now = new Date('2026-10-14T19:00:00Z');
    expect(studentSummaries(ws, now, { profiles }).map((x) => x.profileDue)).toEqual([false, true, true]);
    expect(studentSummaries(ws, now).map((x) => x.profileDue)).toEqual([false, false, false]);
  });
});

describe('photos everywhere, signed in batches', () => {
  const surfaces = [
    'portal/js/shell.js', 'portal/js/views/people.js', 'portal/js/views/students.js', 'portal/js/views/overview.js',
    'portal/js/session-drawer.js', 'portal/js/views/review.js', 'portal/js/review-row.js', 'portal/js/views/today.js',
    'portal/js/updates-feed.js', 'portal/js/student-profile-card.js', 'portal/js/profile-nudge.js',
  ];

  test('every surface that shows a person draws them with personAvatar', () => {
    for (const file of surfaces) {
      const code = read(file);
      expect(code, file).toContain("from './photos.js'".replace('./', file.includes('/views/') ? '../' : './'));
      expect(code, file).toMatch(/personAvatar\(/);
      // no plain avatar(name) left beside it
      expect(code.replace(/personAvatar\(/g, ''), file).not.toMatch(/[^.\w]avatar\(/);
    }
  });

  test('photos are only ever signed in one batch call, never one at a time', () => {
    const files = readdirSync(join(ROOT, 'portal/js'), { recursive: true }).filter((f) => f.endsWith('.js'));
    const users = files.filter((f) => /PHOTO_BUCKET|'avatars'/.test(read(`portal/js/${f}`)));
    expect(users.sort()).toEqual(['photo-model.js', 'photo-upload.js', 'photos.js']);
    expect(read('portal/js/photos.js')).toContain('.createSignedUrls(list, SIGN_SECONDS)');
    for (const f of users) expect(read(`portal/js/${f}`), f).not.toMatch(/createSignedUrl\(/);
  });

  test('the workspace, a parent\'s children and People read the photo path with the rows they already load', () => {
    expect(read('portal/js/store.js')).toContain("makeQuery('id, full_name, email, avatar_path')");
    expect(read('portal/js/views/people.js')).toContain('no_login, calendar_color, avatar_path');
    // the signed-in person's own row is never put at risk by a missing column
    expect(read('portal/js/session.js')).not.toContain('avatar_path');
  });

  test('the photo is re-drawn on the device, so EXIF and location data never leave it', () => {
    const upload = read('portal/js/photo-upload.js');
    expect(upload).toMatch(/EXIF data, the location it was\s+\/\/\s+taken at included, never leaves the device/);
    expect(upload).toContain("'image/webp'");
    expect(upload).toContain("'image/jpeg'");
    const prepare = upload.slice(upload.indexOf('export async function preparePhoto'));
    expect(prepare).toContain('checkPhotoFile(file)');
    expect(prepare.indexOf('checkPhotoFile(file)')).toBeLessThan(prepare.indexOf('await decode(file)'));
    expect(upload).toContain('upsert: false');
  });
});

describe('the Profile page', () => {
  const view = read('portal/js/views/profile.js');

  test('a real button opens the file picker, which has a hidden label and stays out of the tab order', () => {
    expect(view).toContain("type: 'file', accept: 'image/*'");
    expect(view).toContain("tabindex: '-1'");
    expect(view).toMatch(/h\('label', \{ class: 'visually-hidden', for: inputId \}/);
    expect(view).toContain('onClick: () => input.click()');
    expect(view).toContain("'Your profile photo'");
  });

  test('progress and errors are said where they happen', () => {
    expect(view).toContain("class: 'prf-photo-status', role: 'status'");
    expect(view).toContain("role: 'alert'");
  });
});

describe('stylesheets', () => {
  const pages = readdirSync(join(ROOT, 'portal')).filter((f) => f.endsWith('.html'));

  test('app.css and student-profile.css carry one new ?v= on every page that links them', () => {
    const versions = new Map();
    for (const page of pages) {
      for (const [, name, v] of read(`portal/${page}`).matchAll(/\/portal\/css\/([\w-]+\.css)\?v=(\d+)/g)) {
        if (!versions.has(name)) versions.set(name, new Set());
        versions.get(name).add(v);
      }
    }
    expect([...versions.get('app.css')]).toEqual(['10']);
    expect([...versions.get('student-profile.css')]).toEqual(['2']);
    for (const page of ['student.html', 'parent.html', 'staff.html']) expect(read(`portal/${page}`), page).toContain('student-profile.css?v=2');
  });

  test('the photo, the dot and the new cards have their styles', () => {
    const app = read('portal/css/app.css');
    for (const rule of ['.avatar > img', '.badge.is-dot', '.tabbar-icon > .badge.is-dot']) expect(app).toContain(rule);
    const sp = read('portal/css/student-profile.css');
    for (const rule of ['.card.prf-nudge', '.prf-steps', '.prf-photo', '.prf-form', '.prf-tutor-bio.is-clamped', '.stu-profile-due', '.sp-due']) expect(sp).toContain(rule);
    for (const css of [app, sp]) expect(css).not.toMatch(/[–—]/);
  });
});

describe('privacy page', () => {
  const html = read('privacy.html');

  test('one short bullet: optional profile details and photo, who sees them, stored privately without location data', () => {
    const bullet = /<li><strong>Profiles and photos:<\/strong>([^<]*)<\/li>/.exec(html)?.[1] ?? '';
    expect(bullet).toMatch(/grade, school, interests, and how they learn best/);
    expect(bullet).toMatch(/optional profile photo/);
    expect(bullet).toMatch(/The student, their parents, their tutors, and our administrator can see them/);
    expect(bullet).toMatch(/stored privately, resized, and have their location data removed/);
    expect(bullet).not.toMatch(/[–—]|\bAI\b/);
    expect(html.match(/Profiles and photos/g)).toHaveLength(1);
  });
});
