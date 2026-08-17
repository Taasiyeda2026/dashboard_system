export const DASHBOARD_SESSION_STARTED_KEY = 'dashboard_session_started_at';
export const DASHBOARD_LAST_ACTIVITY_KEY = 'dashboard_session_last_activity_at';
export const DASHBOARD_SESSION_OWNER_KEY = 'dashboard_session_owner';
export const DASHBOARD_AUTH_SESSION_KEY = 'dashboard_auth_session_id';

function storageValue(storage, key) {
  try { return String(storage?.getItem?.(key) || '').trim(); } catch { return ''; }
}

function jwtSessionId(accessToken = '') {
  const payload = String(accessToken).split('.')[1];
  if (!payload) return '';
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = typeof atob === 'function'
      ? atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
      : globalThis.Buffer?.from(normalized, 'base64').toString('utf8');
    const claims = JSON.parse(decoded || '{}');
    return String(claims.session_id || claims.sid || '').trim();
  } catch {
    return '';
  }
}

export function authSessionIdentity(session = {}) {
  return {
    owner: String(session?.user?.id || '').trim(),
    sessionId: jwtSessionId(session?.access_token)
      || String(session?.user?.last_sign_in_at || '').trim()
  };
}

export function clearDashboardSessionLifecycle(storage = globalThis.localStorage) {
  try {
    storage?.removeItem?.(DASHBOARD_SESSION_STARTED_KEY);
    storage?.removeItem?.(DASHBOARD_LAST_ACTIVITY_KEY);
    storage?.removeItem?.(DASHBOARD_SESSION_OWNER_KEY);
    storage?.removeItem?.(DASHBOARD_AUTH_SESSION_KEY);
  } catch { /* storage can be unavailable */ }
}

export function startDashboardSession(session, {
  storage = globalThis.localStorage,
  now = Date.now(),
  force = false
} = {}) {
  const { owner, sessionId } = authSessionIdentity(session);
  const previousOwner = storageValue(storage, DASHBOARD_SESSION_OWNER_KEY);
  const previousSessionId = storageValue(storage, DASHBOARD_AUTH_SESSION_KEY);
  const hasTimestamps = Boolean(
    Number(storageValue(storage, DASHBOARD_SESSION_STARTED_KEY))
    && Number(storageValue(storage, DASHBOARD_LAST_ACTIVITY_KEY))
  );
  const changed = force
    || (owner && previousOwner && owner !== previousOwner)
    || (sessionId && previousSessionId && sessionId !== previousSessionId)
    || !hasTimestamps;

  try {
    if (changed) {
      storage?.setItem?.(DASHBOARD_SESSION_STARTED_KEY, String(now));
      storage?.setItem?.(DASHBOARD_LAST_ACTIVITY_KEY, String(now));
    }
    if (owner) storage?.setItem?.(DASHBOARD_SESSION_OWNER_KEY, owner);
    if (sessionId) storage?.setItem?.(DASHBOARD_AUTH_SESSION_KEY, sessionId);
  } catch { /* storage can be unavailable */ }
  return changed;
}

export function applyDashboardAuthEvent(event, session, options = {}) {
  if (event === 'SIGNED_OUT') {
    clearDashboardSessionLifecycle(options.storage);
    return 'cleared';
  }
  if (!session?.user?.id || !['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED'].includes(event)) return 'ignored';
  // A refresh belonging to the same auth session deliberately preserves started_at.
  return startDashboardSession(session, options) ? 'started' : 'preserved';
}
