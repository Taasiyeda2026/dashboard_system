export const LOGIN_SW_RELOAD_GUARD_KEY = 'dashboard_login_sw_reload_at';

const DEFAULT_UPDATE_CHECK_TIMEOUT_MS = 2500;
const DEFAULT_ACTIVATION_TIMEOUT_MS = 2200;
const DEFAULT_POST_LOGIN_WAIT_MS = 3200;
const RELOAD_GUARD_WINDOW_MS = 60_000;

function withTimeout(promise, timeoutMs, fallbackValue) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallbackValue);
    }, Math.max(0, Number(timeoutMs) || 0));

    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallbackValue);
      }
    );
  });
}

function noopAttempt() {
  return {
    async reloadIfUpdated() { return false; },
    dispose() {}
  };
}

function waitForWorkerReady(worker, timeoutMs) {
  if (!worker) return Promise.resolve(false);
  if (worker.state === 'activated' || worker.state === 'installed') return Promise.resolve(true);
  if (worker.state === 'redundant') return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener?.('statechange', onStateChange);
      resolve(value);
    };
    const onStateChange = () => {
      if (worker.state === 'activated' || worker.state === 'installed') finish(true);
      else if (worker.state === 'redundant') finish(false);
    };
    const timer = setTimeout(() => finish(false), Math.max(0, Number(timeoutMs) || 0));
    worker.addEventListener?.('statechange', onStateChange);
  });
}

function canReload(storage, now) {
  try {
    const previous = Number(storage?.getItem?.(LOGIN_SW_RELOAD_GUARD_KEY) || 0);
    return !Number.isFinite(previous) || previous <= 0 || now - previous >= RELOAD_GUARD_WINDOW_MS;
  } catch {
    return true;
  }
}

function markReload(storage, now) {
  try {
    storage?.setItem?.(LOGIN_SW_RELOAD_GUARD_KEY, String(now));
  } catch {
    /* ignore */
  }
}

/**
 * Starts a Service Worker update check while the login request is running.
 * The page is reloaded only after login succeeds, only when a newer worker
 * actually became the controller, and at most once per minute per tab.
 */
export function beginLoginServiceWorkerUpdate(options = {}) {
  const navigatorRef = options.navigatorRef ?? globalThis.navigator;
  const windowRef = options.windowRef ?? globalThis.window;
  const sessionStorageRef = options.sessionStorageRef ?? globalThis.sessionStorage;
  const now = options.now ?? (() => Date.now());
  const updateCheckTimeoutMs = options.updateCheckTimeoutMs ?? DEFAULT_UPDATE_CHECK_TIMEOUT_MS;
  const activationTimeoutMs = options.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS;
  const postLoginWaitMs = options.postLoginWaitMs ?? DEFAULT_POST_LOGIN_WAIT_MS;
  const serviceWorker = navigatorRef?.serviceWorker;

  // A first-time installation does not represent stale controlled assets, so it
  // should not cause a reload during the user's first login.
  if (!serviceWorker?.controller || typeof serviceWorker.getRegistration !== 'function') {
    return noopAttempt();
  }

  let disposed = false;
  let registration = null;
  let controllerChanged = false;
  let resolveControllerChange;
  const controllerChangePromise = new Promise((resolve) => {
    resolveControllerChange = resolve;
  });

  const onControllerChange = () => {
    controllerChanged = true;
    resolveControllerChange?.(true);
  };
  serviceWorker.addEventListener?.('controllerchange', onControllerChange);

  const checkPromise = (async () => {
    try {
      registration = await serviceWorker.getRegistration();
      if (!registration || typeof registration.update !== 'function') return false;

      const activeAtStart = registration.active || null;
      const updatedRegistration = await withTimeout(
        registration.update(),
        updateCheckTimeoutMs,
        null
      );
      if (updatedRegistration) registration = updatedRegistration;
      if (controllerChanged) return true;

      if (registration.waiting) {
        registration.waiting.postMessage?.({ type: 'SKIP_WAITING' });
        await withTimeout(controllerChangePromise, activationTimeoutMs, false);
        return controllerChanged;
      }

      if (registration.installing) {
        await waitForWorkerReady(registration.installing, activationTimeoutMs);
        if (registration.waiting) {
          registration.waiting.postMessage?.({ type: 'SKIP_WAITING' });
          await withTimeout(controllerChangePromise, activationTimeoutMs, false);
        }
      }

      if (controllerChanged) return true;
      return Boolean(activeAtStart && registration.active && registration.active !== activeAtStart);
    } catch {
      return false;
    }
  })();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    serviceWorker.removeEventListener?.('controllerchange', onControllerChange);
  };

  return {
    async reloadIfUpdated() {
      const activated = await withTimeout(checkPromise, postLoginWaitMs, false);
      if (disposed || (!activated && !controllerChanged)) {
        dispose();
        return false;
      }

      const timestamp = Number(now()) || Date.now();
      if (!canReload(sessionStorageRef, timestamp)) {
        dispose();
        return false;
      }

      markReload(sessionStorageRef, timestamp);
      dispose();
      windowRef?.location?.reload?.();
      return true;
    },
    dispose
  };
}
