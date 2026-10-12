import { supabase } from './supabase';
import { useNavigationStore, type UserProfile } from '../stores/navigationStore';

export const DESKTOP_LOGIN_ROLES = new Set(['admin', 'superadmin', 'viewer']);

export interface RpcProfileRow {
  id: string;
  factory_id: string | null;
  full_name: string | null;
  email: string | null;
  user_role: string;
  status: string;
  assigned_apps?: unknown;
}

function parseAssignedApps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

export function parseMyProfile(data: unknown): RpcProfileRow | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as RpcProfileRow;
  if (!row.id) return null;
  return row;
}

export function profileToUserProfile(profile: RpcProfileRow, fallbackEmail: string): UserProfile {
  return {
    id: profile.id,
    fullName: profile.full_name || fallbackEmail.split('@')[0],
    email: profile.email || fallbackEmail,
    userRole: profile.user_role || 'viewer',
    assignedApps: parseAssignedApps(profile.assigned_apps),
  };
}

/** Returns an error message when this profile may not use the desktop app. */
export function desktopAccessError(profile: RpcProfileRow): string | null {
  if (!profile.factory_id) {
    return 'No factory assigned to this account. Contact RBC support.';
  }
  if (profile.status !== 'Active') {
    return 'Your account is inactive. Contact your administrator.';
  }
  if (!DESKTOP_LOGIN_ROLES.has(profile.user_role)) {
    return 'This account is for the floor mobile app. Sign in there with email and PIN, or ask for a desktop viewer account.';
  }
  return null;
}

export async function fetchMyProfile(): Promise<{ profile: RpcProfileRow | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_my_profile');
  if (error) {
    const isNotFound = error.code === 'PGRST116';
    const message = isNotFound
      ? 'No user profile found for this account. Contact RBC support.'
      : error.message.includes('recursion')
        ? 'Account setup error. Contact RBC support.'
        : error.message || 'Could not load your profile.';
    return { profile: null, error: message };
  }
  const profile = parseMyProfile(data);
  if (!profile) {
    return { profile: null, error: 'No user profile found for this account. Contact RBC support.' };
  }
  return { profile, error: null };
}

export async function debugJwtClaims(): Promise<void> {
  if (!import.meta.env.DEV) return;
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) { console.warn('[AUTH] No JWT found'); return; }
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1]));
    console.log('[AUTH] JWT claims:', {
      sub: payload.sub,
      role: payload.role,
      factory_id: payload.factory_id,
      user_role: payload.user_role,
      app_metadata: payload.app_metadata,
      user_metadata: payload.user_metadata,
    });
    if (!payload.factory_id) {
      console.warn('[AUTH] ⚠️ factory_id is MISSING from JWT — RLS will block all factory-scoped tables');
    }
  } catch (e) {
    console.warn('[AUTH] Could not decode JWT', e);
  }
}

export function applyAuthenticatedProfile(profile: RpcProfileRow, emailFallback: string): void {
  const store = useNavigationStore.getState();
  store.setAuthenticated(true);
  store.setFactoryId(profile.factory_id);
  store.setUserProfile(profileToUserProfile(profile, emailFallback));
  console.log('[AUTH] Profile applied — factory_id:', profile.factory_id, 'role:', profile.user_role);
  debugJwtClaims();
}

export function clearAuthenticatedSession(): void {
  const store = useNavigationStore.getState();
  store.setAuthenticated(false);
  store.setFactoryId(null);
  store.setUserProfile(null);
}

/** Validate Supabase session + desktop profile; sync navigation store. */
export async function restoreAuthSession(): Promise<boolean> {
  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) {
    clearAuthenticatedSession();
    return false;
  }

  const { profile, error } = await fetchMyProfile();
  if (error || !profile) {
    await supabase.auth.signOut();
    clearAuthenticatedSession();
    return false;
  }

  const accessError = desktopAccessError(profile);
  if (accessError) {
    await supabase.auth.signOut();
    clearAuthenticatedSession();
    return false;
  }

  applyAuthenticatedProfile(profile, session.user.email || '');
  return true;
}

export async function logoutDesktopSession(): Promise<void> {
  clearAuthenticatedSession();
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) console.warn('[AUTH] signOut', error.message);
  void supabase.auth.signOut({ scope: 'global' }).catch(() => {});
}
