import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The rules themselves are exercised against Postgres (the PGlite checks).
// These guard the key lines of the file.
const sql = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20261025120000_profiles_and_photos.sql', import.meta.url)), 'utf8');

// The body of one function, from its create line to the closing $$;
const fn = (name) => {
  const start = sql.indexOf(`create function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
};
const policies = (table) => [...sql.matchAll(new RegExp(`create policy "([^"]+)" on ${table.replace('.', '\\.')}\\s+for (\\w+)([\\s\\S]*?);`, 'g'))]
  .map(([, name, command, body]) => ({ name, command, body }));

describe('who may see a person', () => {
  const body = fn('private.can_see_person');

  test('a security definer helper with an empty search path, for signed-in people only', () => {
    expect(body).toContain('language sql stable security definer set search_path = \'\'');
    expect(sql).toContain('revoke execute on function private.can_see_person(uuid) from public;');
    expect(sql).toContain('grant execute on function private.can_see_person(uuid) to authenticated;');
  });

  test('self, the admin, staff to staff, and through a student the caller may see', () => {
    expect(body).toContain('p_person is not null');
    expect(body).toContain('p_person = auth.uid()');
    expect(body).toContain('private.is_admin()');
    expect(body).toMatch(/private\.my_role\(\) in \('tutor', 'admin'\)\s+and exists \(select 1 from public\.profiles p\s+where p\.id = p_person and p\.role in \('tutor', 'admin'\)\)/);
    expect(body).toContain("(p.role = 'student' and private.can_view_student(p.id))");
    expect(body).toMatch(/p\.role = 'parent' and exists \(\s+select 1 from public\.parent_students ps\s+where ps\.parent_id = p\.id and private\.can_view_student\(ps\.student_id\)\)/);
    expect(body).toMatch(/p\.role in \('tutor', 'admin'\) and exists \(\s+select 1 from public\.tutor_students ts\s+where ts\.tutor_id = p\.id and private\.can_view_student\(ts\.student_id\)\)/);
  });

  test('a photo is changed by the person (once approved), the admin, or a parent of a student', () => {
    const set = fn('private.can_set_avatar');
    expect(set).toContain("(p_person = auth.uid() and private.my_role() in ('student', 'parent', 'tutor', 'admin'))");
    expect(set).toContain("private.has_role(p_person, 'student')");
    expect(set).toContain('ps.parent_id = auth.uid() and ps.student_id = p_person');
  });
});

describe('the photo path and the bucket', () => {
  const PATTERN = "'^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\\.(webp|jpg|png)$'";

  test('avatar_path is checked: length, pattern and the person\'s own folder', () => {
    expect(sql).toContain('add column avatar_path text');
    expect(sql).toContain('char_length(avatar_path) <= 200');
    expect(sql).toContain(`avatar_path ~ ${PATTERN}`);
    expect(sql).toContain("split_part(avatar_path, '/', 1) = id::text");
  });

  test('no client may update avatar_path directly', () => {
    expect(sql).not.toMatch(/grant update \([^)]*avatar_path[^)]*\)/);
  });

  test('a private bucket, 1 MB, WebP, JPEG and PNG', () => {
    expect(sql).toContain("values ('avatars', 'avatars', false, 1048576, array['image/webp', 'image/jpeg', 'image/png'])");
  });

  test('read, add and remove policies, and no update policy', () => {
    const list = policies('storage.objects');
    expect(list.map((p) => p.command).sort()).toEqual(['delete', 'insert', 'select']);
    for (const p of list) expect(p.body, p.name).toContain("bucket_id = 'avatars'");
    expect(list.find((p) => p.command === 'select').body).toContain('private.can_see_avatar_file(name)');
    expect(list.find((p) => p.command === 'insert').body).toContain('private.can_set_avatar_file(name)');
    expect(list.find((p) => p.command === 'insert').body).toContain(PATTERN.replace(/^'|'$/g, ''));
    expect(list.find((p) => p.command === 'delete').body).toContain('private.can_set_avatar_file(name)');
    // at most 10 files in a folder, counted past the read policy
    expect(list.find((p) => p.command === 'insert').body).toContain('not private.avatar_folder_full(name)');
    expect(fn('private.avatar_folder_full')).toContain('>= 10');
  });

  test('every helper is closed to the public; the policy helpers are open to signed-in people only', () => {
    for (const sig of ['avatar_folder(text)', 'can_see_avatar_file(text)', 'can_set_avatar_file(text)', 'avatar_folder_full(text)', 'clean_text(text)', 'can_see_person(uuid)', 'can_set_avatar(uuid)']) {
      expect(sql, sig).toContain(`revoke execute on function private.${sig} from public;`);
    }
    for (const sig of ['can_see_avatar_file(text)', 'can_set_avatar_file(text)', 'avatar_folder_full(text)', 'can_see_person(uuid)', 'can_set_avatar(uuid)']) {
      expect(sql, sig).toContain(`grant execute on function private.${sig} to authenticated;`);
    }
  });

  test('the folder is checked against a uuid before it is cast', () => {
    const folder = fn('private.avatar_folder');
    expect(folder).toContain('(storage.foldername(p_name))[1]');
    expect(folder.indexOf("!~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'")).toBeLessThan(folder.indexOf('folder::uuid'));
  });
});

