import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckPlan } from '../scripts/ci/check-plan.mjs';

const COSMETIC_MAIN_JS_DIFF = `diff --git a/frontend/src/main.js b/frontend/src/main.js
--- a/frontend/src/main.js
+++ b/frontend/src/main.js
@@ -641 +641 @@
-  instructors: () => import('./screens/instructors.js?v=old-marker-v1').then((m) => m.instructorsScreen),
+  instructors: () => import('./screens/instructors.js?v=new-marker-v2').then((m) => m.instructorsScreen),
`;

const FUNCTIONAL_MAIN_JS_DIFF = `diff --git a/frontend/src/main.js b/frontend/src/main.js
--- a/frontend/src/main.js
+++ b/frontend/src/main.js
@@ -100 +100 @@
-  if (user.role === 'admin') return true;
+  if (user.role === 'admin' || user.role === 'operation_manager') return true;
`;

const MIXED_MAIN_JS_DIFF = `diff --git a/frontend/src/main.js b/frontend/src/main.js
--- a/frontend/src/main.js
+++ b/frontend/src/main.js
@@ -641 +641 @@
-  instructors: () => import('./screens/instructors.js?v=old').then((m) => m.instructorsScreen),
+  instructors: () => import('./screens/instructors.js?v=new').then((m) => m.instructorsScreen),
@@ -200 +200 @@
-  state.user = null;
+  state.user = payload;
`;

test('documentation changes select no application work', () => {
  assert.deepEqual(buildCheckPlan(['docs/README.md']).tests, []);
  assert.equal(buildCheckPlan(['docs/README.md']).build, false);
});

test('CSS remains build-validated without selecting business suites', () => {
  const plan = buildCheckPlan(['frontend/src/styles/main.css']);
  assert.equal(plan.build, true);
  assert.deepEqual(plan.tests, []);
});

test('CSS named after a business domain still only build-validates', () => {
  const plan = buildCheckPlan(['frontend/src/screens/course-scheduling-neutral-colors.css']);
  assert.equal(plan.build, true);
  assert.deepEqual(plan.groups, []);
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

test('authority catalog filenames are not misread as auth', () => {
  const plan = buildCheckPlan(['frontend/src/screens/operations-authorities-cleanup.js']);
  assert.deepEqual(plan.groups, ['operations']);
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

function apiPlanFor(changedLine) {
  const diff = `diff --git a/frontend/src/api.js b/frontend/src/api.js
--- a/frontend/src/api.js
+++ b/frontend/src/api.js
@@ -1 +1 @@
-old API implementation
+${changedLine}
`;
  return buildCheckPlan(['frontend/src/api.js'], { getDiff: () => diff });
}

test('api.js permission changes do not select activities', () => {
  const plan = apiPlanFor('const display_role = role; permissions.default_view = "edit-requests";');
  assert.deepEqual(plan.groups, ['permissions']);
  assert.equal(plan.groups.includes('activities'), false);
});

test('api.js role route removal does not select activities for an unchanged activities route', () => {
  const diff = `diff --git a/frontend/src/api.js b/frontend/src/api.js
--- a/frontend/src/api.js
+++ b/frontend/src/api.js
@@ -1 +1 @@
-  finance: ['dashboard', 'activities', 'edit-requests'],
+  finance: ['dashboard', 'activities'],
`;
  const plan = buildCheckPlan(['frontend/src/api.js'], { getDiff: () => diff });
  assert.deepEqual(plan.groups, ['permissions']);
  assert.equal(plan.groups.includes('activities'), false);
});

test('api.js Activities changes still select activities', () => {
  assert.deepEqual(apiPlanFor('export async function saveActivity(activity) {}').groups, ['activities']);
});

test('api.js proposal changes select proposals without activities', () => {
  assert.deepEqual(apiPlanFor('const proposals = await loadProposals();').groups, ['proposals']);
});

test('api.js role route removal does not select proposals for an unchanged proposals route', () => {
  const diff = `diff --git a/frontend/src/api.js b/frontend/src/api.js
--- a/frontend/src/api.js
+++ b/frontend/src/api.js
@@ -1 +1 @@
-  finance: ['dashboard', 'proposals-agreements', 'edit-requests'],
+  finance: ['dashboard', 'proposals-agreements'],
`;
  const plan = buildCheckPlan(['frontend/src/api.js'], { getDiff: () => diff });
  assert.equal(plan.groups.includes('proposals'), false);
  assert.deepEqual(plan.groups, ['permissions']);
});

test('api.js login and user projection changes select auth and permissions only', () => {
  assert.deepEqual(apiPlanFor('const loginUser = buildUserProjection(session);').groups, ['auth', 'permissions']);
});

test('main.js without diff context conservatively selects auth and permissions', () => {
  assert.deepEqual(buildCheckPlan(['frontend/src/main.js']).groups, ['auth', 'permissions']);
});

test('main.js cache-busting-only version bump does not select auth or permissions', () => {
  const plan = buildCheckPlan(['frontend/src/main.js'], { getDiff: () => COSMETIC_MAIN_JS_DIFF });
  assert.deepEqual(plan.groups, []);
  assert.deepEqual(plan.tests, []);
});

test('main.js functional change still selects auth and permissions', () => {
  const plan = buildCheckPlan(['frontend/src/main.js'], { getDiff: () => FUNCTIONAL_MAIN_JS_DIFF });
  assert.deepEqual(plan.groups, ['auth', 'permissions']);
});

test('main.js diff mixing a cosmetic loader line with a real change still selects auth and permissions', () => {
  const plan = buildCheckPlan(['frontend/src/main.js'], { getDiff: () => MIXED_MAIN_JS_DIFF });
  assert.deepEqual(plan.groups, ['auth', 'permissions']);
});
