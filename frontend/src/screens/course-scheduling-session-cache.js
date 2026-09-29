const KEY = 'scheduling-screen-session-v1';
const MAX_AGE = 8 * 60 * 60 * 1000;

export function readSchedulingSessionCache(identity, storage = globalThis.sessionStorage, now = Date.now()) {
  if (!identity?.userId || !identity?.sessionId) return null;
  try {
    const entry = JSON.parse(storage?.getItem(KEY) || 'null');
    if (!entry || entry.userId !== identity.userId || entry.sessionId !== identity.sessionId
      || now < entry.savedAt || now - entry.savedAt > MAX_AGE) return null;
    return entry.data;
  } catch { return null; }
}

export function writeSchedulingSessionCache(identity, data, storage = globalThis.sessionStorage, now = Date.now()) {
  if (!identity?.userId || !identity?.sessionId || !data) return;
  try {
    // Runtime flags/functions must not survive a page reload. No access token is stored.
    const snapshot = Object.fromEntries(Object.entries(data).filter(([key, value]) =>
      (!key.startsWith('_') || key === '_planningShared') && typeof value !== 'function'));
    storage?.setItem(KEY, JSON.stringify({ ...identity, savedAt: now, data: snapshot }));
  } catch { /* A full/disabled storage must never interrupt scheduling. */ }
}

export function schedulingSessionIdentity(session) {
  if (!session?.user?.id) return null;
  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
    return payload.session_id ? { userId: session.user.id, sessionId: String(payload.session_id) } : null;
  } catch { return null; }
}
