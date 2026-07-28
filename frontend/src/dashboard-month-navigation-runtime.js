import { dashboardScreen } from './screens/dashboard.js';
import {
  ACTIVITY_SEASON_SCHOOL_2027,
  SCHOOL_2026_START_DATE,
  SCHOOL_2026_END_DATE,
  SCHOOL_2027_START_DATE,
  SCHOOL_2027_END_DATE,
  defaultMonthForGlobalActivityPeriod,
  normalizeGlobalActivityPeriod
} from './screens/shared/summer-activity.js';

(function installDashboardMonthNavigationRuntime() {
  'use strict';

  if (globalThis.__dsDashboardMonthNavigationRuntimeInstalled) return;
  globalThis.__dsDashboardMonthNavigationRuntimeInstalled = true;
  if (!dashboardScreen || typeof dashboardScreen !== 'object') return;

  const originalBind = typeof dashboardScreen.bind === 'function'
    ? dashboardScreen.bind.bind(dashboardScreen)
    : null;
  let navigationPending = false;

  function currentMonthYm() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function validYm(value) {
    const normalized = String(value || '').trim();
    return /^\d{4}-\d{2}$/.test(normalized) ? normalized : '';
  }

  function shiftYm(ym, delta) {
    const [year, month] = String(ym).split('-').map(Number);
    const date = new Date(year, month - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function periodBounds(periodValue) {
    const period = normalizeGlobalActivityPeriod(periodValue);
    if (period === ACTIVITY_SEASON_SCHOOL_2027) {
      return {
        period,
        minYm: SCHOOL_2027_START_DATE.slice(0, 7),
        maxYm: SCHOOL_2027_END_DATE.slice(0, 7)
      };
    }
    return {
      period,
      minYm: SCHOOL_2026_START_DATE.slice(0, 7),
      maxYm: SCHOOL_2026_END_DATE.slice(0, 7)
    };
  }

  function clampToPeriod(ym, periodValue) {
    const bounds = periodBounds(periodValue);
    const candidate = validYm(ym) || defaultMonthForGlobalActivityPeriod(bounds.period) || currentMonthYm();
    if (candidate < bounds.minYm) return bounds.minYm;
    if (candidate > bounds.maxYm) return bounds.maxYm;
    return candidate;
  }

  function dashboardCacheKey(ym, periodValue) {
    const bounds = periodBounds(periodValue);
    return `dashboard:${ym}:period:${bounds.period}`;
  }

  async function fetchDashboardMonth(api, ym) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('dashboard_month_navigation_timeout')), 22000);
    });
    try {
      const payload = await Promise.race([
        api.dashboardSnapshot({ month: ym }),
        timeout
      ]);
      const returnedMonth = validYm(payload?.month || payload?.requested_month);
      if (returnedMonth && returnedMonth !== ym) {
        throw new Error(`dashboard_month_mismatch:${returnedMonth}`);
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  dashboardScreen.load = async function loadDashboardMonthWithoutFutureClamp({ api, state }) {
    const ym = clampToPeriod(state.dashboardMonthYm, state.activityPeriodTab);
    state.dashboardMonthYm = ym;
    try {
      localStorage.setItem('dashboard_month_ym', ym);
    } catch { /* ignore */ }
    return fetchDashboardMonth(api, ym);
  };

  dashboardScreen.bind = function bindDashboardWithReliableMonthNavigation(context) {
    originalBind?.(context);

    const { root, state, api, rerender, data } = context || {};
    if (!root || !state || !api) return;

    root.addEventListener('click', async (event) => {
      const button = event.target?.closest?.('[data-dash-month-prev],[data-dash-month-next]');
      if (!button || !root.contains(button)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (navigationPending) return;

      const currentYm = clampToPeriod(data?.month || state.dashboardMonthYm, state.activityPeriodTab);
      const delta = button.matches('[data-dash-month-next]') ? 1 : -1;
      const targetYm = clampToPeriod(shiftYm(currentYm, delta), state.activityPeriodTab);
      if (targetYm === currentYm) return;

      navigationPending = true;
      root.querySelectorAll('[data-dash-month-prev],[data-dash-month-next]').forEach((node) => {
        node.disabled = true;
      });
      root.setAttribute('aria-busy', 'true');

      try {
        const payload = await fetchDashboardMonth(api, targetYm);
        const key = dashboardCacheKey(targetYm, state.activityPeriodTab);
        state.screenDataCache[key] = { data: payload, t: Date.now() };
        state.dashboardMonthYm = targetYm;
        try {
          localStorage.setItem('dashboard_month_ym', targetYm);
        } catch { /* ignore */ }
        await rerender?.();
      } catch (error) {
        console.warn('[dashboard-month-navigation:failed]', {
          requested_month: targetYm,
          error: error?.message || String(error)
        });
      } finally {
        navigationPending = false;
        root.removeAttribute('aria-busy');
        root.querySelectorAll('[data-dash-month-prev],[data-dash-month-next]').forEach((node) => {
          node.disabled = false;
        });
      }
    }, true);
  };
})();
