import { compactPlanningWorkspace } from './course-scheduling-display-data.js';
const KEY = 'scheduling-screen-session-v2';
import { serializeSchedulingCacheEntry } from './course-scheduling-cache-serialization.js';
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

function cacheSnapshot(identity, data) {
  // Runtime flags/functions must not survive a page reload. No access token is stored.
  const snapshot = Object.fromEntries(Object.entries(data).filter(([key, value]) =>
    (!key.startsWith('_') || key === '_planningShared') && typeof value !== 'function'));
  snapshot._planningShared = compactPlanningWorkspace(snapshot._planningShared);
  // Persist identity only, even if a caller passes a complete auth session.
  if (snapshot.authSession) snapshot.authSession = { user: { id: identity.userId }, sessionId: identity.sessionId };
  if (snapshot._planningShared) snapshot._planningShared.rows = snapshot._planningShared.rows.map(entry => ({ ...entry, row: { ...entry.row, options: [], packingOptions: [], scheduleOptions: [] } }));
  return snapshot;
}

export function writeSchedulingSessionCache(identity, data, storage = globalThis.sessionStorage, now = Date.now()) {
  if (!identity?.userId || !identity?.sessionId || !data) return;
  try {
    const snapshot = cacheSnapshot(identity, data);
    const serialized = serializeSchedulingCacheEntry({ userId: identity.userId, sessionId: identity.sessionId, savedAt: now, data: snapshot });
    if (!serialized) { storage?.removeItem?.(KEY); return false; }
    storage?.removeItem?.('scheduling-screen-session-v1');
    try { storage?.setItem(KEY, serialized); }
    catch { storage?.removeItem?.(KEY); return false; }
    return true;
  } catch { return false; /* Full/disabled storage must never interrupt scheduling. */ }
}

let cacheWriteGeneration = 0;
/** Keep JSON serialization off the UI thread; a failed optional cache is discarded. */
export async function writeSchedulingSessionCacheAsync(identity, data, storage = globalThis.sessionStorage, now = Date.now()) {
  const generation = ++cacheWriteGeneration;
  if (!identity?.userId || !identity?.sessionId || !data) return false;
  if (typeof Worker === 'undefined') return false;
  let worker;
  try {
    const snapshot = cacheSnapshot(identity, data);
    worker = new Worker(new URL('./course-scheduling-cache-worker.js', import.meta.url), { type: 'module' });
    const serialized = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('cache_worker_timeout')), 5000);
      worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
      worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message || 'cache_worker_failed')); };
      worker.postMessage({ userId: identity.userId, sessionId: identity.sessionId, savedAt: now, data: snapshot });
    });
    if (generation !== cacheWriteGeneration) return false;
    storage?.removeItem?.('scheduling-screen-session-v1');
    if (!serialized) { storage?.removeItem?.(KEY); return false; }
    storage?.setItem(KEY, serialized);
    return true;
  } catch {
    if (generation === cacheWriteGeneration) { try { storage?.removeItem?.(KEY); } catch { /* optional storage */ } }
    return false;
  } finally { worker?.terminate(); }
}

export function schedulingSessionIdentity(session) {
  if (!session?.user?.id) return null;
  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
    return payload.session_id ? { userId: session.user.id, sessionId: String(payload.session_id) } : null;
  } catch { return null; }
}
