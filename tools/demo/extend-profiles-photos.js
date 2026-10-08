/* Demo extension: profiles and photos (supabase/migrations/
   20261025120000_profiles_and_photos.sql). Loaded by the local demo build right
   after demo-supabase.js. A simplified mirror of the real rules:

     can_see_person      yourself, the admin, staff to staff, a student you may see,
                         a parent of one, a tutor of one (families see their tutors)
     avatars bucket      read by whoever may see the person; added and removed by
                         the person, the admin or a parent of a student
     set_avatar          the old path back; the file must have been uploaded first
     person_cards        id, name, role and photo path of people you may see
     save_student_profile, family_profile   the seven family fields, never learning notes
     staff_profiles      read through can_see_person, written by the person or the admin

   The rpc calls and the avatars bucket are answered by wrapping the demo
   client, so these answers win over extend-student-profile.js (which loads
   after this file and has a three-field family_profile).

   Try it
     ?as=student2  Leo Park: "Finish your profile" on Overview, a dot on Profile
     ?as=parent2   Jin Park: "Help us get to know Leo"
     ?as=tutor2    Priya Shah: "Finish your tutor profile" on Today
     ?as=admin     the same on Today; photos on People, Students and Review
     ?as=student   Maya Lin: a finished profile with a photo; Daniel's photo and bio under Your tutors
     ?as=tutor     Daniel Ortiz: a finished tutor profile with a photo */
