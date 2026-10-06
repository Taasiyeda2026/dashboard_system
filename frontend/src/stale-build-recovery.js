const RECOVERY_SESSION_KEY = 'dashboard_stale_dynamic_import_recovery';
const DASHBOARD_STATIC_CACHE_PREFIX = 'dashboard-static-v';

function errorMessage(value) {
  if (value instanceof Error) return value.message || String(value);
  if (value && typeof value === 'object') {
    if (value.message) return String(value.message);
    if (value.reason) return errorMessage(value.reason);
  }
  return String(value || '');
}

export function isStaleDynamicImportError(value) {
  const message = errorMessage(value).toLowerCase();
  return message.includes('failed to fetch dynamically imported module')
    || message.includes('error loading dynamically imported module')
    || message.includes('importing a module script failed');
}

export async function purgeDashboardStaticCaches(cacheStorage = globalThis.caches) {
  if (!cacheStorage?.keys || !cacheStorage?.delete) return [];
  const keys = await cacheStorage.keys();
  const stale = keys.filter((key) => String(key).startsWith(DASHBOARD_STATIC_CACHE_PREFIX));
  await Promise.all(stale.map((key) => cacheStorage.delete(key)));
  return stale;
}

export async function requestFreshServiceWorker(serviceWorker = globalThis.navigator?.serviceWorker) {
  if (!serviceWorker?.getRegistration) return false;
  const registration = await serviceWorker.getRegistration();
  if (!registration) return false;
  try {
    await registration.update();
  } catch {
    // A reload still goes network-first even when the explicit SW update is unavailable.
  }
  registration.waiting?.postMessage?.({ type: 'SKIP_WAITING' });
  return true;
}

function currentBuildMarker(win) {
  return String(win?.__FRONTEND_BUILD_MARKER__ || win?.__HOTFIX_VERSION__ || 'unknown-build');
}

export async function recoverFromStaleBuild({
  win = globalThis.window,
  cacheStorage = globalThis.caches,
  serviceWorker = globalThis.navigator?.serviceWorker
} = {}) {
  if (!win?.location?.reload) return false;
  const marker = currentBuildMarker(win);
  try {
    if (win.sessionStorage?.getItem(RECOVERY_SESSION_KEY) === marker) return false;
    win.sessionStorage?.setItem(RECOVERY_SESSION_KEY, marker);
  } catch {
    // sessionStorage can be blocked; recovery should still be attempted.
  }

  console.warn('[stale-build] recovering from a missing dynamic module', { marker });
  try {
    await purgeDashboardStaticCaches(cacheStorage);
  } catch (error) {
    console.warn('[stale-build] cache cleanup skipped', error);
  }
  try {
    await requestFreshServiceWorker(serviceWorker);
  } catch (error) {
    console.warn('[stale-build] service worker refresh skipped', error);
  }
  win.location.reload();
  return true;
}

export function installStaleBuildRecovery(win = globalThis.window, recover = recoverFromStaleBuild) {
  if (!win?.addEventListener || win.__DASHBOARD_STALE_BUILD_RECOVERY_BOUND__) return false;
  win.__DASHBOARD_STALE_BUILD_RECOVERY_BOUND__ = true;

  win.addEventListener('vite:preloadError', (event) => {
    event?.preventDefault?.();
    void recover({ win });
  });

  win.addEventListener('unhandledrejection', (event) => {
    if (!isStaleDynamicImportError(event?.reason)) return;
    event?.preventDefault?.();
    void recover({ win });
  });
  return true;
}

if (typeof window !== 'undefined') installStaleBuildRecovery(window);
