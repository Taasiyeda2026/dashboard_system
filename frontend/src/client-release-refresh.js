export const CLIENT_RELEASE_VERSION = '20260823-global-refresh-v1';

const RELEASE_STORAGE_KEY = 'dashboard_client_release_version';
const GLOBAL_RELOAD_GUARD_KEY = 'dashboard_global_sw_reload_at';
const RELOAD_GUARD_WINDOW_MS = 60_000;
const SCREEN_CACHE_PREFIX = 'ds_screen_cache_v2';

function safeNow(now) {
  const value = Number(now?.());
  return Number.isFinite(value) && value > 0 ? value : Date.now();
}

export function clearClientScreenCaches(storage = globalThis.localStorage) {
  try {
    storage?.removeItem?.('dashboard_routes');
    storage?.removeItem?.('dashboard_screen_cache_v1');
    const keys = [];
    for (let index = 0; index < Number(storage?.length || 0); index += 1) {
      const key = storage?.key?.(index);
      if (key && key.startsWith(SCREEN_CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage?.removeItem?.(key));
    return keys.length;
  } catch {
    return 0;
  }
}

export function clearClientCachesForRelease(storage = globalThis.localStorage) {
  try {
    const previous = String(storage?.getItem?.(RELEASE_STORAGE_KEY) || '').trim();
    if (previous === CLIENT_RELEASE_VERSION) return false;
    clearClientScreenCaches(storage);
    storage?.setItem?.(RELEASE_STORAGE_KEY, CLIENT_RELEASE_VERSION);
    return true;
  } catch {
    return false;
  }
}

function canReload(storage, now) {
  try {
    const previous = Number(storage?.getItem?.(GLOBAL_RELOAD_GUARD_KEY) || 0);
    return !Number.isFinite(previous) || previous <= 0 || now - previous >= RELOAD_GUARD_WINDOW_MS;
  } catch {
    return true;
  }
}

function markReload(storage, now) {
  try {
    storage?.setItem?.(GLOBAL_RELOAD_GUARD_KEY, String(now));
  } catch {
    /* ignore */
  }
}

function hasActiveEdit(documentRef) {
  try {
    return Boolean(documentRef?.querySelector?.('[data-editing="yes"], [data-unsaved-changes="true"], [data-dirty="true"]'));
  } catch {
    return false;
  }
}

/**
 * Keeps already-authenticated tabs on the current frontend build.
 * A newly activated Service Worker reloads the tab once, but an activity form
 * that is actively being edited is allowed to finish first.
 */
export function installGlobalServiceWorkerRefresh(options = {}) {
  const navigatorRef = options.navigatorRef ?? globalThis.navigator;
  const windowRef = options.windowRef ?? globalThis.window;
  const documentRef = options.documentRef ?? globalThis.document;
  const sessionStorageRef = options.sessionStorageRef ?? globalThis.sessionStorage;
  const localStorageRef = options.localStorageRef ?? globalThis.localStorage;
  const now = options.now ?? (() => Date.now());
  const serviceWorker = navigatorRef?.serviceWorker;
  if (!serviceWorker?.addEventListener) return () => {};

  const hadControllerAtStart = Boolean(serviceWorker.controller);
  let pendingReload = false;
  let disposed = false;
  let retryTimer = null;

  const tryReload = () => {
    if (disposed || !pendingReload || !hadControllerAtStart) return false;
    if (hasActiveEdit(documentRef)) return false;
    const timestamp = safeNow(now);
    if (!canReload(sessionStorageRef, timestamp)) return false;
    pendingReload = false;
    markReload(sessionStorageRef, timestamp);
    clearClientScreenCaches(localStorageRef);
    windowRef?.location?.reload?.();
    return true;
  };

  const scheduleRetry = () => {
    if (retryTimer || disposed) return;
    retryTimer = windowRef?.setInterval?.(() => {
      if (!pendingReload || tryReload()) {
        windowRef?.clearInterval?.(retryTimer);
        retryTimer = null;
      }
    }, 1500) || null;
  };

  const onControllerChange = () => {
    if (!hadControllerAtStart) return;
    pendingReload = true;
    if (!tryReload()) scheduleRetry();
  };

  const onReturnToTab = () => {
    if (pendingReload) tryReload();
  };

  serviceWorker.addEventListener('controllerchange', onControllerChange);
  documentRef?.addEventListener?.('visibilitychange', onReturnToTab);
  windowRef?.addEventListener?.('focus', onReturnToTab);

  return () => {
    disposed = true;
    serviceWorker.removeEventListener?.('controllerchange', onControllerChange);
    documentRef?.removeEventListener?.('visibilitychange', onReturnToTab);
    windowRef?.removeEventListener?.('focus', onReturnToTab);
    if (retryTimer) windowRef?.clearInterval?.(retryTimer);
  };
}

if (typeof window !== 'undefined') {
  clearClientCachesForRelease();
  installGlobalServiceWorkerRefresh();
}
