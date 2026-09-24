import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const screenUrl = new URL('../frontend/src/screens/course-scheduling.js', import.meta.url);
const storeUrl = new URL('../frontend/src/screens/course-scheduling-planning-store.js', import.meta.url);
const travelUrl = new URL('../frontend/src/screens/course-scheduling-travel.js', import.meta.url);
const schemaUrl = new URL('../supabase/migrations/20260924145500_shared_incremental_course_planning.sql', import.meta.url);
const dirtyUrl = new URL('../supabase/migrations/20260924151000_shared_planning_incremental_dirty_rows.sql', import.meta.url);
const unlockUrl = new URL('../supabase/migrations/20260924152500_shared_planning_unlock_recalc.sql', import.meta.url);

test('shared planning persists separately from live activities with scheduling RLS', async () => {
  const [schema, dirty, unlock] = await Promise.all([
    readFile(schemaUrl, 'utf8'),
    readFile(dirtyUrl, 'utf8'),
    readFile(unlockUrl, 'utf8')
  ]);
  assert.match(schema, /create table if not exists public\.scheduling_planning_workspaces/);
  assert.match(schema, /create table if not exists public\.scheduling_planning_rows/);
  assert.match(schema, /app_has_permission\('view_operations_scheduling'\)/);
  assert.match(schema, /planning_revision_conflict/);
  assert.match(schema, /planning_activity_changed/);
  assert.match(schema, /save_scheduling_planning_snapshot/);
  assert.match(schema, /set_scheduling_planning_lock/);
  assert.match(dirty, /needs_recalc boolean not null default false/);
  assert.match(dirty, /needsRecalc/);
  assert.match(unlock, /\(p_option is null\)/);
  assert.doesNotMatch(schema + dirty + unlock, /update\s+public\.activities\s+set\s+emp_id/i);
});

test('course planning screen loads and saves the shared workspace and only recalculates affected rows', async () => {
  const [screen, store, travel] = await Promise.all([
    readFile(screenUrl, 'utf8'),
    readFile(storeUrl, 'utf8'),
    readFile(travelUrl, 'utf8')
  ]);
  assert.match(screen, /loadSharedPlanningWorkspace/);
  assert.match(screen, /saveSharedPlanningSnapshot/);
  assert.match(screen, /saveSharedPlanningLock/);
  assert.match(screen, /sharedPlanningAffectedCourseIds/);
  assert.match(screen, /targetCourseIds/);
  assert.match(screen, /loadSchedulingTravelCacheRows/);
  assert.match(screen, /expectedRevision/);
  assert.match(store, /planning_revision_conflict/);
  assert.match(store, /activityUpdatedAt/);
  assert.match(store, /needsRecalc/);
  assert.match(travel, /preloadedRows/);
  assert.match(travel, /persistentCache/);
});

test('existing shared plans automatically recalculate affected rows after live assignment changes', async () => {
  const screen = await readFile(screenUrl, 'utf8');
  assert.match(screen, /courseSchedulingPlanningCalculatedAt[\s\S]*courseSchedulingPlanningAffectedIds[\s\S]*runCoursePlanning\(\{ forceFull: false \}\)/);
  assert.match(screen, /A real assignment\/draft made since the last shared plan/);
});

test('shared planning UI explicitly communicates team visibility and targeted refresh', async () => {
  const planning = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
  assert.match(planning, /תכנון משותף לצוות/);
  assert.match(planning, /נשמרת מיד ב-Supabase/);
  assert.match(planning, /עדכן רק \$\{pendingCount\} פעילויות שהשתנו/);
  assert.match(planning, /data-refresh-shared-planning/);
});
