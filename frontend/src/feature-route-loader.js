import { ensureFeaturesForRoute, preloadScreenModule } from './feature-loaders.js';
import { state } from './state.js';

/**
 * Loads feature bundles when the active route changes.
 * Hover/focus may preload the screen JS module only — never screen.load / data.
 */
(function installFeatureRouteLoader() {
  'use strict';

  if (globalThis.__dsFeatureRouteLoaderInstalled) return;
  globalThis.__dsFeatureRouteLoaderInstalled = true;

  let lastRoute = '';

  function currentRoute() {
    return String(state?.route || document.querySelector('.app-shell')?.dataset?.currentRoute || '');
  }

  function syncFeatures() {
    const route = currentRoute();
    if (!route || route === lastRoute) return;
    lastRoute = route;
    ensureFeaturesForRoute(route).catch(() => {});
  }

  document.addEventListener('app:navigate', (event) => {
    const route = String(event?.detail?.route || '');
    if (route) ensureFeaturesForRoute(route).catch(() => {});
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
