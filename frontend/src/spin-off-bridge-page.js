import { supabase } from './supabase-client.js';
import { verifiedSession } from './inspiration-session-bridge.js';
import {
  validSpinOffBridgeRequest,
  rememberSpinOffBridge,
  SPIN_OFF_ORIGIN
} from './spin-off-session-bridge.js';

const status = document.getElementById('bridge-status');
const retry = document.getElementById('bridge-retry');
const params = new URL(location.href).searchParams;
const request = { origin: params.get('origin'), state: params.get('state'), dashboardOrigin: location.origin };

function validOpener() {
  if (!window.opener || window.opener.closed ||
      !validSpinOffBridgeRequest(request.origin, request.state, request.dashboardOrigin)) return false;
  // GitHub Pages hosts multiple repositories at the same origin. Restrict
  // handoff to the requested SPIN-OFF screens instead of any sibling site.
  if (location.origin === SPIN_OFF_ORIGIN) {
    try {
      const path = window.opener.location.pathname;
      return /^\/spin-off\/challenge\/(?:groupchallenge\.html|challenges\.html|ar\/challenges\.html)$/.test(path);
    } catch { return false; }
  }
  return true; // Both origins must be loopback to reach this branch.
}

async function connect() {
  retry.hidden = true;
  if (!validOpener()) {
    status.textContent = 'יש לפתוח את ההתחברות באמצעות כפתור חברי הצוות באתר SPIN-OFF.';
    return;
  }
  try {
    const session = await verifiedSession(supabase);
    if (!session) {
      if (!rememberSpinOffBridge(sessionStorage, request)) throw new Error('invalid_bridge_request');
      location.replace(new URL('./', location.href).href);
      return;
    }
    const { data: auth, error: authError } = await supabase.auth.getUser(session.access_token);
    const { data: rows, error: userError } = await supabase.rpc('get_current_app_user');
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (authError || userError || !auth?.user?.id || row?.is_active !== true ||
        String(row.auth_user_id || '') !== String(auth.user.id)) {
      status.textContent = 'החשבון אינו פעיל או שלא ניתן לאמת את ההרשאה שלו בדשבורד.';
      return;
    }
    if (!validOpener()) return;
    window.opener.postMessage({
      type: 'spin-off:session',
      state: request.state,
      access_token: session.access_token
    }, request.origin);
    status.textContent = 'ההתחברות אומתה. החלון ייסגר כעת.';
    window.close();
  } catch {
    status.textContent = 'לא ניתן להשלים את האימות. בדקו את החיבור לאינטרנט ונסו שוב.';
    retry.hidden = false;
  }
}
retry.addEventListener('click', connect);
connect();
