import { sb } from './supabase.js';

export const HOME = {
  admin: '/portal/staff.html',
  tutor: '/portal/staff.html',
  student: '/portal/student.html',
  parent: '/portal/parent.html',
  pending: '/portal/index.html',
};

const NAV = {
  admin: [['/portal/staff.html', 'Students'], ['/portal/people.html', 'People']],
  tutor: [['/portal/staff.html', 'Students']],
  student: [['/portal/student.html', 'My work']],
  parent: [['/portal/parent.html', 'Dashboard']],
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
  return profile;
}

export async function signOut() {
  await sb.auth.signOut();
  location.replace('/portal/index.html');
}

// Fills the app-page header: role links, the person's name, and Sign out
export function mountHeader(profile) {
  const nav = document.getElementById('portal-nav');
  nav.replaceChildren(...(NAV[profile.role] ?? []).map(([href, label]) => {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = label;
    if (location.pathname === href) link.setAttribute('aria-current', 'page');
    return link;
  }));
  document.getElementById('portal-user').textContent = profile.full_name || profile.email;
  document.getElementById('sign-out').addEventListener('click', signOut);
}
