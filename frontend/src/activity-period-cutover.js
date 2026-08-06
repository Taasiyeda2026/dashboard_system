import { deletePersistedCacheByPrefixes } from './cache-persist.js';
import {
  ACTIVE_ACTIVITY_SEASON,
  GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY
} from './screens/shared/summer-activity.js';
import { isReadOnlyGlobalActivityPeriod } from './screens/shared/activity-readonly-period.js';

export const ACTIVITY_PERIOD_2027_CUTOVER_KEY = 'dashboard_activity_period_cutover_school_2027_v1';

export const ACTIVITY_PERIOD_CACHE_PREFIXES = [
  'dashboard:',
  'activities:',
  'week:',
  'month:',
  'end-dates',
  'exceptions',
  'operations-management:'
];

function isActivityPeriodCacheKey(key) {
  const cacheKey = String(key || '');
  return ACTIVITY_PERIOD_CACHE_PREFIXES.some((prefix) => cacheKey === prefix || cacheKey.startsWith(prefix));
}

/**
 * 2027 is the working year, so every fresh entry and every reload starts on 2027.
 * A stored historical 2026 selection never reopens the app on 2026; picking 2026
 * by hand stays in effect for the rest of that browsing session only.
 */
export function resolveInitialActivityPeriod(storage = localStorage) {
  const stored = storage.getItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY) || '';
  const hadHistoricalSelection = isReadOnlyGlobalActivityPeriod(stored);

  storage.setItem(ACTIVITY_PERIOD_2027_CUTOVER_KEY, '1');
  storage.setItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY, ACTIVE_ACTIVITY_SEASON);

  return { period: ACTIVE_ACTIVITY_SEASON, didCutover: hadHistoricalSelection };
}

export function clearActivityPeriodScreenCache(screenDataCache = {}) {
  const removedMemoryKeys = [];
  Object.keys(screenDataCache).forEach((key) => {
    if (!isActivityPeriodCacheKey(key)) return;
    delete screenDataCache[key];
    removedMemoryKeys.push(key);
  });
  const removedPersistedKeys = deletePersistedCacheByPrefixes(ACTIVITY_PERIOD_CACHE_PREFIXES);
  return { removedMemoryKeys, removedPersistedKeys };
}
