export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    const hadController = !!navigator.serviceWorker.controller;
    let reloadingForUpdate = false;
    let lastUpdateCheckAt = 0;
    let updatePending = false;
    let updateObserver = null;

    function reloadWhenSafe() {
      if (!updatePending || reloadingForUpdate) return;
      // Keep the whole reporting screen alive, including drafts in hidden tabs
      // and requests still saving. Apply the update after leaving that screen.
      if (document.querySelector('form, .av2-daily-travel, .av2-expenses-tab')) return;
      reloadingForUpdate = true;
      updateObserver?.disconnect();
      window.location.reload();
    }

    // A newly activated worker must replace the JavaScript already running in
    // an installed PWA. Without this, an Android home-screen app can keep an
    // old Attendance UI alive even after the new worker has taken control.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloadingForUpdate) return;
      updatePending = true;
      if (!updateObserver) {
        updateObserver = new MutationObserver(reloadWhenSafe);
        updateObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
      reloadWhenSafe();
    });

    navigator.serviceWorker
      .register('./sw.js', {
        scope: './',
        // Never serve the SW script itself from HTTP cache —
        // the browser always fetches a fresh copy so version bumps
        // are detected immediately on every navigation.
        updateViaCache: 'none',
      })
      .then((reg) => {
        const requestFreshWorker = () => {
          const now = Date.now();
          if (now - lastUpdateCheckAt < 60_000) return;
          lastUpdateCheckAt = now;
          reg.update().catch((error) => {
            console.warn('[Attendance] service worker update check failed', error);
          });
        };

        // Prompt any waiting SW to activate without waiting for all
        // clients to close (skip the "waiting" phase).
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing;
          if (!newSW) return;
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              // New SW installed and waiting — activate immediately.
              newSW.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // Check immediately and whenever an installed PWA returns to the
        // foreground. The throttle prevents repeated network checks.
        requestFreshWorker();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') requestFreshWorker();
        });
      })
      .catch((error) => {
        console.warn('[Attendance] service worker registration failed', error);
      });
  });
}

