import { state, setSession } from './state.js';
import { supabase } from './supabase-client.js';
import {
  dashboardSessionExpiryReason,
  personalReportsSessionExpired
} from './session-security-policy.js';

const DASHBOARD_SESSION_STARTED_KEY = 'dashboard_session_started_at';
const DASHBOARD_LAST_ACTIVITY_KEY = 'dashboard_session_last_activity_at';
const DASHBOARD_TIMEOUT_REASON_KEY = 'dashboard_session_timeout_reason';
const DASHBOARD_PENDING_ROUTE_KEY = 'dashboard_pending_route';
const DASHBOARD_TOKEN_KEY = 'dashboard_token';
const DASHBOARD_USER_KEY = 'dashboard_user';
const DASHBOARD_ROUTES_KEY = 'dashboard_routes';
const SESSION_ALIVE_KEY = 'ds_session_alive';
const ACTIVITY_WRITE_THROTTLE_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 15 * 1000;
const SUPABASE_SIGN_OUT_WAIT_MS = 2500;
const LOGOUT_BUTTON_SELECTOR = '#logoutBtn, .shell-logout-btn--mobile';

let dashboardLogoutInProgress = false;
let lastDashboardActivityWriteAt = 0;
let personalReportsUnlocked = false;
let personalReportsLastActivityAt = 0;
let personalReportsLockInProgress = false;
let sessionSecurityObserver = null;
let sessionSecurityInterval = null;

function readTimestamp(key) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeTimestamp(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* ignore storage failures */ }
}

function dashboardSessionExists() {
  try {
    return Boolean(state?.token || localStorage.getItem(DASHBOARD_TOKEN_KEY));
  } catch {
    return Boolean(state?.token);
  }
}

export function clearDashboardSessionTimeoutState() {
  try {
    localStorage.removeItem(DASHBOARD_SESSION_STARTED_KEY);
    localStorage.removeItem(DASHBOARD_LAST_ACTIVITY_KEY);
  } catch {
    /* ignore storage failures */
  }
  lastDashboardActivityWriteAt = 0;
}

function ensureDashboardSessionTimestamps(now = Date.now()) {
  if (!dashboardSessionExists()) {
    clearDashboardSessionTimeoutState();
    return null;
  }

  let startedAt = readTimestamp(DASHBOARD_SESSION_STARTED_KEY);
  let lastActivityAt = readTimestamp(DASHBOARD_LAST_ACTIVITY_KEY);
  if (!startedAt) {
    startedAt = now;
    writeTimestamp(DASHBOARD_SESSION_STARTED_KEY, startedAt);
  }
  if (!lastActivityAt) {
    lastActivityAt = now;
    writeTimestamp(DASHBOARD_LAST_ACTIVITY_KEY, lastActivityAt);
  }
  return { startedAt, lastActivityAt };
}

export async function expireDashboardSession(reason = 'inactivity_timeout') {
  if (dashboardLogoutInProgress) return;
  dashboardLogoutInProgress = true;
  clearDashboardSessionTimeoutState();

  try { sessionStorage.setItem(DASHBOARD_TIMEOUT_REASON_KEY, reason); } catch { /* ignore */ }
  if (supabase) {
    const signOutAttempt = supabase.auth.signOut({ scope: 'local' }).catch((error) => {
      console.warn('[session-security] Supabase sign-out failed during timeout', error);
    });
    await Promise.race([
      signOutAttempt,
      new Promise((resolve) => setTimeout(resolve, SUPABASE_SIGN_OUT_WAIT_MS))
    ]);
  }

  try {
    setSession(null);
  } catch {
    try {
      localStorage.removeItem(DASHBOARD_TOKEN_KEY);
      localStorage.removeItem(DASHBOARD_USER_KEY);
      sessionStorage.removeItem(SESSION_ALIVE_KEY);
    } catch { /* ignore */ }
  }
  try { localStorage.removeItem(DASHBOARD_ROUTES_KEY); } catch { /* ignore */ }

  if (typeof window !== 'undefined') window.location.reload();
}

export function checkDashboardSessionTimeout(now = Date.now()) {
  const timestamps = ensureDashboardSessionTimestamps(now);
  if (!timestamps) return '';
  const reason = dashboardSessionExpiryReason({ now, ...timestamps });
  if (reason) void expireDashboardSession(reason);
  return reason;
}

function recordDashboardActivity(now = Date.now()) {
  if (!dashboardSessionExists()) return;
  if (checkDashboardSessionTimeout(now)) return;
  if (now - lastDashboardActivityWriteAt < ACTIVITY_WRITE_THROTTLE_MS) return;
  lastDashboardActivityWriteAt = now;
  writeTimestamp(DASHBOARD_LAST_ACTIVITY_KEY, now);
}

function personalReportsRoot() {
  return typeof document === 'undefined' ? null : document.querySelector('#pr-root');
}

function personalReportsScreenIsUnlocked() {
  if (state?.route !== 'personal-reports') return false;
  const root = personalReportsRoot();
  if (!root) return false;
  if (root.querySelector('#pr-internal-login-form, .pr-lock-wrap')) return false;
  if (root.querySelector('.pr-loading-placeholder')) return false;
  return root.childElementCount > 0;
}

