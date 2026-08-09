const STARTED_KEY = 'dashboard_session_started_at';
const ACTIVITY_KEY = 'dashboard_session_last_activity_at';
const OWNER_KEY = 'dashboard_session_owner';
const AUTH_SESSION_KEY = 'dashboard_auth_session_id';

function storageOrNull(storage) {
  return storage || (typeof localStorage !== 'undefined' ? localStorage : null);
}

function decodeJwtPayload(token = '') {
  try {
    const encoded = String(token).split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(normalized));
  } catch {
    return null;
  }
}

export function dashboardAuthSessionIdentity(session) {
  const userId = String(session?.user?.id || '').trim();
  if (!userId) return { userId: '', sessionId: '' };
  const claims = decodeJwtPayload(session?.access_token);
  return { userId, sessionId: String(claims?.session_id || '').trim() };
}

export function resetDashboardSessionLifecycle(storage, now = Date.now(), session = null) {
  const target = storageOrNull(storage);
  if (!target) return null;
  const { userId, sessionId } = dashboardAuthSessionIdentity(session);
  target.setItem(STARTED_KEY, String(now));
  target.setItem(ACTIVITY_KEY, String(now));
  if (userId) target.setItem(OWNER_KEY, userId); else target.removeItem(OWNER_KEY);
  if (sessionId) target.setItem(AUTH_SESSION_KEY, sessionId); else target.removeItem(AUTH_SESSION_KEY);
  return { startedAt: now, lastActivityAt: now };
}

export function clearDashboardSessionLifecycle(storage) {
  const target = storageOrNull(storage);
  if (!target) return;
  [STARTED_KEY, ACTIVITY_KEY, OWNER_KEY, AUTH_SESSION_KEY].forEach((key) => target.removeItem(key));
}

export function reconcileDashboardSessionLifecycle(session, { storage, now = Date.now(), event = '' } = {}) {
  const target = storageOrNull(storage);
  if (!target) return null;
  if (!session?.user?.id || event === 'SIGNED_OUT') {
    clearDashboardSessionLifecycle(target);
    return null;
  }
  const { userId, sessionId } = dashboardAuthSessionIdentity(session);
  const ownerChanged = target.getItem(OWNER_KEY) !== userId;
  const storedSessionId = target.getItem(AUTH_SESSION_KEY) || '';
  const authSessionChanged = Boolean(sessionId && storedSessionId && sessionId !== storedSessionId);
  const missingTimestamps = !Number(target.getItem(STARTED_KEY)) || !Number(target.getItem(ACTIVITY_KEY));
  if (event === 'SIGNED_IN' || ownerChanged || authSessionChanged || missingTimestamps) {
    return resetDashboardSessionLifecycle(target, now, session);
  }
  // A refresh keeps the Supabase session_id, so it must not extend the absolute timeout.
  if (sessionId && !storedSessionId) target.setItem(AUTH_SESSION_KEY, sessionId);
  return {
    startedAt: Number(target.getItem(STARTED_KEY)),
    lastActivityAt: Number(target.getItem(ACTIVITY_KEY))
  };
}

export function isSupabaseSessionExpiredError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || error || '').toLowerCase();
  return status === 401
    || ['jwt_expired', 'bad_jwt', 'refresh_token_not_found'].includes(code)
    || /(jwt|token|session).*(expired|invalid|missing)|refresh token.*(not found|invalid)/i.test(message);
}

