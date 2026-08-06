/**
 * Single source of truth for the 2026 read-only rule.
 *
 * 2026 (`regular` + `summer_2026`) is a closed historical period: it stays fully
 * visible, searchable, filterable and exportable, but nothing may change its data.
 * 2027 (`school_2027`) remains the active editable working year.
 */
import {
  ACTIVITY_SEASON_REGULAR,
  ACTIVITY_SEASON_SUMMER_2026,
  getActivityPeriodKey,
  normalizeActivitySeason,
  normalizeGlobalActivityPeriod
} from './summer-activity.js';

export const READ_ONLY_ACTIVITY_SEASONS = Object.freeze([
  ACTIVITY_SEASON_REGULAR,
  ACTIVITY_SEASON_SUMMER_2026
]);

export const READ_ONLY_ACTIVITY_PERIOD_ERROR = 'activity_period_read_only_2026';
export const READ_ONLY_ACTIVITY_PERIOD_MESSAGE =
  'שנת 2026 היא תקופה היסטורית לקריאה בלבד — לא ניתן לשנות נתוני פעילות.';

const READ_ONLY_SEASON_SET = new Set(READ_ONLY_ACTIVITY_SEASONS);

function hasSeasonValue(value) {
  return String(value ?? '').trim() !== '';
}

/** True for an explicit `regular` / `summer_2026` season value. */
export function isReadOnlyActivitySeason(value) {
  if (!hasSeasonValue(value)) return false;
  return READ_ONLY_SEASON_SET.has(normalizeActivitySeason(value));
}

/** True when the selected global period is the historical 2026 period. */
export function isReadOnlyGlobalActivityPeriod(value) {
  if (!hasSeasonValue(value)) return false;
  return READ_ONLY_SEASON_SET.has(normalizeGlobalActivityPeriod(value));
}

/** True when the activity row itself belongs to 2026, whatever screen shows it. */
export function isReadOnlyActivityRow(activity = {}) {
  if (!activity || typeof activity !== 'object') return false;
  const period = getActivityPeriodKey(activity);
  return READ_ONLY_SEASON_SET.has(period);
}

/**
 * Resolves whether a mutation may run. Any read-only signal blocks the mutation:
 * the selected global period, an explicit season value, or the activity row.
 */
export function activityMutationBlockReason({
  activityPeriod = '',
  activitySeason = '',
  activity = null
} = {}) {
  if (isReadOnlyGlobalActivityPeriod(activityPeriod)) return 'global_period_2026';
  if (isReadOnlyActivitySeason(activitySeason)) return 'activity_season_2026';
  if (activity && isReadOnlyActivityRow(activity)) return 'activity_row_2026';
  return '';
}

export function isActivityMutationBlocked(context = {}) {
  return activityMutationBlockReason(context) !== '';
}

export function activityReadOnlyError() {
  const error = new Error(READ_ONLY_ACTIVITY_PERIOD_ERROR);
  error.userMessage = READ_ONLY_ACTIVITY_PERIOD_MESSAGE;
  return error;
}

/** Guard for event handlers and API mutations; throws instead of silently allowing. */
export function assertActivityMutationAllowed(context = {}) {
  if (isActivityMutationBlocked(context)) throw activityReadOnlyError();
  return true;
}

/**
 * Collapses every mutating capability to false for read-only activities so the
 * markup itself never renders edit/save/delete/schedule controls.
 */
export function applyReadOnlyActivityCapabilities(capabilities = {}, context = {}) {
  if (!isActivityMutationBlocked(context)) return { ...capabilities };
  return {
    ...capabilities,
    canEdit: false,
    canDirectEdit: false,
    canRequestEdit: false,
    canDeleteActivity: false,
    canSchedule: false,
    canReopen: false,
    canAddActivity: false
  };
}
