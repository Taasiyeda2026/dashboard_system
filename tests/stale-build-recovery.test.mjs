import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installStaleBuildRecovery,
  isStaleDynamicImportError,
  recoverFromStaleBuild
} from '../frontend/src/stale-build-recovery.js';

test('recognizes stale Vite dynamic-import failures without treating generic network errors as stale builds', () => {
  assert.equal(isStaleDynamicImportError(new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/chunk-old.js')), true);
  assert.equal(isStaleDynamicImportError(new Error('Error loading dynamically imported module')), true);
  assert.equal(isStaleDynamicImportError(new Error('Importing a module script failed')), true);
  assert.equal(isStaleDynamicImportError(new Error('Failed to fetch attendance rows')), false);
});

test('binds Vite preload recovery and the unhandled-rejection fallback', async () => {
  const handlers = new Map();
  let recoveries = 0;
  const win = {
    addEventListener(name, handler) { handlers.set(name, handler); }
  };
  const recover = async () => { recoveries += 1; };
  assert.equal(installStaleBuildRecovery(win, recover), true);
  assert.equal(installStaleBuildRecovery(win, recover), false);

  let prevented = 0;
  handlers.get('vite:preloadError')({ preventDefault() { prevented += 1; } });
  handlers.get('unhandledrejection')({
    reason: new TypeError('Failed to fetch dynamically imported module: old.js'),
    preventDefault() { prevented += 1; }
  });
  handlers.get('unhandledrejection')({
    reason: new Error('ordinary request failed'),
    preventDefault() { prevented += 100; }
  });
  await Promise.resolve();
  assert.equal(recoveries, 2);
  assert.equal(prevented, 2);
});

test('recovery purges only dashboard static caches, refreshes the worker and reloads once per build', async () => {
  const store = new Map();
  const sessionStorage = {
    getItem(key) { return store.get(key) || null; },
    setItem(key, value) { store.set(key, String(value)); }
  };
  let reloads = 0;
  const win = {
    __FRONTEND_BUILD_MARKER__: 'build-20261006',
    sessionStorage,
    location: { reload() { reloads += 1; } }
  };
  const deleted = [];
  const cacheStorage = {
    async keys() { return ['dashboard-static-v1913', 'dashboard-static-v1914', 'unrelated-cache']; },
    async delete(key) { deleted.push(key); return true; }
  };
  let updates = 0;
  const messages = [];
  const serviceWorker = {
    async getRegistration() {
      return {
        async update() { updates += 1; },
        waiting: { postMessage(message) { messages.push(message); } }
      };
    }
  };

  assert.equal(await recoverFromStaleBuild({ win, cacheStorage, serviceWorker }), true);
  assert.deepEqual(deleted, ['dashboard-static-v1913', 'dashboard-static-v1914']);
  assert.equal(updates, 1);
  assert.deepEqual(messages, [{ type: 'SKIP_WAITING' }]);
  assert.equal(reloads, 1);
  assert.equal(await recoverFromStaleBuild({ win, cacheStorage, serviceWorker }), false);
  assert.equal(reloads, 1);
});
