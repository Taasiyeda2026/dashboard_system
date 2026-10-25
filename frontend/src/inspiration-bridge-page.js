import { supabase } from './supabase-client.js';
import { validBridgeRequest, rememberBridgeRequest, verifiedSession } from './inspiration-session-bridge.js';

const status = document.getElementById('bridge-status');
const retry = document.getElementById('bridge-retry');
const params = new URL(location.href).searchParams;
const request = { origin: params.get('origin'), state: params.get('state') };

async function connect() {
  retry.hidden = true;
  if (!window.opener || window.opener.closed || !validBridgeRequest(request.origin, request.state, location.origin)) {
    status.textContent = 'יש לפתוח את החיבור מתוך מסך ניהול נושמות השראה.';
    return;
  }
  try {
    const session = await verifiedSession(supabase);
    if (!session) {
      rememberBridgeRequest(sessionStorage, request);
      location.replace(new URL('./', location.href).href);
      return;
    }
    window.opener.postMessage({ type: 'inspiration:session', state: request.state, ...session }, request.origin);
    status.textContent = 'החיבור הושלם. אפשר לחזור לנושמות השראה.';
    window.close();
  } catch {
    status.textContent = 'לא הצלחנו לאמת את החיבור. בדקי את החיבור לאינטרנט ונסי שוב.';
    retry.hidden = false;
  }
}

retry.addEventListener('click', connect);
connect();
