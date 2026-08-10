import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { effectiveEndTime, proposeDateAdjustments } from '../frontend/src/screens/course-scheduling-date-adjustments.js';

const migrationPath = new URL('../supabase/migrations/20260810204500_course_scheduling_stage2_server_sync.sql', import.meta.url);

async function migrationSql() {
  return readFile(migrationPath, 'utf8');
}

test('Stage 2: end-time caps compare clocks numerically, including unpadded hours', () => {
  const calendar = [
    { start_date: '2026-10-04', end_date: '2026-10-04', enforce_end_time: true, school_day_end_time: '10:00', is_active: true },
    { start_date: '2026-10-04', end_date: '2026-10-04', enforce_end_time: true, school_day_end_time: '9:30', is_active: true }
  ];
  assert.equal(effectiveEndTime('2026-10-04', '15:00', calendar), '9:30');
});

test('Stage 2: moving from a capped date to a normal date restores the nominal end time', () => {
  const meetings = [{ date: '2026-09-06', start_time: '10:00', end_time: '15:00' }];
  const rules = [{ weekday: 0, available: true, start_time: '08:00', end_time: '17:00' }];
  const exceptions = [{ exception_date: '2026-09-06', available: false }];
  const schoolCalendar = [{
    start_date: '2026-09-06', end_date: '2026-09-06',
    enforce_end_time: true, school_day_end_time: '13:00', is_active: true, blocks_scheduling: false
  }];

  const result = proposeDateAdjustments({ meetings, rules, exceptions, schoolCalendar });
  assert.equal(result?.valid, true);
  assert.equal(result.meetings[0].date, '2026-09-13');
  assert.equal(result.meetings[0].end_time, '15:00', 'uncapped replacement date must restore the nominal 15:00 end');
});

test('Stage 2 server migration removes count gate and keeps school identity ID-only', async () => {
  const sql = await migrationSql();
  assert.doesNotMatch(sql, /scheduling_daily_sequence_exceeded/);
  assert.match(sql, /previous_activity\.school_id is not null[\s\S]*previous_activity\.school_id = target\.school_id/);
  assert.match(sql, /next_activity\.school_id is not null[\s\S]*next_activity\.school_id = target\.school_id/);
  assert.doesNotMatch(sql, /previous_activity\.school[\s\S]{0,100}=\s*lower\(btrim\(coalesce\(target\.school/);
  assert.doesNotMatch(sql, /next_activity\.school[\s\S]{0,100}=\s*lower\(btrim\(coalesce\(target\.school/);
});

test('Stage 2 server migration derives effective hours and does not trust client hours', async () => {
  const sql = await migrationSql();
  assert.match(sql, /create or replace function public\.scheduling_effective_end_time/);
  assert.match(sql, /select min\(sc\.school_day_end_time\)/);
  assert.match(sql, /'start_time', target\.start_time/);
  assert.match(sql, /'end_time', effective_end/);
  assert.match(sql, /scheduling_effective_end_time\(\(value->>'date'\)::date, p_activity\.end_time\)/);
  assert.doesNotMatch(sql, /item \? 'end_time'/);
  assert.doesNotMatch(sql, /item \? 'start_time'/);
});

test('Stage 2 server migration keeps blocked dates hard-blocked and narrows shortened-day exemption to school_2027 courses', async () => {
  const sql = await migrationSql();
  assert.match(sql, /c\.blocks_scheduling = true/);
  assert.match(sql, /message = 'activity_date_on_school_holiday'/);
  assert.match(sql, /scheduling_course := coalesce\(new\.activity_season, ''\) = 'school_2027'/);
  assert.match(sql, /in \('קורס','course','program'\)/);
  assert.match(sql, /if new\.end_time is not null and not scheduling_course then/);
  assert.doesNotMatch(sql, /alter table public\.activities/i);
});

test('Stage 2 migration preserves manual-authority write policy and RPC signatures', async () => {
  const sql = await migrationSql();
  assert.doesNotMatch(sql, /create or replace function public\.assign_activity_instructor\s*\(/i);
  assert.doesNotMatch(sql, /create or replace function public\.save_course_assignment_draft\s*\(/i);
  assert.doesNotMatch(sql, /create trigger activities_validate_direct_assignment_after_write/i);
});
