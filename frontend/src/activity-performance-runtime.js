import { api } from './api.js';
import { state } from './state.js';
import { activitiesScreen } from './screens/activities.js';
import { isActivityMutationBlocked } from './screens/shared/activity-readonly-period.js';
import { showToast } from './screens/shared/toast.js';

/*
 * Performance guard for activity-backed screens.
 *
 * - The dashboard already has its own snapshot API, so its speculative prefetch
 *   must not launch five additional heavy screen reads in parallel.
 * - Screen data warm-up is disabled; __DS_PROGRESSIVE_ROUTE_WARMUP__ must stay
 *   false so dashboard never triggers speculative activity screen reads.
 * - Activity saves already return the updated row and the UI patches it locally;
 *   the immediate full-table quiet refresh is therefore redundant. During the
 *   short post-save window we return the patched activity snapshot instead.
 */
(function installActivityPerformanceRuntime() {
  'use strict';

  if (globalThis.__dsActivityPerformanceRuntimeInstalled) return;
  globalThis.__dsActivityPerformanceRuntimeInstalled = true;

  const DASHBOARD_PREFETCH_METHODS = ['week', 'month', 'endDates', 'archiveActivities'];
  const activitiesSnapshots = new Map();
  const activityInflight = new Map();
  let lastActivitiesSnapshot = null;
  let suppressFullRefreshUntil = 0;

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
  }

  function argsKey(args = []) {
    try {
      return JSON.stringify(stableValue(args));
    } catch {
      return String(args?.[0] || 'default');
    }
  }

  function dashboardPrefetchError(method) {
    const error = new Error('dashboard_background_prefetch_skipped');
    error.code = 'dashboard_background_prefetch_skipped';
    error.silent = true;
    error.method = method;
    return error;
  }

  function isDashboardPrefetchContext() {
    const controlledSequentialWarmup = globalThis.__DS_PROGRESSIVE_ROUTE_WARMUP__ === true;
    return String(state?.route || '').trim() === 'dashboard' && !controlledSequentialWarmup;
  }

  function normalizedRowId(row = {}) {
    return String(row?.row_id ?? row?.RowID ?? row?.source_row_id ?? '').trim();
  }

  function patchSnapshotData(data, savedRow) {
    if (!data || !Array.isArray(data.rows) || !savedRow) return data;
    const rowId = normalizedRowId(savedRow);
    if (!rowId) return data;

    const rows = data.rows.slice();
    const index = rows.findIndex((row) => normalizedRowId(row) === rowId);
    if (index >= 0) rows[index] = { ...rows[index], ...savedRow, row_id: rowId, RowID: rowId };
    else if (String(savedRow?.status || '').trim() !== 'נמחק') rows.unshift({ ...savedRow, row_id: rowId, RowID: rowId });

    if (String(savedRow?.status || '').trim() === 'נמחק') {
      return { ...data, rows: rows.filter((row) => normalizedRowId(row) !== rowId) };
    }
    return { ...data, rows };
  }

  function patchAllActivitySnapshots(savedRow) {
    if (!savedRow) return;
    for (const [key, data] of activitiesSnapshots.entries()) {
      activitiesSnapshots.set(key, patchSnapshotData(data, savedRow));
    }
    lastActivitiesSnapshot = patchSnapshotData(lastActivitiesSnapshot, savedRow);
  }

  function beginPostSaveSuppression(savedRow) {
    patchAllActivitySnapshots(savedRow);
    suppressFullRefreshUntil = Date.now() + 12_000;
  }

  const originalActivities = typeof api.activities === 'function' ? api.activities.bind(api) : null;
  if (originalActivities) {
    api.activities = function optimizedActivities(...args) {
      if (isDashboardPrefetchContext()) {
        return Promise.reject(dashboardPrefetchError('activities'));
      }

      const key = argsKey(args);
      const snapshot = activitiesSnapshots.get(key) || lastActivitiesSnapshot;
      if (Date.now() < suppressFullRefreshUntil && snapshot) {
        return Promise.resolve(snapshot);
      }

      if (activityInflight.has(key)) return activityInflight.get(key);
      const request = Promise.resolve(originalActivities(...args))
        .then((data) => {
          if (data && Array.isArray(data.rows)) {
            activitiesSnapshots.set(key, data);
            lastActivitiesSnapshot = data;
          }
          return data;
        })
        .finally(() => activityInflight.delete(key));
      activityInflight.set(key, request);
      return request;
    };
  }

  DASHBOARD_PREFETCH_METHODS.forEach((method) => {
    const original = typeof api[method] === 'function' ? api[method].bind(api) : null;
    if (!original) return;
    api[method] = function skipDashboardSpeculativeRead(...args) {
      if (isDashboardPrefetchContext()) {
        return Promise.reject(dashboardPrefetchError(method));
      }
      return original(...args);
    };
  });

  function wrapMutation(method, rowFromResult) {
    const original = typeof api[method] === 'function' ? api[method].bind(api) : null;
    if (!original) return;
    api[method] = async function optimizedActivityMutation(...args) {
      const result = await original(...args);
      const row = rowFromResult(result, args);
      if (row) beginPostSaveSuppression(row);
      return result;
    };
  }

  wrapMutation('saveActivity', (result) => result?.row || null);
  wrapMutation('addActivity', (result) => result?.row || null);
  wrapMutation('deleteActivity', (result) => {
    const rowId = String(result?.row_id || '').trim();
    return rowId ? { row_id: rowId, RowID: rowId, status: result?.status || 'נמחק' } : null;
  });

  function removeDeletedRowFromScreenData(data, rowId) {
    if (!Array.isArray(data?.rows)) return;
    const index = data.rows.findIndex((row) => normalizedRowId(row) === rowId);
    if (index >= 0) data.rows.splice(index, 1);
  }

  function installPermanentDeleteFlow() {
    if (!activitiesScreen || activitiesScreen.__permanentDeleteFlowInstalled) return;
    const originalBind = typeof activitiesScreen.bind === 'function' ? activitiesScreen.bind : null;
    if (!originalBind) return;
    activitiesScreen.__permanentDeleteFlowInstalled = true;

    activitiesScreen.bind = function bindActivitiesWithPermanentDelete(context = {}) {
      originalBind.call(this, context);

      globalThis.__activityPermanentDeleteAbort?.abort?.();
      const controller = new AbortController();
      globalThis.__activityPermanentDeleteAbort = controller;

      document.addEventListener('click', async (event) => {
        const deleteButton = event.target?.closest?.('[data-action="delete-activity"]');
        if (!deleteButton) return;
        const form = deleteButton.closest('[data-drawer-form]');
        if (!form || !context.root?.isConnected) return;
        if (String(context.state?.route || state?.route || '').trim() !== 'activities') return;
        if (isActivityMutationBlocked({
          activityPeriod: String(context.state?.activityPeriodTab || state?.activityPeriodTab || ''),
          activitySeason: String(form.getAttribute('data-activity-season') || '')
        })) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        if (form.dataset.deleteInFlight === 'yes') return;
        const rowId = String(form.getAttribute('data-row-id') || '').trim();
        if (!rowId) return;
        const confirmed = window.confirm('האם למחוק את הפעילות לצמיתות? לא ניתן לשחזר את הפעילות לאחר המחיקה.');
        if (!confirmed) return;

        form.dataset.deleteInFlight = 'yes';
        deleteButton.disabled = true;
        try {
          await (context.api || api).deleteActivity(rowId);
          removeDeletedRowFromScreenData(context.data, rowId);
          context.clearScreenDataCache?.();
          context.clearScreenDataCache?.('activities');
          context.clearScreenDataCache?.('operations-management');
          context.ui?.closeDrawer?.();
          showToast('הפעילות נמחקה לצמיתות.', 'success', 2600);
          context.rerender?.();
        } catch (error) {
          console.error('[activity-permanent-delete-error]', { rowId, error });
          showToast('הפעילות לא נמחקה. ייתכן שאין הרשאה או שהפעילות לא נמצאה.', 'error', 3000);
          form.dataset.deleteInFlight = 'no';
          deleteButton.disabled = false;
        }
      }, { capture: true, signal: controller.signal });
    };
  }

  installPermanentDeleteFlow();
})();
