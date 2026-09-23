import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../supabase/migrations/20260923221000_remove_inter_school_distance_cap.sql',
  import.meta.url
);

function functionSql(sql, name, nextName = null) {
  const lower = sql.toLowerCase();
  const start = lower.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = nextName
    ? lower.indexOf(`create or replace function public.${nextName}(`, start + 1)
    : sql.length;
  assert.ok(end > start, `${name} end not found`);
  return sql.slice(start, end);
}

test('server automatic scheduling uses verified travel-time feasibility without a school-distance cap', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const fn = functionSql(sql, 'scheduling_course_instructor_violations', 'scheduling_manual_assignment_hard_violations');

  assert.match(fn, /scheduling_cached_travel_distance_km/);
  assert.match(fn, /scheduling_cached_travel_minutes/);
  assert.match(fn, /scheduling_transition_buffer_minutes\(required_km\)/);
  assert.match(fn, /scheduling_transition_unverified/);
  assert.match(fn, /scheduling_transition_insufficient/);
  assert.doesNotMatch(fn, /required_km\s*>\s*20/);
  assert.doesNotMatch(fn, /scheduling_transition_distance_exceeded/);
});

test('server verified manual finalization uses the same travel-time rule without a school-distance cap', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const fn = functionSql(sql, 'scheduling_manual_assignment_hard_violations');

  assert.match(fn, /scheduling_cached_travel_distance_km/);
  assert.match(fn, /scheduling_cached_travel_minutes/);
  assert.match(fn, /scheduling_transition_buffer_minutes\(required_km\)/);
  assert.match(fn, /scheduling_transition_unverified/);
  assert.match(fn, /scheduling_transition_insufficient/);
  assert.doesNotMatch(fn, /required_km\s*>\s*20/);
  assert.doesNotMatch(fn, /scheduling_transition_distance_exceeded/);
});

test('calendar write guard also follows travel-time feasibility without a distance ceiling', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const fn = functionSql(sql, 'scheduling_assert_assignment_calendar', 'scheduling_course_instructor_violations');

  assert.match(fn, /scheduling_transition_buffer_minutes\(required_km\)/);
  assert.match(fn, /scheduling_transition_unverified/);
  assert.match(fn, /scheduling_transition_insufficient/);
  assert.doesNotMatch(fn, /required_km\s*>\s*20/);
  assert.doesNotMatch(fn, /scheduling_transition_distance_exceeded/);
});
