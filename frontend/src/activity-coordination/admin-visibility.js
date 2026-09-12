import { state } from '../state.js';
import { hasPermission } from '../permission-policy.js';

const ACCESS_CLASS = 'activity-coordination-send-allowed';
const STYLE_ID = 'activity-coordination-permission-style';
let canSend = false;
let redirectInFlight = false;

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
  if (canSend || redirectInFlight) return;
  if (!document.querySelector('.coordination-workspace')) return;
  const allActivitiesTab = document.querySelector('[data-activity-period-tab="year_all"]');
  if (!(allActivitiesTab instanceof HTMLElement)) return;
  redirectInFlight = true;
  allActivitiesTab.click();
  queueMicrotask(() => { redirectInFlight = false; });
}

function applyAccessState(allowed) {
  canSend = allowed === true;
  document.documentElement.classList.toggle(ACCESS_CLASS, canSend);
  redirectAwayFromCoordinationWorkspace();
}

function syncAccess() {
  applyAccessState(hasPermission(state?.user, 'send_activity_coordination_approvals'));
}

installPermissionStyles();

const observer = new MutationObserver(() => {
  syncAccess();
  redirectAwayFromCoordinationWorkspace();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

syncAccess();
