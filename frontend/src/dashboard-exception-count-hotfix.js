import { api } from './api.js';
import { state } from './state.js';

function selectedActivityPeriod() {
  return String(state?.activityPeriodTab || '').trim() || 'school_2027';
}

function installExceptionPeriodGuard() {
  const flag = '__dsDashboardExceptionPeriodGuard';
  const originalExceptions = api?.exceptions?.bind(api);
  if (typeof originalExceptions !== 'function' || globalThis[flag]) return;
  globalThis[flag] = true;

  api.exceptions = (filters = {}) => {
    const input = filters && typeof filters === 'object' ? filters : {};
    return originalExceptions({
      ...input,
      activity_period: input.activity_period || selectedActivityPeriod()
    });
  };
}

function finiteCount(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return number;
  }
  return null;
}

function exceptionActivityCount(data = {}) {
  return finiteCount(
    data?.uniqueExceptionActivities,
    data?.operationalUniqueCount,
    data?.totalExceptionRows,
    data?.summary?.operational_gaps_unique_count,
    data?.summary?.totalExceptionRows,
    data?.summary?.total_exception_rows,
    Array.isArray(data?.rows) ? data.rows.length : null
  );
}

function exceptionOccurrenceCount(data = {}, fallback = 0) {
  return finiteCount(
    data?.totalExceptionInstances,
    data?.totalExceptionOccurrences,
    data?.summary?.totalExceptionInstances,
    data?.summary?.totalExceptionOccurrences,
    Array.isArray(data?.exceptionInstances) ? data.exceptionInstances.length : null,
    Array.isArray(data?.instances) ? data.instances.length : null,
    fallback
  ) ?? fallback;
}

function updateExceptionCard(cards, count) {
  return (Array.isArray(cards) ? cards : []).map((card) => {
    if (card?.id !== 'exceptions' && card?.action !== 'kpi|exceptions') return card;
    return { ...card, title: String(count), value: count };
  });
}

export function applyDashboardExceptionSummary(payload = {}, exceptions = {}) {
  const count = exceptionActivityCount(exceptions);
  if (count == null) return payload;

  const occurrenceCount = exceptionOccurrenceCount(exceptions, count);
  const counts = exceptions?.counts && typeof exceptions.counts === 'object'
    ? exceptions.counts
    : (payload?.summary?.counts || {});
  const byDistrict = exceptions?.byDistrict && typeof exceptions.byDistrict === 'object'
    ? exceptions.byDistrict
    : (exceptions?.byManager && typeof exceptions.byManager === 'object' ? exceptions.byManager : {});
  const {
    totalExceptionInstances: _legacyInstanceTotal,
    ...summaryWithoutAmbiguousInstanceTotal
  } = payload?.summary && typeof payload.summary === 'object' ? payload.summary : {};

  const byActivityManager = (Array.isArray(payload?.by_activity_manager) ? payload.by_activity_manager : []).map((row) => {
    const key = String(row?.activity_manager || row?.district || '').trim();
    return Object.prototype.hasOwnProperty.call(byDistrict, key)
      ? { ...row, exceptions: Number(byDistrict[key] || 0) }
      : row;
  });

  return {
    ...payload,
    exceptionsUnavailable: false,
    exceptionCount: count,
    uniqueExceptionActivities: count,
    totalExceptionOccurrences: occurrenceCount,
    totals: {
      ...(payload?.totals || {}),
      exceptions_count: count
    },
    summary: {
      ...summaryWithoutAmbiguousInstanceTotal,
      exceptions_count: count,
      totalExceptionRows: count,
      total_exception_rows: count,
      totalExceptionOccurrences: occurrenceCount,
      total_exception_occurrences: occurrenceCount,
      operational_gaps_count: count,
      operational_gaps_unique_count: count,
      operationalTotal: count,
      counts,
      exceptions_unavailable: false
    },
    by_activity_manager: byActivityManager,
    kpi_cards: updateExceptionCard(payload?.kpi_cards, count),
    cards: updateExceptionCard(payload?.cards, count)
  };
}

async function reconcileDashboardPayload(originalMethod, methodName, args) {
  const payload = await originalMethod(...args);
  if (!payload || typeof payload !== 'object') return payload;

  const filters = args?.[0] && typeof args[0] === 'object' ? args[0] : {};
  const month = String(payload?.month || filters?.month || filters?.ym || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month) || typeof api.exceptions !== 'function') return payload;

  try {
    const exceptions = await api.exceptions({
      month,
      activity_period: selectedActivityPeriod()
    });
    if (exceptions?.error || exceptions?._debug?.error) return payload;
    return applyDashboardExceptionSummary(payload, exceptions);
  } catch (error) {
    console.warn('[dashboard-exception-count-hotfix] exception reconciliation failed', {
      method: methodName,
      month,
      activity_period: selectedActivityPeriod(),
      error: error?.message || String(error)
    });
    return payload;
  }
}

function installDashboardReconciler(methodName) {
  const originalMethod = api?.[methodName]?.bind(api);
  const flag = `__dsDashboardExceptionCountHotfix_${methodName}`;
  if (typeof originalMethod !== 'function' || globalThis[flag]) return;
  globalThis[flag] = true;
  api[methodName] = (...args) => reconcileDashboardPayload(originalMethod, methodName, args);
}

installExceptionPeriodGuard();
installDashboardReconciler('dashboardSnapshot');
installDashboardReconciler('dashboardReadModel');
