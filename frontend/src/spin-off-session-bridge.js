// Isolated SPIN-OFF group authentication handoff. Dashboard owns login and refresh.
export const SPIN_OFF_ORIGIN = 'https://taasiyeda2026.github.io';
const PENDING_KEY = 'spin_off_group_pending_bridge_v1';
const MAX_AGE_MS = 10 * 60 * 1000;
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function isLoopback(origin) {
  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(parsed.hostname) &&
      ['https:', 'http:'].includes(parsed.protocol);
  } catch { return false; }
}

export function validSpinOffBridgeRequest(origin, state, dashboardOrigin) {
  if (typeof state !== 'string' || !STATE_PATTERN.test(state)) return false;
  if (origin === SPIN_OFF_ORIGIN && dashboardOrigin === SPIN_OFF_ORIGIN) return true;
  return isLoopback(origin) && isLoopback(dashboardOrigin);
}

export function rememberSpinOffBridge(storage, request, now = Date.now()) {
  if (!validSpinOffBridgeRequest(request?.origin, request?.state, request?.dashboardOrigin)) return false;
  storage.setItem(PENDING_KEY, JSON.stringify({ origin: request.origin, state: request.state, at: now }));
  return true;
}

export function readSpinOffBridge(storage, dashboardOrigin, now = Date.now()) {
  try {
    const parsed = JSON.parse(storage.getItem(PENDING_KEY) || 'null');
    if (!parsed || !Number.isFinite(parsed.at) || now < parsed.at || now - parsed.at > MAX_AGE_MS ||
        !validSpinOffBridgeRequest(parsed.origin, parsed.state, dashboardOrigin)) {
      storage.removeItem(PENDING_KEY);
      return null;
    }
    return parsed;
  } catch { storage.removeItem(PENDING_KEY); return null; }
}

export async function resumeSpinOffBridge({ client, location, storage }) {
  const pending = readSpinOffBridge(storage, location.origin);
  if (!pending || !client?.auth) return false;
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user?.id) return false;
    const destination = new URL('./spin-off-bridge.html', location.href);
    destination.searchParams.set('origin', pending.origin);
    destination.searchParams.set('state', pending.state);
    storage.removeItem(PENDING_KEY);
    location.replace(destination.href);
    return true;
  } catch { return false; }
}
