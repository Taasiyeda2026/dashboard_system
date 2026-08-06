import { state } from './state.js';
import { SCREEN_CACHE_STORAGE_PREFIX } from './cache-persist.js';
import { supabase } from './supabase-client.js';

const ROUTES_KEY = 'dashboard_routes';
const USER_KEY = 'dashboard_user';
const TOKEN_KEY = 'dashboard_token';
const SESSION_MARKER_KEY = 'ds_session_alive';
const SCREEN_CACHE_PREFIXES = [
  SCREEN_CACHE_STORAGE_PREFIX,
  'dashboard_screen_cache_v1',
  'dashboard_screen_cache:'
];
const RELOAD_GUARD_KEY = 'dashboard_auth_reconcile_reload';
const INITIAL_SESSION_RETRY_MS = 1800;
const CROSS_TAB_RELOAD_DELAY_MS = 300;
let reloadScheduled = false;

function safeJsonParse(value) {
  try { return JSON.parse(String(value || 'null')); } catch { return null; }
}

export function dashboardIdentity(user = {}) {
  return {
    userId: String(user?.user_id || user?.emp_id || '').trim(),
    authUserId: String(user?.auth_user_id || '').trim()
  };
}

function storedDashboardUser() {
  return safeJsonParse(localStorage.getItem(USER_KEY)) || null;
}

function identitiesDiffer(left = {}, right = {}) {
  const a = dashboardIdentity(left);
  const b = dashboardIdentity(right);
  if (a.authUserId && b.authUserId) return a.authUserId !== b.authUserId;
  if (a.userId && b.userId) return a.userId !== b.userId;
  return false;
}

export function clearUserScopedDashboardCaches() {
  try {
    localStorage.removeItem(ROUTES_KEY);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (SCREEN_CACHE_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore storage failures */
  }
}

function scheduleReload(reason = 'auth_identity_changed') {
  if (reloadScheduled || typeof window === 'undefined') return;
  reloadScheduled = true;
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, reason);
  } catch {
    /* ignore */
  }
  setTimeout(() => window.location.reload(), CROSS_TAB_RELOAD_DELAY_MS);
}

function clearLocalDashboardIdentity() {
  clearUserScopedDashboardCaches();
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(SESSION_MARKER_KEY);
  } catch {
    /* ignore */
  }
}

export function reconcileDashboardIdentityWithAuthSession(session, { allowIdentityClear = true } = {}) {
  const actualAuthUserId = String(session?.user?.id || '').trim();
  const currentUser = state?.user || null;
  const storedUser = storedDashboardUser();
  const currentIdentity = dashboardIdentity(currentUser || {});
  const storedIdentity = dashboardIdentity(storedUser || {});

  if (!actualAuthUserId) {
    if (state?.token || localStorage.getItem(TOKEN_KEY)) {
      if (allowIdentityClear) clearLocalDashboardIdentity();
      else clearUserScopedDashboardCaches();
      scheduleReload('auth_session_missing');
      return false;
    }
    return true;
  }

  if (currentIdentity.authUserId && currentIdentity.authUserId !== actualAuthUserId) {
    clearUserScopedDashboardCaches();
    if (allowIdentityClear && storedIdentity.authUserId !== actualAuthUserId) {
      clearLocalDashboardIdentity();
    }
    scheduleReload(storedIdentity.authUserId === actualAuthUserId
      ? 'auth_user_changed_in_other_tab'
      : 'auth_user_mismatch');
    return false;
  }

  if (storedIdentity.authUserId && storedIdentity.authUserId !== actualAuthUserId) {
    if (allowIdentityClear) clearLocalDashboardIdentity();
    else clearUserScopedDashboardCaches();
    scheduleReload('stored_auth_user_mismatch');
    return false;
  }

  return true;
}

async function reconcileInitialAuthSession() {
  if (!supabase) return;
  try {
    const first = await supabase.auth.getSession();
    if (first?.data?.session?.user?.id) {
      reconcileDashboardIdentityWithAuthSession(first.data.session);
      return;
    }
    if (!state?.token && !localStorage.getItem(TOKEN_KEY)) return;
    setTimeout(async () => {
      try {
        const retry = await supabase.auth.getSession();
        reconcileDashboardIdentityWithAuthSession(retry?.data?.session || null);
      } catch {
        /* A later auth event or normal bootstrap will resolve transient failures. */
      }
    }, INITIAL_SESSION_RETRY_MS);
  } catch {
    /* A later auth event or normal bootstrap will resolve transient failures. */
  }
}

function handleStorageChange(event) {
  if (!event || ![USER_KEY, TOKEN_KEY].includes(event.key)) return;

  if (event.key === TOKEN_KEY && !event.newValue) {
    clearUserScopedDashboardCaches();
    scheduleReload('signed_out_in_other_tab');
    return;
  }

  if (event.key === USER_KEY) {
    const nextUser = safeJsonParse(event.newValue);
    if (!nextUser) {
      clearUserScopedDashboardCaches();
      scheduleReload('user_cleared_in_other_tab');
      return;
    }
    if (state?.user && identitiesDiffer(state.user, nextUser)) {
      clearUserScopedDashboardCaches();
      scheduleReload('user_changed_in_other_tab');
    }
  }
}

function bindLogoutToSupabase() {
  if (typeof document === 'undefined' || !supabase) return;
  document.addEventListener('click', (event) => {
    const logoutButton = event.target?.closest?.('#logoutBtn, .shell-logout-btn--mobile');
    if (!logoutButton) return;
    supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }, true);
}

export function installAuthSessionIsolation() {
  if (typeof window === 'undefined') return false;
  if (window.__dashboardAuthSessionIsolationInstalled) return false;
  window.__dashboardAuthSessionIsolationInstalled = true;

  try { sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch { /* ignore */ }
  clearUserScopedDashboardCachesIfOwnerUnknown();
  window.addEventListener('storage', handleStorageChange);
  bindLogoutToSupabase();

  if (supabase) {
    reconcileInitialAuthSession();

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        if (state?.token || localStorage.getItem(TOKEN_KEY)) {
          clearLocalDashboardIdentity();
          scheduleReload('supabase_signed_out');
        }
        return;
      }
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && session?.user?.id) {
        reconcileDashboardIdentityWithAuthSession(session, { allowIdentityClear: false });
      }
    });
  }

  return true;
}

export function clearUserScopedDashboardCachesIfOwnerUnknown() {
  const snapshot = safeJsonParse(localStorage.getItem(ROUTES_KEY));
  if (!snapshot) return false;
  const storedUser = storedDashboardUser();
  if (!storedUser) {
    clearUserScopedDashboardCaches();
    return true;
  }
  return false;
}

installAuthSessionIsolation();
