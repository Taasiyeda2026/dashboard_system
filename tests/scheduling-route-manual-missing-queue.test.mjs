import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('missing-route queue has one directed key, restricted reads and no automatic Maps calls', async () => {
  const sql = await read('../supabase/migrations/20261016214500_scheduling_route_manual_missing_queue.sql');
  assert.match(sql, /primary key \(origin_key,destination_key\)/i);
  assert.match(sql, /on conflict \(origin_key,destination_key\) do update/i);
  assert.match(sql, /scheduling_agent_team_assert_member\(\)/);
  assert.match(sql, /scheduling_effective_meetings/);
  assert.match(sql, /after insert or update of distance_km,duration_minutes/);
  assert.match(sql, /manage_instructor_maintenance/);
  assert.doesNotMatch(sql, /routes\.googleapis|computeRoutes|pg_cron|cron\.schedule|http_post/i);
});

test('the agent saves the missing route in a separate post-failure transaction', async () => {
  const gateway = await read('../supabase/functions/scheduling-agent-team-gateway/index.ts');
  assert.match(gateway, /if\('error' in output\)[\s\S]*?scheduling_agent_team_queue_missing_stage_routes/);
  assert.match(gateway, /maintenanceQueued/);
  assert.match(gateway, /scheduling_transition_unverified/);
  assert.doesNotMatch(gateway, /scheduling_queue_missing_route[\s\S]*Google Maps/);
});

test('maintenance never calculates a queued route on open or refresh', async () => {
  const screen = await read('../frontend/src/screens/course-scheduling.js');
  const queueLoad = screen.split('const reloadManualRouteQueue')[1].split('const reloadDistanceCoverage')[0];
  assert.match(queueLoad, /\.from\('scheduling_route_missing_queue'\)/);
  assert.doesNotMatch(queueLoad, /invokeDistanceRoute|runDistanceBuildLoop|build_cache/);
  const click = screen.split("root.querySelectorAll('[data-calculate-missing-route]')")[1]
    .split("root.querySelector('[data-refresh-distance-coverage]')")[0];
  assert.match(click, /button\.addEventListener\('click'/);
  assert.match(click, /await invokeDistanceRoute\(/);
  assert.match(screen, /ambiguous_same_address/);
  assert.match(screen, /כל מסלולי הבסיס מעודכנים/);
});

test('attendance errors join the same queue and do not change payroll reconciliation', async () => {
  const edge = await read('../supabase/functions/attendance-travel-compensation/index.ts');
  assert.match(edge, /Promise\.allSettled\([\s\S]*scheduling_queue_missing_route/);
  assert.match(edge, /av2_reconcile_attendance_travel/);
});