describe('set_avatar and person_cards', () => {
  test('set_avatar asks can_set_avatar, checks the path and that the file exists, and returns the old path', () => {
    const body = fn('public.set_avatar');
    expect(body).toContain('returns text');
    expect(body).toContain('security definer set search_path = \'\'');
    expect(body).toContain('not private.can_set_avatar(p_person)');
    expect(body).toContain("split_part(p_path, '/', 1) <> p_person::text");
    expect(body).toContain("from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path");
    expect(body).toContain('return v_old;');
    expect(sql).toContain('revoke execute on function public.set_avatar(uuid, text) from public, anon;');
    expect(sql).toContain('grant execute on function public.set_avatar(uuid, text) to authenticated;');
  });

  test('person_cards: at most 500, only people the caller may see', () => {
    const body = fn('public.person_cards');
    expect(body).toContain('returns table (id uuid, full_name text, role public.app_role, avatar_path text)');
    expect(body).toContain('> 500');
    expect(body).toContain('private.can_see_person(p.id)');
    expect(sql).toContain('revoke execute on function public.person_cards(uuid[]) from public, anon;');
  });
});

describe('the student profile', () => {
  test('save_student_profile never reads or writes the learning notes', () => {
    const body = fn('public.save_student_profile');
    expect(body).not.toContain('learning_notes');
    expect(body).toContain("errcode = '42501'");
    expect(body).toContain("private.has_role(p_student, 'student')");
    expect(body).toContain('private.can_teach(p_student)');
    expect(body).toContain('on conflict (student_id) do update');
    // a new row is stamped like an edit
    expect(body).toMatch(/updated_by, updated_at\)\s+values[\s\S]*auth\.uid\(\), now\(\)\)/);
    expect(sql).toContain('revoke execute on function public.save_student_profile(uuid, text, text, text, text, text, text, text) from public, anon;');
  });

  test('family_profile is recreated with the new fields, never learning notes or who saved it', () => {
    expect(sql).toContain('drop function public.family_profile(uuid);');
    const body = fn('public.family_profile');
    expect(body).toMatch(/returns table \(\s+grade_level text, school text, goals text, pronouns text, interests text,\s+favorite_subjects text, learning_style text, updated_at timestamptz\)/);
    expect(body).toContain('private.can_view_student(p_student)');
    expect(body).not.toMatch(/learning_notes|updated_by/);
    expect(sql).toContain('grant execute on function public.family_profile(uuid) to authenticated;');
  });

  test('staff keep writing the table directly, new columns included', () => {
    expect(sql).toContain('grant insert (pronouns, interests, favorite_subjects, learning_style) on public.student_profiles to authenticated;');
    expect(sql).toContain('grant update (pronouns, interests, favorite_subjects, learning_style) on public.student_profiles to authenticated;');
  });
});

describe('staff_profiles', () => {
  test('row level security, read through can_see_person, written by the person or the admin, never deleted', () => {
    expect(sql).toContain('alter table public.staff_profiles enable row level security;');
    const list = policies('public.staff_profiles');
    expect(list.map((p) => p.command).sort()).toEqual(['insert', 'select', 'update']);
    expect(list.find((p) => p.command === 'select').body).toContain('private.can_see_person(profile_id)');
    for (const p of list.filter((x) => x.command !== 'select')) {
      expect(p.body, p.name).toContain("profile_id = (select auth.uid()) and (select private.my_role()) in ('tutor', 'admin')");
      expect(p.body, p.name).toContain('(select private.is_admin())');
    }
  });

  test('profile_id has no update grant (the portal updates or inserts, never upserts)', () => {
    expect(sql).not.toMatch(/grant update \([^)]*profile_id[^)]*\) on public\.staff_profiles/);
    expect(readFileSync(fileURLToPath(new URL('../../portal/js/profile-data.js', import.meta.url)), 'utf8')).not.toContain('.upsert(');
  });

  test('exact grants, and a trigger that refuses anyone but a tutor or an admin', () => {
    expect(sql).toContain('revoke all on public.staff_profiles from anon, authenticated;');
    expect(sql).toContain('grant select on public.staff_profiles to authenticated;');
    expect(sql).toContain('grant insert (profile_id, bio, subjects, education, interests) on public.staff_profiles to authenticated;');
    expect(sql).toContain('grant update (bio, subjects, education, interests) on public.staff_profiles to authenticated;');
    expect(sql).not.toMatch(/grant [^;]*delete[^;]*on public\.staff_profiles to authenticated/);
    expect(fn('private.staff_profile_staff_only')).toContain("p.role in ('tutor', 'admin')");
    expect(sql).toContain('create trigger staff_profiles_staff_only before insert or update on public.staff_profiles');
    expect(sql).toContain('create trigger staff_profiles_touch before insert or update on public.staff_profiles');
  });

  test('not added to the realtime publication (the header says why)', () => {
    expect(sql).not.toMatch(/alter publication/);
    expect(sql).toContain('Realtime: staff_profiles is not added to the publication.');
  });
});

test('the migration has no em or en dashes', () => {
  expect(sql).not.toMatch(/[–—]/);
});
