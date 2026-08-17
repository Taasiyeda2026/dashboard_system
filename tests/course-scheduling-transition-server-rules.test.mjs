import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  '../supabase/migrations/20260817220000_course_scheduling_transition_rules.sql',
  import.meta.url
);

function functionSql(sql, name, nextName = null) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = nextName
    ? sql.indexOf(`create or replace function public.${nextName}(`, start + 1)
    : sql.length;
  assert.ok(end > start, `${name} end not found`);
  return sql.slice(start, end);
}

test('server automatic scheduling enforces 20 km and route time plus 10 minutes', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const fn = functionSql(sql, 'scheduling_course_instructor_violations', 'scheduling_manual_assignment_hard_violations');

  assert.match(fn, /scheduling_cached_travel_distance_km/);
  assert.match(fn, /required_km\s*>\s*20/);
  assert.match(fn, /scheduling_transition_distance_exceeded/);
  assert.match(fn, /required_minutes\s*\+\s*10/);
  assert.doesNotMatch(fn, /required_minutes\s*\+\s*15/);
  assert.match(fn, /required_km is null or required_minutes is null[\s\S]*scheduling_transition_unverified/);
});

test('server verified manual finalization keeps known 20 km and 10 minute transition blockers', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const fn = functionSql(sql, 'scheduling_manual_assignment_hard_violations');

  assert.match(fn, /scheduling_cached_travel_distance_km/);
  assert.match(fn, /required_km is not null and required_km > 20/);
  assert.match(fn, /scheduling_transition_distance_exceeded/);
  assert.match(fn, /required_minutes\s*\+\s*10/);
  assert.doesNotMatch(fn, /required_minutes\s*\+\s*15/);
  assert.doesNotMatch(fn, /scheduling_transition_unverified/,
    'unknown transition data remains a manual warning rather than a new hard blocker');
});
