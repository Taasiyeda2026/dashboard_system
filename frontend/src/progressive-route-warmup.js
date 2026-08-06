import { preloadScreenModule } from './feature-loaders.js';
import { state } from './state.js';

/*
 * Progressive route warm-up (JS modules only)
 * -------------------------------------------
 * Hover/focus may preload the screen JavaScript module.
 * This runtime must NEVER invoke screen load APIs or write screenDataCache.
 */
(function installProgressiveRouteWarmup() {
  'use strict';

  if (globalThis.__dsProgressiveRouteWarmupInstalled) return;
  globalThis.__dsProgressiveRouteWarmupInstalled = true;

  // Hard disable any legacy data-warming path.
  globalThis.__DS_PROGRESSIVE_ROUTE_WARMUP__ = false;
  globalThis.__DS_DISABLE_SCREEN_DATA_WARMUP__ = true;

  function unlockRouteNavigation() {
    const shell = document.querySelector('.app-shell.is-route-loading');
    if (!shell) return;
    shell.querySelectorAll('[data-route][disabled]').forEach((button) => {
      button.disabled = false;
      button.removeAttribute('aria-disabled');
    });
  }

  function maybePreloadModule(route) {
    const next = String(route || '');
    if (!next || !state?.token) return;
    if (next === state.route) return;
    preloadScreenModule(next).catch(() => {});
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
      maybePreloadModule(button?.dataset?.route);
    }, { passive: true, capture: true });

    document.addEventListener('focusin', (event) => {
      const button = event.target?.closest?.('[data-route]');
      maybePreloadModule(button?.dataset?.route);
    }, true);

    const observer = new MutationObserver(() => unlockRouteNavigation());
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'disabled']
    });

    unlockRouteNavigation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installUiHooks, { once: true });
  } else {
    installUiHooks();
  }
})();
