import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DASHBOARD_INACTIVITY_TIMEOUT_MS,
  DASHBOARD_ABSOLUTE_TIMEOUT_MS,
  PERSONAL_REPORTS_INACTIVITY_TIMEOUT_MS,
  dashboardSessionExpiryReason,
  personalReportsSessionExpired
} from '../frontend/src/session-security-policy.js';

test('dashboard expires after one hour without activity', () => {
  const now = 10_000_000;
  assert.equal(dashboardSessionExpiryReason({
    now,
    startedAt: now - 2 * 60 * 60 * 1000,
    lastActivityAt: now - DASHBOARD_INACTIVITY_TIMEOUT_MS
  }), 'inactivity_timeout');
});

test('dashboard expires after eight hours even with recent activity', () => {
  const now = 40_000_000;
  assert.equal(dashboardSessionExpiryReason({
    now,
    startedAt: now - DASHBOARD_ABSOLUTE_TIMEOUT_MS,
    lastActivityAt: now - 1000
  }), 'absolute_timeout');
});

test('dashboard remains active within both limits', () => {
  const now = 20_000_000;
  assert.equal(dashboardSessionExpiryReason({
    now,
    startedAt: now - 7 * 60 * 60 * 1000,
    lastActivityAt: now - 30 * 60 * 1000
  }), '');
});

test('personal reports lock after fifteen minutes without activity', () => {
  const now = 20_000_000;
  assert.equal(personalReportsSessionExpired({
    now,
    lastActivityAt: now - PERSONAL_REPORTS_INACTIVITY_TIMEOUT_MS
  }), true);
  assert.equal(personalReportsSessionExpired({
    now,
    lastActivityAt: now - PERSONAL_REPORTS_INACTIVITY_TIMEOUT_MS + 1
  }), false);
});

test('runtime restores personal reports in a locked state after timeout', () => {
  const runtime = readFileSync(new URL('../frontend/src/session-security-runtime.js', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
  assert.match(runtime, /dashboard_pending_route/);
  assert.match(runtime, /'personal-reports'/);
  assert.match(runtime, /window\.location\.reload\(\)/);
  assert.match(runtime, /pagehide/);
  assert.match(entry, /session-security-runtime\.js/);
});

test('DOM observation only checks a session and does not manufacture activity or a new session start', () => {
  const runtime = readFileSync(new URL('../frontend/src/session-security-runtime.js', import.meta.url), 'utf8');
  const observerBody = runtime.match(/sessionSecurityObserver = new MutationObserver\(\(\) => \{([\s\S]*?)\n  \}\);/)?.[1] || '';
  assert.match(observerBody, /checkDashboardSessionTimeout/);
  assert.doesNotMatch(observerBody, /recordDashboardActivity|resetDashboardSessionTimeoutState|startDashboardSession/);
});

test('expired Supabase proposal requests use the shared logout path and login expiry message', () => {
  const runtime = readFileSync(new URL('../frontend/src/session-security-runtime.js', import.meta.url), 'utf8');
  const proposals = readFileSync(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
  assert.match(runtime, /handleSupabaseSessionFailure/);
  assert.match(runtime, /await expireDashboardSession\('auth_session_expired'\)/);
  assert.match(proposals, /await handleSupabaseSessionFailure\(error\)/);
  assert.match(proposals, /await handleSupabaseSessionFailure\(err\)/);
  assert.match(main, /פג תוקף ההתחברות\. יש להתחבר מחדש\./);
});
