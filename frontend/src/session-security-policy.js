export const DASHBOARD_INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
export const DASHBOARD_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
export const PERSONAL_REPORTS_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

function normalizedTimestamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function dashboardSessionExpiryReason({ now = Date.now(), startedAt, lastActivityAt } = {}) {
  const current = normalizedTimestamp(now) || Date.now();
  const started = normalizedTimestamp(startedAt);
  const lastActivity = normalizedTimestamp(lastActivityAt);
  if (!started || !lastActivity) return '';
  if (current - started >= DASHBOARD_ABSOLUTE_TIMEOUT_MS) return 'absolute_timeout';
  if (current - lastActivity >= DASHBOARD_INACTIVITY_TIMEOUT_MS) return 'inactivity_timeout';
  return '';
}

export function personalReportsSessionExpired({ now = Date.now(), lastActivityAt } = {}) {
  const current = normalizedTimestamp(now) || Date.now();
  const lastActivity = normalizedTimestamp(lastActivityAt);
  if (!lastActivity) return false;
  return current - lastActivity >= PERSONAL_REPORTS_INACTIVITY_TIMEOUT_MS;
}
