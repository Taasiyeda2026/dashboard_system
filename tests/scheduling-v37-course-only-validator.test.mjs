import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { schedulingActivityTypeCategory, isCourseSchedulingTargetActivity } from '../frontend/src/screens/shared/activity-scheduling-eligibility.js';

const migration = readFileSync(new URL('../supabase/migrations/20261012211500_fix_v37_course_only_required_scope.sql', import.meta.url), 'utf8');
const previous = readFileSync(new URL('../supabase/migrations/20261012011500_scheduling_undated_seven_day_lead.sql', import.meta.url), 'utf8');

function block(variable, tag) {
  const start = migration.indexOf(variable + ' text := $' + tag + '$');
  assert.notEqual(start, -1, variable + ' must be present');
  const begin = start + (variable + ' text := $' + tag + '$').length;
  const end = migration.indexOf('$' + tag + '$', begin);
  assert.ok(end > begin, 'unterminated ' + variable);
  return migration.slice(begin, end);
}

test('the guarded migration replaces exactly the missing-row scope, retaining other v37 gates', () => {
  const oldFilter = block('old_filter', 'old_scope');
  const newFilter = block('new_filter', 'new_scope');
  assert.equal(previous.split(oldFilter).length, 2, 'the existing validator must have one exact target');
  const modified = previous.replace(oldFilter, newFilter);
  const guard = modified.split('-- A full workspace cannot silently drop approved or open activities in scope.')[1].split("raise exception 'planning_server_activity_missing'")[0];
  assert.match(guard, /'course','program','קורס','קורסים','תוכנית','תכנית'/);
  assert.doesNotMatch(guard, /'tour','סיור'|'workshop','סדנה'/);
  assert.match(guard, /a\.activity_no.*13990/);
  assert.match(guard, /a\.activity_name.*התנסות בתעשייה/);
  assert.match(guard, /not exists.*tmp_scheduling_v37_plan_rows/s, 'missing courses must still fail closed');
  assert.match(modified, /planning_server_official_dates_changed/);
  assert.match(modified, /planning_server_overlap/);
  assert.match(modified, /planning_server_protected_instructor_changed/);
  assert.match(modified, /planning_server_undated_start_too_soon/);
  assert.match(migration, /v37_course_only_validator_unexpected_source/, 'must fail if server definition drifts');
});

test('SQL required-row categories mirror the JS course target without treating tours as courses', () => {
  for (const type of ['course','program','קורס','קורסים','תוכנית','תכנית']) {
    assert.equal(schedulingActivityTypeCategory(type),'course');
    assert.equal(isCourseSchedulingTargetActivity({activity_type:type,activity_name:'רוקחים עולם'}),true);
  }
  for (const type of ['tour','סיור','workshop','סדנה']) {
    assert.equal(isCourseSchedulingTargetActivity({activity_type:type}),false);
  }
  assert.equal(isCourseSchedulingTargetActivity({activity_type:'course',activity_no:'13990'}),false);
  assert.equal(isCourseSchedulingTargetActivity({activity_type:'course',activity_name:'התנסות בתעשייה'}),false);
});
