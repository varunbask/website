import { sb } from './supabase.js';

export const HOME = {
  admin: '/portal/staff.html',
  tutor: '/portal/staff.html',
  student: '/portal/student.html',
  parent: '/portal/parent.html',
  pending: '/portal/index.html',
};

// The signed-in person's profile, or null when nobody is signed in
export async function currentProfile() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb.from('profiles')
    .select('id, email, full_name, role, requested_role')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const never = () => new Promise(() => {});

// Page guard: resolves with the profile if its role may see this page, otherwise redirects
export async function requireRole(allowed) {
  let profile = null;
  try {
    profile = await currentProfile();
  } catch {
    /* treated as signed out */
  }
  if (!profile) {
    location.replace('/portal/index.html');
    return never();
  }
  if (!allowed.includes(profile.role)) {
    location.replace(HOME[profile.role] ?? '/portal/index.html');
    return never();
  }
  // A session that ends while the page is open (expired refresh token, sign-out
  // in another tab) goes back to sign-in instead of failing every request
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') location.replace('/portal/index.html');
  });
  return profile;
}

export async function signOut() {
  await sb.auth.signOut();
  location.replace('/portal/index.html');
}
