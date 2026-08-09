import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckPlan, isImportOnlyDiff, TEST_GROUPS } from '../scripts/ci/check-plan.mjs';

test('documentation changes select no application work', () => {
  assert.deepEqual(buildCheckPlan(['docs/README.md']).tests, []);
  assert.equal(buildCheckPlan(['docs/README.md']).build, false);
});

test('CSS remains build-validated without selecting business suites', () => {
  const plan = buildCheckPlan(['frontend/src/styles/main.css']);
  assert.equal(plan.build, true);
  assert.deepEqual(plan.tests, []);
});

test('one screen selects only its focused module group', () => {
  const plan = buildCheckPlan(['frontend/src/screens/finance.js']);
  assert.deepEqual(plan.groups, ['finance']);
  assert.deepEqual(plan.tests, ['tests/finance-screen.test.mjs']);
});

test('module logic selects the matching logic suite', () => {
  assert.deepEqual(buildCheckPlan(['frontend/src/screens/course-scheduling-score.js']).groups, ['scheduling']);
});

test('ordinary SQL selects DB guards, while scheduling SQL also requests Postgres', () => {
  const db = buildCheckPlan(['supabase/migrations/20260810_finance.sql']);
  assert.deepEqual(db.groups, ['db']);
  assert.equal(db.postgres, false);
  const scheduling = buildCheckPlan(['supabase/migrations/20260810_scheduling.sql']);
  assert.deepEqual(scheduling.groups, ['db', 'scheduling', 'schedulingDb']);
  assert.equal(scheduling.postgres, true);
});

test('Service Worker selects only PWA checks', () => {
  assert.deepEqual(buildCheckPlan(['frontend/sw.js']).groups, ['pwa']);
});

test('shared state expands only to its known consumers', () => {
  assert.deepEqual(buildCheckPlan(['frontend/src/state.js']).groups, ['activities', 'calendars', 'dashboard']);
});

test('CSS named after a business domain still only build-validates, never that domain\'s tests', () => {
  const plan = buildCheckPlan(['frontend/src/screens/course-scheduling-neutral-colors.css']);
  assert.deepEqual(plan.groups, []);
  assert.deepEqual(plan.tests, []);
  assert.equal(plan.build, true);
});

test('authorities catalog files are not misread as the auth domain', () => {
  const plan = buildCheckPlan(['frontend/src/screens/operations-authorities-cleanup.js']);
  assert.deepEqual(plan.groups, ['operations']);
});

test('isImportOnlyDiff accepts a cache-busting import version bump as non-substantive', () => {
  const diff = [
    '--- a/frontend/src/main.js',
    '+++ b/frontend/src/main.js',
    "-import { loginScreen } from './screens/login.js?v=1';",
    "+import { loginScreen } from './screens/login.js?v=2';"
  ].join('\n');
  assert.equal(isImportOnlyDiff(diff), true);
});

test('isImportOnlyDiff rejects a diff that changes real logic', () => {
  const diff = [
    '--- a/frontend/src/main.js',
    '+++ b/frontend/src/main.js',
    '-if (role === "admin") return true;',
    '+if (role === "admin" || role === "operation_manager") return true;'
  ].join('\n');
  assert.equal(isImportOnlyDiff(diff), false);
});

test('an import/version-only main.js change selects no groups, but a real main.js change still selects auth+permissions', () => {
  const importOnly = buildCheckPlan(['frontend/src/main.js'], { importOnlyFiles: new Set(['frontend/src/main.js']) });
  assert.deepEqual(importOnly.groups, []);
  assert.deepEqual(importOnly.tests, []);

  const real = buildCheckPlan(['frontend/src/main.js']);
  assert.deepEqual(real.groups, ['auth', 'permissions']);
});

test('a real auth-domain file change selects the auth group', () => {
  const plan = buildCheckPlan(['frontend/src/auth-user-resolve.js']);
  assert.deepEqual(plan.groups, ['auth']);
  assert.deepEqual(plan.tests, TEST_GROUPS.auth);
});

test('a real permissions-domain file change selects the permissions group', () => {
  const plan = buildCheckPlan(['frontend/src/screens/permissions.js']);
  assert.deepEqual(plan.groups, ['permissions']);
  assert.deepEqual(plan.tests, TEST_GROUPS.permissions);
});

test('api.js changes select auth and permissions alongside activities/proposals', () => {
  const plan = buildCheckPlan(['frontend/src/api.js']);
  assert.deepEqual(plan.groups, ['activities', 'auth', 'permissions', 'proposals']);
});
