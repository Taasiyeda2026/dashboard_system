import { normalizeGlobalActivityPeriod } from './summer-activity.js';

export function weekScreenCacheKey(offset, state = {}) {
  const period = normalizeGlobalActivityPeriod(state.activityPeriodTab || 'regular');
  return `week:${Number(offset) || 0}:period:${period}`;
}

export function monthScreenCacheKey(ym, state = {}) {
  const month = ym && /^\d{4}-\d{2}$/.test(String(ym)) ? ym : 'current';
  const period = normalizeGlobalActivityPeriod(state.activityPeriodTab || 'regular');
  return `month:${month}:period:${period}`;
}
