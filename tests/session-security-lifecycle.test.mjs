import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearDashboardSessionLifecycle,
  dashboardAuthSessionIdentity,
  isSupabaseSessionExpiredError,
  reconcileDashboardSessionLifecycle
} from '../frontend/src/session-security-lifecycle.js';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.get(key) ?? null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

function jwt(payload) {
  return `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.x`;
}
function session(userId, sessionId) {
  return { user: { id: userId }, access_token: jwt({ session_id: sessionId }) };
}

test('lifecycle identity is tied to the auth user and Supabase session id', () => {
  assert.deepEqual(dashboardAuthSessionIdentity(session('user-a', 'session-a')), {
    userId: 'user-a', sessionId: 'session-a'
  });
});

test('a fresh sign-in resets started_at and last_activity_at', () => {
  const storage = new MemoryStorage();
  reconcileDashboardSessionLifecycle(session('user-a', 'session-a'), { storage, event: 'SIGNED_IN', now: 100 });
  assert.equal(storage.getItem('dashboard_session_started_at'), '100');
  assert.equal(storage.getItem('dashboard_session_last_activity_at'), '100');
});

test('switching users cannot inherit lifecycle timestamps', () => {
  const storage = new MemoryStorage();
  reconcileDashboardSessionLifecycle(session('user-a', 'session-a'), { storage, event: 'INITIAL_SESSION', now: 100 });
  reconcileDashboardSessionLifecycle(session('user-b', 'session-b'), { storage, event: 'TOKEN_REFRESHED', now: 500 });
  assert.equal(storage.getItem('dashboard_session_started_at'), '500');
  assert.equal(storage.getItem('dashboard_session_owner'), 'user-b');
});

test('TOKEN_REFRESHED for the same auth session preserves absolute start time', () => {
  const storage = new MemoryStorage();
  reconcileDashboardSessionLifecycle(session('user-a', 'session-a'), { storage, event: 'INITIAL_SESSION', now: 100 });
  reconcileDashboardSessionLifecycle(session('user-a', 'session-a'), { storage, event: 'TOKEN_REFRESHED', now: 900 });
  assert.equal(storage.getItem('dashboard_session_started_at'), '100');
});

test('signed out lifecycle is cleared', () => {
  const storage = new MemoryStorage();
  reconcileDashboardSessionLifecycle(session('user-a', 'session-a'), { storage, event: 'SIGNED_IN', now: 100 });
  clearDashboardSessionLifecycle(storage);
  assert.equal(storage.getItem('dashboard_session_started_at'), null);
  assert.equal(storage.getItem('dashboard_session_owner'), null);
});

test('Supabase expiry errors are recognized without treating ordinary failures as expiry', () => {
  assert.equal(isSupabaseSessionExpiredError({ status: 401, message: 'Unauthorized' }), true);
  assert.equal(isSupabaseSessionExpiredError({ code: 'PGRST301', message: 'JWT expired' }), true);
  assert.equal(isSupabaseSessionExpiredError({ status: 500, message: 'database unavailable' }), false);
});
