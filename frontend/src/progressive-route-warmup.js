import { api } from './api.js';
import { state } from './state.js';
import { normalizeGlobalActivityPeriod } from './screens/shared/summer-activity.js';

/*
 * Progressive route warm-up
 * -------------------------
 * The application used to choose between two poor experiences:
 * - load several large activity screens in parallel after login; or
 * - wait for the first click on every screen and show a blocking loader.
 *
 * This runtime warms likely next screens one at a time, during idle time. It
 * stores only the current-session screen payload in state.screenDataCache; no
 * response is persisted here and no old payload survives a reload.
 */
(function installProgressiveRouteWarmup() {
  'use strict';

  if (globalThis.__dsProgressiveRouteWarmupInstalled) return;
  globalThis.__dsProgressiveRouteWarmupInstalled = true;

  const ROUTES = new Map([
    ['activities', () => import('./screens/activities.js').then((m) => m.activitiesScreen)],
    ['week', () => import('./screens/week.js').then((m) => m.weekScreen)],
    ['month', () => import('./screens/month.js').then((m) => m.monthScreen)],
    ['end-dates', () => import('./screens/end-dates.js').then((m) => m.endDatesScreen)],
    ['exceptions', () => import('./screens/exceptions.js').then((m) => m.exceptionsScreen)],
    ['instructors', () => import('./screens/instructors.js?v=20260730-instructor-matching-modal-v1').then((m) => m.instructorsScreen)],
    ['archive', () => import('./screens/archive.js').then((m) => m.archiveScreen)],
    ['edit-requests', () => import('./screens/edit-requests.js').then((m) => m.editRequestsScreen)],
    ['proposals-agreements', () => import('./screens/proposals-agreements.js').then((m) => m.proposalsAgreementsScreen)],
    ['operations-management', () => import('./screens/operations-management.js').then((m) => m.operationsManagementScreen)],
    ['invitations', () => import('./screens/invitations.js').then((m) => m.invitationsScreen)],
    ['catalog', () => import('./screens/catalog.js').then((m) => m.catalogScreen)],
    ['finance', () => import('./screens/finance.js').then((m) => m.financeScreen)]
  ]);

  const IDLE_WARM_ORDER = [
    'activities',
    'end-dates',
    'exceptions',
    'instructors',
    'archive',
    'edit-requests'
  ];

  const queued = new Set();
  const warmed = new Set();
  const queue = [];
  let queueRunning = false;
  let idleWarmScheduled = false;

  function allowedRoutes() {
    const source = Array.isArray(state?.effectiveRoutes) && state.effectiveRoutes.length
      ? state.effectiveRoutes
      : state?.routes;
    return new Set(Array.isArray(source) ? source : []);
  }

  function routeAllowed(route) {
    return ROUTES.has(route) && allowedRoutes().has(route);
  }

  function currentYm() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function cacheKeyForRoute(route) {
    const period = normalizeGlobalActivityPeriod(state?.activityPeriodTab || 'regular');
    const withPeriod = (base) => `${base}:period:${period}`;
    if (route === 'activities') return 'activities:periods';
    if (route === 'week') return withPeriod(`week:${state?.weekOffset || 0}`);
    if (route === 'month') {
      const ym = /^\d{4}-\d{2}$/.test(String(state?.monthYm || '')) ? state.monthYm : currentYm();
      return withPeriod(`month:${ym}`);
    }
    if (route === 'exceptions') return withPeriod('exceptions');
    if (['archive', 'operations-management'].includes(route)) return withPeriod(route);
    return route;
  }

  function cacheAlreadyAvailable(route) {
    const key = cacheKeyForRoute(route);
    return Boolean(state?.screenDataCache?.[key]?.data);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForIdle(timeout = 1200) {
    return new Promise((resolve) => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => resolve(), { timeout });
      } else {
        setTimeout(resolve, Math.min(timeout, 450));
      }
    });
  }

  function withTimeout(promise, timeoutMs = 22000) {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('progressive_route_warmup_timeout')), timeoutMs);
      })
    ]).finally(() => clearTimeout(timer));
  }

  async function warmRoute(route) {
    if (!state?.token || !routeAllowed(route) || cacheAlreadyAvailable(route)) return;
    const loader = ROUTES.get(route);
    if (!loader) return;

    const capturedToken = state.token;
    const capturedUserId = String(state?.user?.user_id || '');
    const cacheKey = cacheKeyForRoute(route);
    const screen = await loader();
    if (!screen?.load || cacheAlreadyAvailable(route)) return;

    const previousFlag = globalThis.__DS_PROGRESSIVE_ROUTE_WARMUP__;
    globalThis.__DS_PROGRESSIVE_ROUTE_WARMUP__ = true;
    try {
      const data = await withTimeout(screen.load({ api, state }));
      if (!state?.token || state.token !== capturedToken) return;
      if (capturedUserId && String(state?.user?.user_id || '') !== capturedUserId) return;
      if (!state.screenDataCache || data == null) return;
      if (!state.screenDataCache[cacheKey]?.data) {
        state.screenDataCache[cacheKey] = { data, t: Date.now(), warmed: true };
      }
      warmed.add(route);
    } catch (error) {
      if (String(error?.code || error?.message || '') !== 'dashboard_background_prefetch_skipped') {
        console.info('[route-warmup:skipped]', { route, error: error?.message || String(error) });
      }
    } finally {
      globalThis.__DS_PROGRESSIVE_ROUTE_WARMUP__ = previousFlag;
    }
  }

  function enqueue(route, { urgent = false } = {}) {
    if (!routeAllowed(route) || warmed.has(route) || queued.has(route) || cacheAlreadyAvailable(route)) return;
    queued.add(route);
    if (urgent) queue.unshift({ route, urgent: true });
    else queue.push({ route, urgent: false });
    drainQueue();
  }

  async function drainQueue() {
    if (queueRunning) return;
    queueRunning = true;
    try {
      while (queue.length && state?.token) {
        const item = queue.shift();
        queued.delete(item.route);

        // Background warming pauses while the user works on another screen.
        // Hover/focus warming is considered explicit intent and may continue.
        if (!item.urgent && state.route !== 'dashboard') continue;
        if (document.visibilityState === 'hidden' && !item.urgent) {
          await wait(800);
          enqueue(item.route);
          continue;
        }

        if (!item.urgent) await waitForIdle();
        await warmRoute(item.route);
        await wait(item.urgent ? 40 : 350);
      }
    } finally {
      queueRunning = false;
      if (queue.length) drainQueue();
    }
  }

  function scheduleIdleWarmup() {
    if (idleWarmScheduled || !state?.token || state.route !== 'dashboard') return;
    idleWarmScheduled = true;
    setTimeout(() => {
      idleWarmScheduled = false;
      if (!state?.token || state.route !== 'dashboard') return;
      IDLE_WARM_ORDER.forEach((route) => enqueue(route));
    }, 900);
  }

  function unlockRouteNavigation() {
    const shell = document.querySelector('.app-shell.is-route-loading');
    if (!shell) return;
    shell.querySelectorAll('[data-route][disabled]').forEach((button) => {
      button.disabled = false;
      button.removeAttribute('aria-disabled');
    });
  }

  function installUiHooks() {
    if (document.getElementById('progressive-route-warmup-styles')) return;
    const style = document.createElement('style');
    style.id = 'progressive-route-warmup-styles';
    style.textContent = `
      .app-shell.is-route-loading [data-route] { opacity: 1; cursor: pointer; }
      .app-shell.is-route-loading #screenRoot > .ds-loading-card {
        min-height: 150px;
        margin-top: 14px;
      }
    `;
    document.head.append(style);

    document.addEventListener('pointerover', (event) => {
      const button = event.target?.closest?.('[data-route]');
      const route = String(button?.dataset?.route || '');
      if (route && route !== state.route) enqueue(route, { urgent: true });
    }, { passive: true, capture: true });

    document.addEventListener('focusin', (event) => {
      const button = event.target?.closest?.('[data-route]');
      const route = String(button?.dataset?.route || '');
      if (route && route !== state.route) enqueue(route, { urgent: true });
    }, true);

    const observer = new MutationObserver(() => {
      unlockRouteNavigation();
      scheduleIdleWarmup();
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'disabled']
    });

    unlockRouteNavigation();
    scheduleIdleWarmup();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installUiHooks, { once: true });
  } else {
    installUiHooks();
  }
})();
