import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  /* no .env: the suite skips itself */
}

export const env = {
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
export const hasService = Boolean(env.url && env.anonKey && env.serviceKey);
export const EMAIL_PATTERN = /^rls-[a-z0-9]+-[a-z]+@example\.com$/;

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
export const serviceClient = () => createClient(env.url, env.serviceKey, noSession);
export const anonClient = () => createClient(env.url, env.anonKey, noSession);
export const txt = (text) => Buffer.from(text, 'utf8');

const ROLES = {
  admin: 'admin',
  tutorA: 'tutor',
  tutorB: 'tutor',
  studentA: 'student',
  studentB: 'student',
  parentA: 'parent',
  pending: 'pending',
};

function must({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// Removes a user's homework files, then the user (the database cascades the rest)
export async function removeUser(admin, userId) {
  const bucket = admin.storage.from('homework');
  const { data: files } = await bucket.list(userId, { limit: 1000 });
  if (files?.length) await bucket.remove(files.map((f) => `${userId}/${f.name}`));
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`deleteUser ${userId}: ${error.message}`);
}

export async function buildWorld() {
  const admin = serviceClient();
  const run = `rls-${Date.now().toString(36)}`;
  const people = {};

  for (const [name, role] of Object.entries(ROLES)) {
    const email = `${run}-${name.toLowerCase()}@example.com`;
    const password = randomUUID();
    const data = must(await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // role hints a user could forge; the trigger must ignore them
      user_metadata: { full_name: `Test ${name}`, requested_role: 'admin', role: 'admin', signup_note: 'rls test' },
    }), `createUser ${name}`);
    people[name] = { id: data.user.id, email, password, role };
  }

  for (const p of Object.values(people)) {
    if (p.role === 'pending') continue;
    must(await admin.from('profiles').update({ role: p.role }).eq('id', p.id), `set role ${p.email}`);
  }
  must(await admin.from('tutor_students').insert({ tutor_id: people.tutorA.id, student_id: people.studentA.id }), 'link tutor');
  must(await admin.from('parent_students').insert({ parent_id: people.parentA.id, student_id: people.studentA.id }), 'link parent');

  const task = async (student, kind, title) => must(await admin.from('tasks')
    .insert({ student_id: student.id, created_by: people.tutorA.id, kind, title, due_at: new Date(Date.now() + 7 * 86400000).toISOString() })
    .select('id').single(), `task ${title}`).id;
  const update = async (student, body, visible) => must(await admin.from('updates')
    .insert({ student_id: student.id, author_id: people.tutorA.id, body, visible_to_student: visible })
    .select('id').single(), `update ${body}`).id;
  const file = async (student, text) => {
    const path = `${student.id}/${randomUUID()}.txt`;
    must(await admin.storage.from('homework').upload(path, txt(text), { contentType: 'text/plain' }), `upload ${path}`);
    return path;
  };

  const seed = {
    A1: await task(people.studentA, 'assignment', 'Seed assignment'),
    T1: await task(people.studentA, 'task', 'Seed task'),
    B1: await task(people.studentB, 'assignment', 'Other student assignment'),
    U1: await update(people.studentA, 'For parents only', false),
    U2: await update(people.studentA, 'Shared with the student', true),
    U3: await update(people.studentB, 'Other student update', true),
    aFile: await file(people.studentA, 'x = 4'),
    bFile: await file(people.studentB, 'y = 2'),
  };
  seed.SA1 = must(await admin.from('submissions')
    .insert({ student_id: people.studentA.id, task_id: seed.A1, storage_path: seed.aFile, file_type: 'text/plain' })
    .select('id').single(), 'seed submission').id;

  for (const p of Object.values(people)) {
    const client = anonClient();
    must(await client.auth.signInWithPassword({ email: p.email, password: p.password }), `sign in ${p.email}`);
    p.client = client;
  }

  return {
    admin,
    people,
    seed,
    cleanup: async () => {
      for (const p of Object.values(people)) await removeUser(admin, p.id);
    },
  };
}
