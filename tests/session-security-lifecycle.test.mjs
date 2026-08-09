import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DASHBOARD_AUTH_SESSION_KEY,
  DASHBOARD_LAST_ACTIVITY_KEY,
  DASHBOARD_SESSION_OWNER_KEY,
  DASHBOARD_SESSION_STARTED_KEY,
  applyDashboardAuthEvent,
  startDashboardSession
} from '../frontend/src/session-security-lifecycle.js';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function session(userId, sessionId) {
  const payload = Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url');
  return { access_token: `header.${payload}.signature`, user: { id: userId } };
}

test('an explicit login replaces stale dashboard timestamps', () => {
  const store = storage({
    [DASHBOARD_SESSION_STARTED_KEY]: 10,
    [DASHBOARD_LAST_ACTIVITY_KEY]: 20,
    [DASHBOARD_SESSION_OWNER_KEY]: 'user-a',
    [DASHBOARD_AUTH_SESSION_KEY]: 'old-session'
  });
  startDashboardSession(session('user-a', 'new-session'), { storage: store, now: 5000, force: true });
  assert.equal(store.getItem(DASHBOARD_SESSION_STARTED_KEY), '5000');
  assert.equal(store.getItem(DASHBOARD_LAST_ACTIVITY_KEY), '5000');
});

test('user B cannot inherit user A dashboard timestamps', () => {
  const store = storage({
    [DASHBOARD_SESSION_STARTED_KEY]: 100,
    [DASHBOARD_LAST_ACTIVITY_KEY]: 200,
    [DASHBOARD_SESSION_OWNER_KEY]: 'user-a',
    [DASHBOARD_AUTH_SESSION_KEY]: 'session-a'
  });
  applyDashboardAuthEvent('SIGNED_IN', session('user-b', 'session-b'), { storage: store, now: 6000 });
  assert.equal(store.getItem(DASHBOARD_SESSION_STARTED_KEY), '6000');
  assert.equal(store.getItem(DASHBOARD_SESSION_OWNER_KEY), 'user-b');
});

test('TOKEN_REFRESHED preserves the absolute-timeout start for one auth session', () => {
  const store = storage();
  applyDashboardAuthEvent('SIGNED_IN', session('user-a', 'session-a'), { storage: store, now: 1000 });
  const result = applyDashboardAuthEvent('TOKEN_REFRESHED', session('user-a', 'session-a'), { storage: store, now: 7000 });
  assert.equal(result, 'preserved');
  assert.equal(store.getItem(DASHBOARD_SESSION_STARTED_KEY), '1000');
  assert.equal(store.getItem(DASHBOARD_LAST_ACTIVITY_KEY), '1000');
});

test('SIGNED_OUT removes timestamps and auth ownership', () => {
  const store = storage();
  applyDashboardAuthEvent('SIGNED_IN', session('user-a', 'session-a'), { storage: store, now: 1000 });
  applyDashboardAuthEvent('SIGNED_OUT', null, { storage: store });
  assert.equal(store.getItem(DASHBOARD_SESSION_STARTED_KEY), null);
  assert.equal(store.getItem(DASHBOARD_LAST_ACTIVITY_KEY), null);
  assert.equal(store.getItem(DASHBOARD_SESSION_OWNER_KEY), null);
});
