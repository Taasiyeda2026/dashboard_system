import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../frontend/src/inspiration-session-bridge.js', import.meta.url), 'utf8');
const bridge = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const nonce = 'a'.repeat(43);
const origin = 'https://portzot-derech.org';
const dashboardOrigin = 'https://taasiyeda2026.github.io';
function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => map.get(key), setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}

test('bridge allowlist rejects attacker origins, malformed state and production localhost', () => {
  assert.equal(bridge.validBridgeRequest(origin, nonce, dashboardOrigin), true);
  assert.equal(bridge.validBridgeRequest(dashboardOrigin, nonce, dashboardOrigin), true);
  for (const invalid of ['https://portzot-derech.org.evil.test', 'https://evil.test', 'null', 'javascript:alert(1)', 'https://portzot-derech.org/']) {
    assert.equal(bridge.validBridgeRequest(invalid, nonce, dashboardOrigin), false);
  }
  assert.equal(bridge.validBridgeRequest(origin, 'short', dashboardOrigin), false);
  assert.equal(bridge.validBridgeRequest('http://localhost:3000', nonce, dashboardOrigin), false);
  assert.equal(bridge.validBridgeRequest('http://localhost:3000', nonce, 'http://127.0.0.1:5173'), true);
});

test('pending return survives login and expires without arbitrary redirect', async () => {
  const storage = memoryStorage();
  bridge.rememberBridgeRequest(storage, { origin, state: nonce }, 1000);
  assert.deepEqual(bridge.readBridgeRequest(storage, dashboardOrigin, 2000), { origin, state: nonce, at: 1000 });
  assert.equal(bridge.readBridgeRequest(storage, dashboardOrigin, 601001), null);
  bridge.rememberBridgeRequest(storage, { origin: 'https://evil.test', state: nonce }, 1000);
  assert.equal(bridge.readBridgeRequest(storage, dashboardOrigin, 2000), null);
});

test('return to bridge requires verified Supabase user and never puts tokens in URL', async () => {
  const storage = memoryStorage();
  const location = { href: dashboardOrigin + '/dashboard_system/', origin: dashboardOrigin, replace: (url) => { location.target = url; } };
  bridge.rememberBridgeRequest(storage, { origin, state: nonce });
  assert.equal(await bridge.resumeInspirationBridge({ client: { auth: { getUser: async () => ({ data: { user: null } }) } }, storage, location }), false);
  assert.equal(location.target, undefined);
  assert.equal(await bridge.resumeInspirationBridge({ client: { auth: { getUser: async () => ({ data: { user: { id: 'verified' } } }) } }, storage, location }), true);
  const target = new URL(location.target);
  assert.equal(target.pathname, '/dashboard_system/inspiration-bridge.html');
  assert.equal(target.searchParams.get('origin'), origin);
  assert.equal(target.searchParams.get('state'), nonce);
  assert.equal(target.searchParams.size, 2);
});

test('access token handoff verifies matching identity and never exports dashboard refresh token', async () => {
  const session = { access_token: 'test-access', refresh_token: 'test-refresh', user: { id: 'user-a' } };
  const client = (user) => ({ auth: { getSession: async () => ({ data: { session } }), getUser: async (token) => { assert.equal(token, session.access_token); return { data: { user } }; } } });
  assert.equal(await bridge.verifiedSession(client({ id: 'user-b' })), null);
  assert.equal(await bridge.verifiedSession(client(null)), null);
  assert.deepEqual(await bridge.verifiedSession(client({ id: 'user-a' })), { access_token: 'test-access' });
  delete session.refresh_token;
  assert.deepEqual(await bridge.verifiedSession(client({ id: 'user-a' })), { access_token: 'test-access' });
});

test('instructor shortcut is a visibility hint and bridge uses exact postMessage target', () => {
  assert.equal(bridge.canShowInspirationLink({ role: 'instructor' }), true);
  assert.equal(bridge.canShowInspirationLink({ role: 'admin' }), true);
  assert.equal(bridge.canShowInspirationLink({ role: 'manager', permissions: { inspiration_manage: true } }), true);
  assert.equal(bridge.canShowInspirationLink({ role: 'manager', permissions: { inspiration_manage: 'true' } }), false);
  assert.equal(bridge.canShowInspirationLink({ role: 'manager' }), false);
  const page = readFileSync(new URL('../frontend/src/inspiration-bridge-page.js', import.meta.url), 'utf8');
  assert.match(page, /window\.opener\.postMessage\([\s\S]*request\.origin\)/);
  assert.doesNotMatch(page, /postMessage\([^\n]*['"]\*['"]/);
  const sw = readFileSync(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /p\.endsWith\('\/inspiration-bridge\.html'\)/);
});
