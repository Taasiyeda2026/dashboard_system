import { api } from './api.js';
import { state } from './state.js';
import {
  ACTIVITY_SEASON_SCHOOL_2027,
  normalizeGlobalActivityPeriod
} from './screens/shared/summer-activity.js';

export const END_DATE_EXCEPTION_THRESHOLD_BY_PERIOD = Object.freeze({
  regular: '2026-06-15',
  school_2027: '2027-06-15'
});

export function endDateExceptionThresholdForPeriod(period) {
  const normalized = normalizeGlobalActivityPeriod(period);
  return END_DATE_EXCEPTION_THRESHOLD_BY_PERIOD[normalized] || END_DATE_EXCEPTION_THRESHOLD_BY_PERIOD.regular;
}

function rowIdentity(row = {}) {
  return [row?.RowID, row?.row_id, row?.source_row_id]
    .map((value) => String(value ?? '').trim())
    .find(Boolean) || [row?.activity_name, row?.school, row?.authority]
      .map((value) => String(value ?? '').trim())
      .join('|');
}

function rowExceptionTypes(row = {}) {
  const raw = Array.isArray(row?.exception_types)
    ? row.exception_types
    : [row?.exception_type];
  return [...new Set(raw.map((type) => String(type || '').trim()).filter(Boolean))];
}

function normalizedEndDate(row = {}) {
  const raw = String(row?.end_date || row?.date_end || '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? match[1] : '';
}

function reconcileSchool2027Row(row, threshold) {
  const endDate = normalizedEndDate(row);
  const types = rowExceptionTypes(row).filter((type) => {
    if (type !== 'end_date_after_cutoff') return true;
    return !!endDate && endDate > threshold;
  });
  if (!types.length) return null;

  const currentPrimary = String(row?.exception_type || '').trim();
  const exceptionType = currentPrimary && types.includes(currentPrimary)
    ? currentPrimary
    : types[0];

  return {
    ...row,
    exception_type: exceptionType,
    exception_types: types,
    _late_end_date_threshold: threshold
  };
}

function buildExceptionInstances(rows = []) {
  return rows.flatMap((row) => {
    const types = rowExceptionTypes(row);
    return types.map((type) => ({
      ...row,
      exception_type: type,
      exception_types: types,
      exception_instance_key: `${rowIdentity(row)}:${type}`
    }));
  });
}

function buildCounts(rows = []) {
  const counts = {};
  for (const row of rows) {
    for (const type of rowExceptionTypes(row)) {
      counts[type] = (counts[type] || 0) + 1;
    }
  }
  return counts;
}

function buildUniqueByDistrict(rows = []) {
  const districts = new Map();
  for (const row of rows) {
    const district = String(row?.district || row?.activity_manager || '').trim();
    if (!district) continue;
    if (!districts.has(district)) districts.set(district, new Set());
    districts.get(district).add(rowIdentity(row));
  }
  return Object.fromEntries([...districts.entries()].map(([district, ids]) => [district, ids.size]));
}

/**
 * The legacy DB setting `late_end_date_threshold` is still 2026-06-15 so the
 * historical 2026 period remains correct. For school_2027 we reconcile only
 * the `end_date_after_cutoff` exception to the school-year-specific cutoff.
 */
export function applyEndDateExceptionThresholdByPeriod(data = {}, period = '') {
  if (!data || typeof data !== 'object') return data;
  const normalizedPeriod = normalizeGlobalActivityPeriod(period);
  if (normalizedPeriod !== ACTIVITY_SEASON_SCHOOL_2027) return data;

  const threshold = endDateExceptionThresholdForPeriod(normalizedPeriod);
  const sourceRows = Array.isArray(data?.rows) ? data.rows : [];
  const rows = sourceRows
    .map((row) => reconcileSchool2027Row(row, threshold))
    .filter(Boolean);

  const uniqueIds = new Set(rows.map(rowIdentity).filter(Boolean));
  const totalExceptionRows = uniqueIds.size;
  const counts = buildCounts(rows);
  const totalExceptionInstances = Object.values(counts)
    .reduce((sum, value) => sum + Number(value || 0), 0);
  const exceptionInstances = buildExceptionInstances(rows);
  const byDistrict = buildUniqueByDistrict(rows);

  return {
    ...data,
    rows,
    exceptionInstances,
    totalExceptionRows,
    totalExceptionInstances,
    totalExceptionOccurrences: totalExceptionInstances,
    uniqueExceptionActivities: totalExceptionRows,
    operationalUniqueCount: totalExceptionRows,
    counts,
    byDistrict,
    byManager: byDistrict,
    lateEndDateThreshold: threshold
  };
}

function installExceptionThresholdReconciler() {
  const flag = '__dsExceptionThresholdByPeriodInstalled';
  if (globalThis[flag]) return;
  const originalExceptions = api?.exceptions?.bind(api);
  if (typeof originalExceptions !== 'function') return;
  globalThis[flag] = true;

  api.exceptions = async (...args) => {
    const payload = await originalExceptions(...args);
    const filters = args?.[0] && typeof args[0] === 'object' ? args[0] : {};
    const activityPeriod = filters?.activity_period || state?.activityPeriodTab;
    return applyEndDateExceptionThresholdByPeriod(payload, activityPeriod);
  };
}

installExceptionThresholdReconciler();