function resetPersonalReportsRuntimeState() {
  personalReportsUnlocked = false;
  personalReportsLastActivityAt = 0;
  personalReportsLockInProgress = false;
}

export function lockPersonalReports(reason = 'personal_reports_inactivity') {
  if (personalReportsLockInProgress || typeof window === 'undefined') return;
  personalReportsLockInProgress = true;
  personalReportsUnlocked = false;
  personalReportsLastActivityAt = 0;
  try {
    sessionStorage.setItem(DASHBOARD_PENDING_ROUTE_KEY, 'personal-reports');
    sessionStorage.setItem(DASHBOARD_TIMEOUT_REASON_KEY, reason);
  } catch { /* ignore */ }
  window.location.reload();
}

export function checkPersonalReportsTimeout(now = Date.now()) {
  if (!personalReportsScreenIsUnlocked()) {
    if (state?.route !== 'personal-reports' || personalReportsRoot()?.querySelector('#pr-internal-login-form, .pr-lock-wrap')) {
      resetPersonalReportsRuntimeState();
    }
    return false;
  }

  if (!personalReportsUnlocked) {
    personalReportsUnlocked = true;
    personalReportsLastActivityAt = now;
    return false;
  }

  if (personalReportsSessionExpired({ now, lastActivityAt: personalReportsLastActivityAt })) {
    lockPersonalReports();
    return true;
  }
  return false;
}

function recordPersonalReportsActivity(event, now = Date.now()) {
  if (!personalReportsUnlocked || state?.route !== 'personal-reports') return;
  const root = personalReportsRoot();
  if (!root) return;
  const target = event?.target;
  if ((target && (target === root || root.contains(target))) || event?.type === 'scroll') {
    personalReportsLastActivityAt = now;
  }
}

function handleUserActivity(event) {
  const now = Date.now();
  recordDashboardActivity(now);
  recordPersonalReportsActivity(event, now);
}

function handleVisibilityChange() {
  if (document.visibilityState !== 'visible') return;
  const now = Date.now();
  const reason = checkDashboardSessionTimeout(now);
  if (!reason) checkPersonalReportsTimeout(now);
}

function handlePageShow(event) {
  const now = Date.now();
  const reason = checkDashboardSessionTimeout(now);
  if (reason || !event?.persisted) return;
  if (personalReportsScreenIsUnlocked()) {
    lockPersonalReports('personal_reports_reopened');
  }
}

function handleStorageChange(event) {
  if (!event) return;
  if (event.key === DASHBOARD_TOKEN_KEY && !event.newValue) {
    clearDashboardSessionTimeoutState();
    return;
  }
  if ([DASHBOARD_SESSION_STARTED_KEY, DASHBOARD_LAST_ACTIVITY_KEY, DASHBOARD_TOKEN_KEY].includes(event.key)) {
    checkDashboardSessionTimeout(Date.now());
  }
}

function handleLogoutClick(event) {
  if (!event.target?.closest?.(LOGOUT_BUTTON_SELECTOR)) return;
  clearDashboardSessionTimeoutState();
  resetPersonalReportsRuntimeState();
}

export function installSessionSecurityRuntime() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (window.__dashboardSessionSecurityInstalled) return false;
  window.__dashboardSessionSecurityInstalled = true;

  const activityEvents = ['pointerdown', 'keydown', 'input', 'change', 'touchstart', 'wheel', 'scroll'];
  activityEvents.forEach((eventName) => {
    const options = eventName === 'scroll' || eventName === 'wheel' || eventName === 'touchstart'
      ? { capture: true, passive: true }
      : { capture: true };
    document.addEventListener(eventName, handleUserActivity, options);
  });
  document.addEventListener('click', handleLogoutClick, true);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('storage', handleStorageChange);
  window.addEventListener('pagehide', resetPersonalReportsRuntimeState);
  window.addEventListener('pageshow', handlePageShow);

  sessionSecurityObserver = new MutationObserver(() => {
    const now = Date.now();
    checkDashboardSessionTimeout(now);
    checkPersonalReportsTimeout(now);
  });
  sessionSecurityObserver.observe(document.documentElement, { childList: true, subtree: true });

  checkDashboardSessionTimeout(Date.now());
  checkPersonalReportsTimeout(Date.now());
  sessionSecurityInterval = window.setInterval(() => {
    const now = Date.now();
    const reason = checkDashboardSessionTimeout(now);
    if (!reason) checkPersonalReportsTimeout(now);
  }, CHECK_INTERVAL_MS);

  return true;
}

export function uninstallSessionSecurityRuntimeForTests() {
  sessionSecurityObserver?.disconnect();
  sessionSecurityObserver = null;
  if (sessionSecurityInterval != null && typeof window !== 'undefined') {
    window.clearInterval(sessionSecurityInterval);
  }
  sessionSecurityInterval = null;
}

installSessionSecurityRuntime();