(function () {
  'use strict';
  if (!window.portalDemo || !window.supabase) return;
  const { db, helpers: h } = window.portalDemo;
  const client = window.supabase.createClient();

  // ---------------------------------------------------------------------------
  // Sample photos: small drawn portraits (SVG), no real people

  const portrait = (bg, skin, hair, shirt) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="${bg}"/>`
    + `<path d="M40 256c6-52 44-80 88-80s82 28 88 80z" fill="${shirt}"/>`
    + `<rect x="110" y="150" width="36" height="36" rx="12" fill="${skin}"/>`
    + `<circle cx="128" cy="112" r="50" fill="${skin}"/>`
    + `<path d="M76 108c0-38 24-58 52-58s54 20 54 58c-10-18-28-28-54-28s-42 10-52 28z" fill="${hair}"/>`
    + '<circle cx="110" cy="116" r="5" fill="#2b2b2b"/><circle cx="146" cy="116" r="5" fill="#2b2b2b"/>'
    + '<path d="M112 138c10 8 22 8 32 0" stroke="#2b2b2b" stroke-width="4" fill="none" stroke-linecap="round"/></svg>',
  )}`;

  const files = new Map([
    ['u-maya/MayaLinPhoto0001.webp', portrait('#cfe3f5', '#e9b99a', '#2d1f1a', '#3a7bd5')],
    ['u-daniel/DanielOrtiz00001.webp', portrait('#d9f0e3', '#c68d6a', '#1d1d1d', '#2f8f6f')],
    ['u-grace/GraceLinPhoto001.webp', portrait('#f6e1ea', '#efc3a4', '#3b2a22', '#b0476f')],
  ]);
  const blobUrls = new Map();   // path -> object URL of a photo uploaded in this visit

  for (const p of db.profiles) p.avatar_path = p.avatar_path ?? null;
  const setPath = (id, path) => {
    const p = db.profiles.find((x) => x.id === id);
    if (p) p.avatar_path = path;
  };
  setPath('u-maya', 'u-maya/MayaLinPhoto0001.webp');
  setPath('u-daniel', 'u-daniel/DanielOrtiz00001.webp');
  setPath('u-grace', 'u-grace/GraceLinPhoto001.webp');

  // ---------------------------------------------------------------------------
  // Who may see whom

  const roleOf = (id) => db.profiles.find((x) => x.id === id)?.role ?? null;
  const canSeePerson = (id) => {
    const role = roleOf(id);
    if (!id || !role) return false;
    if (id === h.meId || h.role() === 'admin') return true;
    if (h.isStaff() && ['tutor', 'admin'].includes(role)) return true;
    if (role === 'student') return h.canSee(id);
    if (role === 'parent') return db.parent_students.some((l) => l.parent_id === id && h.canSee(l.student_id));
    if (['tutor', 'admin'].includes(role)) return db.tutor_students.some((l) => l.tutor_id === id && h.canSee(l.student_id));
    return false;
  };
  const canSetAvatar = (id) => Boolean(id) && (id === h.meId || h.role() === 'admin'
    || (h.role() === 'parent' && roleOf(id) === 'student' && h.childOf(id)));
  const folderOf = (path) => String(path ?? '').split('/')[0];

  // ---------------------------------------------------------------------------
  // The profiles: Maya finished, Leo half done (no school, no hobbies)

  const FAMILY = ['grade_level', 'school', 'pronouns', 'interests', 'favorite_subjects', 'goals', 'learning_style'];
  const clean = (v) => {
    const t = String(v ?? '').replace(/^\s+|\s+$/g, '');
    return t === '' ? null : t;
  };
  let seeded = false;
  function seed() {
    if (seeded) return;
    seeded = true;
    if (!db.student_profiles) db.student_profiles = [];
    const maya = db.student_profiles.find((r) => r.student_id === 'u-maya');
    const extra = {
      pronouns: 'she/her',
      interests: 'Volleyball, sketching, and baking with my mom on weekends.',
      favorite_subjects: 'Biology and art',
      learning_style: 'A worked example first, then one on my own. Drawing a picture helps.',
    };
    if (maya) Object.assign(maya, extra);
    else {
      db.student_profiles.push({
        student_id: 'u-maya', grade_level: '9th grade', school: 'Arcadia High School', goals: 'Raise my algebra grade to an A.',
        learning_notes: null, updated_by: 'u-maya', updated_at: h.ago(3), ...extra,
      });
    }
    if (!db.student_profiles.some((r) => r.student_id === 'u-leo')) {
      db.student_profiles.push({
        student_id: 'u-leo', grade_level: '8th grade', school: null, pronouns: null, interests: null, favorite_subjects: 'PE',
        goals: null, learning_style: null, learning_notes: null, updated_by: 'u-daniel', updated_at: h.ago(6),
      });
    }
    for (const r of db.student_profiles) for (const k of FAMILY) if (!(k in r)) r[k] = null;
  }
  document.addEventListener('DOMContentLoaded', seed);

  window.portalDemo.extend({
    tables: {
      staff_profiles: {
        keys: ['profile_id'],
        rows: () => [{
          profile_id: 'u-daniel',
          bio: 'I have tutored middle and high school math for six years. I like finding the one explanation that makes it click, and I always start with something you can already do.',
          subjects: 'Algebra, Geometry, SAT Math',
          education: 'UCLA, Mathematics',
          interests: 'Rock climbing, chess and making pizza from scratch.',
          updated_at: h.ago(9),
        }],
        read: (r) => canSeePerson(r.profile_id),
        insert: (r) => (r.profile_id === h.meId && h.isStaff()) || h.role() === 'admin',
        write: (r) => {
          if (!((r.profile_id === h.meId && h.isStaff()) || h.role() === 'admin')) return false;
          r.updated_at = new Date().toISOString();
          return true;
        },
        defaults: () => ({ updated_at: new Date().toISOString(), bio: null, subjects: null, education: null, interests: null }),
      },
    },
  });

  // ---------------------------------------------------------------------------
  // rpc: wrap the client so these answer first

  const wait = () => new Promise((r) => setTimeout(r, 60));
  const deny = (message) => ({ data: null, error: { code: '42501', message } });
  const familyRow = (row) => (row ? {
    grade_level: row.grade_level ?? null, school: row.school ?? null, goals: row.goals ?? null, pronouns: row.pronouns ?? null,
    interests: row.interests ?? null, favorite_subjects: row.favorite_subjects ?? null, learning_style: row.learning_style ?? null,
    updated_at: row.updated_at ?? null,
  } : null);

  const handlers = {
    person_cards(args) {
      const ids = args.p_ids ?? [];
      if (ids.length > 500) return { data: null, error: { code: '22023', message: 'ask for at most 500 people at a time' } };
      const rows = db.profiles.filter((p) => ids.includes(p.id) && canSeePerson(p.id))
        .map((p) => ({ id: p.id, full_name: p.full_name, role: p.role, avatar_path: p.avatar_path ?? null }));
      return { data: rows, error: null };
    },
    set_avatar(args) {
      const id = args.p_person;
      if (!canSetAvatar(id)) return deny('you may not change this photo');
      const person = db.profiles.find((p) => p.id === id);
      if (!person) return { data: null, error: { code: 'P0002', message: 'person not found' } };
      const path = args.p_path ?? null;
      if (path !== null) {
        if (folderOf(path) !== id || !/^[^/]+\/[A-Za-z0-9_-]{8,64}\.(webp|jpg|png)$/.test(path)) {
          return { data: null, error: { code: '22023', message: 'not a photo path for this person' } };
        }
        if (!files.has(path) && !blobUrls.has(path)) return { data: null, error: { code: 'P0002', message: 'upload the photo first' } };
      }
      const old = person.avatar_path ?? null;
      person.avatar_path = path;
      window.portalDemo.notify();
      return { data: old, error: null };
    },
    family_profile(args) {
      seed();
      if (!h.canSee(args.p_student)) return { data: [], error: null };
      const row = db.student_profiles.find((r) => r.student_id === args.p_student);
      return { data: row ? [familyRow(row)] : [], error: null };
    },
    save_student_profile(args) {
      seed();
      const id = args.p_student;
      const allowed = (h.role() === 'student' && id === h.meId) || (h.role() === 'parent' && h.childOf(id)) || h.canTeach(id);
      if (!id || !allowed) return deny('you may not change this profile');
      if (roleOf(id) !== 'student') return { data: null, error: { code: '22023', message: 'a profile is for a student' } };
      let row = db.student_profiles.find((r) => r.student_id === id);
      if (!row) {
        row = { student_id: id, learning_notes: null };
        db.student_profiles.push(row);
      }
      for (const k of FAMILY) row[k] = clean(args[`p_${k}`]);
      row.updated_by = h.meId;
      row.updated_at = new Date().toISOString();
      window.portalDemo.notify();
      return { data: [familyRow(row)], error: null };
    },
  };

  const rpc = client.rpc;
  client.rpc = async (name, args = {}) => {
    if (!handlers[name]) return rpc(name, args);
    await wait();
    if (!h.meId) return deny('permission denied');
    return handlers[name](args);
  };

  // ---------------------------------------------------------------------------
  // The avatars bucket

  const fromBucket = client.storage.from;
  const avatars = {
    async upload(path, body) {
      await new Promise((r) => setTimeout(r, 300));
      if (!canSetAvatar(folderOf(path))) return { data: null, error: { statusCode: '403', message: 'new row violates row-level security policy' } };
      if (files.has(path) || blobUrls.has(path)) return { data: null, error: { statusCode: '409', message: 'The resource already exists' } };
      if (!(body instanceof Blob) || body.size > 1048576) return { data: null, error: { statusCode: '413', message: 'Payload too large' } };
      blobUrls.set(path, URL.createObjectURL(body));
      return { data: { path }, error: null };
    },
    async createSignedUrls(paths) {
      await wait();
      return {
        data: paths.map((path) => {
          const url = blobUrls.get(path) ?? files.get(path) ?? null;
          return url && canSeePerson(folderOf(path))
            ? { path, signedUrl: url, error: null }
            : { path, signedUrl: null, error: 'Object not found' };
        }),
        error: null,
      };
    },
    async createSignedUrl(path) {
      const { data } = await avatars.createSignedUrls([path]);
      return data[0].signedUrl ? { data: { signedUrl: data[0].signedUrl }, error: null } : { data: null, error: { message: 'Object not found' } };
    },
    async remove(paths) {
      await wait();
      const gone = [];
      for (const path of paths) {
        if (!canSetAvatar(folderOf(path))) continue;
        if (blobUrls.has(path)) {
          URL.revokeObjectURL(blobUrls.get(path));
          blobUrls.delete(path);
          gone.push(path);
        } else if (files.delete(path)) gone.push(path);
      }
      return { data: gone.map((name) => ({ name })), error: null };
    },
  };
  client.storage.from = (bucket) => (bucket === 'avatars' ? avatars : fromBucket(bucket));
})();
