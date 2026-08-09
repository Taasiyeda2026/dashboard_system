import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckPlan } from '../scripts/ci/check-plan.mjs';

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
