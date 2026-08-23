import { supabase, waitForSupabaseAuthSession } from '../supabase-client.js';

const ACCESS_CLASS = 'activity-coordination-send-allowed';
const STYLE_ID = 'activity-coordination-permission-style';
let accessResolved = false;
let canSend = false;
let redirectInFlight = false;
let accessPromise = null;

function installPermissionStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html:not(.${ACCESS_CLASS}) [data-activity-period-tab="coordination_approvals"],
    html:not(.${ACCESS_CLASS}) [data-coordination-approval],
    html:not(.${ACCESS_CLASS}) .coordination-workspace {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

function redirectAwayFromCoordinationWorkspace() {
  if (!accessResolved || canSend || redirectInFlight) return;
  if (!document.querySelector('.coordination-workspace')) return;
  const allActivitiesTab = document.querySelector('[data-activity-period-tab="year_all"]');
  if (!(allActivitiesTab instanceof HTMLElement)) return;
  redirectInFlight = true;
  allActivitiesTab.click();
  queueMicrotask(() => { redirectInFlight = false; });
}

function applyAccessState(allowed) {
  canSend = allowed === true;
  accessResolved = true;
  document.documentElement.classList.toggle(ACCESS_CLASS, canSend);
  redirectAwayFromCoordinationWorkspace();
}

async function resolveAccess() {
  if (accessPromise) return accessPromise;
  accessPromise = (async () => {
    try {
      const session = await waitForSupabaseAuthSession({ timeoutMs: 8000 });
      if (!session?.user?.id) {
        applyAccessState(false);
        return false;
      }
      const { data, error } = await supabase.rpc('activity_coordination_is_admin');
      if (error) throw error;
      applyAccessState(data === true);
      return data === true;
    } catch (error) {
      console.warn('[activity-coordination] admin access check failed; hiding feature', error);
      applyAccessState(false);
      return false;
    }
  })();

  try {
    return await accessPromise;
  } finally {
    accessPromise = null;
  }
}

installPermissionStyles();

const observer = new MutationObserver(() => {
  redirectAwayFromCoordinationWorkspace();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

supabase?.auth?.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    applyAccessState(false);
    return;
  }
  if (session?.user?.id && ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'].includes(event)) {
    resolveAccess();
  }
});

resolveAccess();
