import { api } from './api.js';
import { state } from './state.js';

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
    data?.totalExceptionRows,
    data?.summary?.totalExceptionRows,
    data?.summary?.total_exception_rows,
    Array.isArray(data?.rows) ? data.rows.length : null
  );
}

function exceptionInstanceCount(data = {}, fallback = 0) {
  return finiteCount(
    data?.totalExceptionInstances,
    data?.summary?.totalExceptionInstances,
    Array.isArray(data?.instances) ? data.instances.length : null,
    fallback
  ) ?? fallback;
}

function isSummerDashboardPayload(payload = {}) {
  return (Array.isArray(payload?.rows) ? payload.rows : []).some((row) => {
    const season = String(row?.activity_season ?? row?.activitySeason ?? '').trim();
    return season === 'summer_2026';
  });
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

  const instanceCount = exceptionInstanceCount(exceptions, count);
  const counts = exceptions?.counts && typeof exceptions.counts === 'object'
    ? exceptions.counts
    : (payload?.summary?.counts || {});
  const byDistrict = exceptions?.byDistrict && typeof exceptions.byDistrict === 'object'
    ? exceptions.byDistrict
    : (exceptions?.byManager && typeof exceptions.byManager === 'object' ? exceptions.byManager : {});

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
    totals: {
      ...(payload?.totals || {}),
      exceptions_count: count
    },
    summary: {
      ...(payload?.summary || {}),
      exceptions_count: count,
      totalExceptionRows: count,
      total_exception_rows: count,
      totalExceptionInstances: instanceCount,
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

const originalDashboardReadModel = api.dashboardReadModel?.bind(api);
if (typeof originalDashboardReadModel === 'function' && !globalThis.__dsDashboardExceptionCountHotfixInstalled) {
  globalThis.__dsDashboardExceptionCountHotfixInstalled = true;
  api.dashboardReadModel = async (...args) => {
    const payload = await originalDashboardReadModel(...args);
    if (!payload || typeof payload !== 'object' || !isSummerDashboardPayload(payload)) return payload;

    const filters = args?.[0] && typeof args[0] === 'object' ? args[0] : {};
    const month = String(payload?.month || filters?.month || filters?.ym || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month) || typeof api.exceptions !== 'function') return payload;

    try {
      const exceptions = await api.exceptions({
        month,
        activity_period: state?.activityPeriodTab
      });
      if (exceptions?.error || exceptions?._debug?.error) return payload;
      return applyDashboardExceptionSummary(payload, exceptions);
    } catch (error) {
      console.warn('[dashboard-exception-count-hotfix] exception reconciliation failed', {
        month,
        error: error?.message || String(error)
      });
      return payload;
    }
  };
}
