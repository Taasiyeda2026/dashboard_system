export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', {
        scope: './',
        // Never serve the SW script itself from HTTP cache —
        // the browser always fetches a fresh copy so version bumps
        // are detected immediately on every navigation.
        updateViaCache: 'none',
      })
      .then((reg) => {
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
      })
      .catch((error) => {
        console.warn('[Attendance] service worker registration failed', error);
      });
  });
}
