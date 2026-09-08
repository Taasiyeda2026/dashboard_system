import { ensureFeaturesForRoute, preloadScreenModule } from './feature-loaders.js';
import { state } from './state.js';

/**
 * Loads feature bundles when the active route changes.
 * Hover/focus may preload the screen JS module only — never screen.load / data.
 *
 * The proposals route is intentionally different: its feature bundle contains many
 * editor/PDF enhancements that are not required to render the initial proposal list.
 * Let the screen paint first, then warm those enhancements during browser idle time.
 */
(function installFeatureRouteLoader() {
  'use strict';

  if (globalThis.__dsFeatureRouteLoaderInstalled) return;
  globalThis.__dsFeatureRouteLoaderInstalled = true;

  const DEFERRED_FEATURE_ROUTES = new Set(['proposals-agreements']);
  const DEFERRED_FEATURE_MAX_WAIT_MS = 2000;
  const DEFERRED_FEATURE_IDLE_TIMEOUT_MS = 700;
  let lastRoute = '';
  let deferredGeneration = 0;

  function currentRoute() {
    return String(state?.route || document.querySelector('.app-shell')?.dataset?.currentRoute || '');
  }

  function screenHasFirstPaint() {
    const root = document.getElementById('screenRoot');
    if (!root) return false;
    if (root.querySelector('.ds-loading-card, [data-screen-loading], [aria-busy="true"]')) return false;
    return Boolean(root.childElementCount || String(root.textContent || '').trim());
  }

  function loadRouteFeatures(route) {
    ensureFeaturesForRoute(route).catch(() => {});
  }

  function scheduleRouteFeatures(route) {
    const key = String(route || '');
    if (!key) return;

    if (!DEFERRED_FEATURE_ROUTES.has(key)) {
      deferredGeneration += 1;
      loadRouteFeatures(key);
      return;
    }

    const generation = ++deferredGeneration;
    const startedAt = Date.now();

    const runWhenIdle = () => {
      const run = () => {
        if (generation !== deferredGeneration) return;
        if (currentRoute() !== key) return;
        loadRouteFeatures(key);
      };
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, { timeout: DEFERRED_FEATURE_IDLE_TIMEOUT_MS });
      } else {
        setTimeout(run, 0);
      }
    };

    const waitForPaint = () => {
      if (generation !== deferredGeneration) return;
      const activeRoute = currentRoute();
      if (activeRoute && activeRoute !== key) return;
      if (screenHasFirstPaint() || Date.now() - startedAt >= DEFERRED_FEATURE_MAX_WAIT_MS) {
        runWhenIdle();
        return;
      }
      setTimeout(waitForPaint, 40);
    };

    // Give navigation/mount a turn to replace the previous screen with its loading shell.
    setTimeout(waitForPaint, 0);
  }

  function syncFeatures() {
    const route = currentRoute();
    if (!route || route === lastRoute) return;
    lastRoute = route;
    scheduleRouteFeatures(route);
  }

  document.addEventListener('app:navigate', (event) => {
    const route = String(event?.detail?.route || '');
    if (route) scheduleRouteFeatures(route);
  });

  document.addEventListener('pointerover', (event) => {
    const button = event.target?.closest?.('[data-route]');
    const route = String(button?.dataset?.route || '');
    if (!route || route === currentRoute()) return;
    preloadScreenModule(route).catch(() => {});
  }, { passive: true, capture: true });

  document.addEventListener('focusin', (event) => {
    const button = event.target?.closest?.('[data-route]');
    const route = String(button?.dataset?.route || '');
    if (!route || route === currentRoute()) return;
    preloadScreenModule(route).catch(() => {});
  }, true);

  const observer = new MutationObserver(() => syncFeatures());
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-current-route', 'class']
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncFeatures, { once: true });
  } else {
    syncFeatures();
  }
})();
