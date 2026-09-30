// Deletes throwaway accounts left behind by a crashed RLS run.
import { serviceClient, hasService, EMAIL_PATTERN, removeUser } from './world.js';

if (!hasService) {
  console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env first.');
  process.exit(1);
}

const admin = serviceClient();
const leftovers = [];
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  leftovers.push(...data.users.filter((u) => EMAIL_PATTERN.test(u.email ?? '')));
  if (data.users.length < 200) break;
}
for (const user of leftovers) await removeUser(admin, user.id);
console.log(`Removed ${leftovers.length} leftover test account(s).`);
