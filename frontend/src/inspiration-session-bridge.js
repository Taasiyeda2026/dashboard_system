// The bridge returns an existing Supabase session only to the course window that
// opened it. Roles remain a server-side decision in the game's API.
export const INSPIRATION_GAME_URL = 'https://portzot-derech.org/inspiration/teacher.html';
const PENDING_KEY = 'inspiration_pending_bridge_v1';
const MAX_AGE_MS = 10 * 60 * 1000;
const COURSE_ORIGINS = new Set(['https://portzot-derech.org', 'https://taasiyeda2026.github.io']);

export function validBridgeRequest(origin, state, dashboardOrigin) {
  if (typeof origin !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(state || '')) return false;
  if (COURSE_ORIGINS.has(origin)) return true;
  try {
    const course = new URL(origin);
    const dashboard = new URL(dashboardOrigin);
    const loopback = (url) => ['localhost', '127.0.0.1'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
    return origin === course.origin && loopback(course) && loopback(dashboard);
  } catch { return false; }
}

export function canShowInspirationLink(user = {}) {
  return ['admin', 'instructor'].includes(user.role) || user.permissions?.inspiration_manage === true;
}

export function rememberBridgeRequest(storage, request, now = Date.now()) {
  storage.setItem(PENDING_KEY, JSON.stringify({ ...request, at: now }));
}

export function readBridgeRequest(storage, dashboardOrigin, now = Date.now()) {
  try {
    const request = JSON.parse(storage.getItem(PENDING_KEY) || 'null');
    if (!request || !Number.isFinite(request.at) || now < request.at || now - request.at > MAX_AGE_MS ||
        !validBridgeRequest(request.origin, request.state, dashboardOrigin)) {
      storage.removeItem(PENDING_KEY);
      return null;
    }
    return request;
  } catch { return null; }
}

export async function resumeInspirationBridge({ client, location, storage }) {
  const request = readBridgeRequest(storage, location.origin);
  if (!request || !client) return false;
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user?.id) return false;
    const target = new URL('./inspiration-bridge.html', location.href);
    target.searchParams.set('origin', request.origin);
    target.searchParams.set('state', request.state);
    storage.removeItem(PENDING_KEY);
    location.replace(target.href);
    return true;
  } catch { return false; }
}

export async function verifiedSession(client) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  const session = sessionData?.session;
  if (sessionError || !session?.access_token || !session?.refresh_token) return null;
  const { data, error } = await client.auth.getUser(session.access_token);
  if (error || !data?.user?.id || data.user.id !== session.user?.id) return null;
  return { access_token: session.access_token, refresh_token: session.refresh_token };
}
