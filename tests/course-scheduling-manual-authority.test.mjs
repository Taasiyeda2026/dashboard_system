import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20260809193000_manual_instructor_choice_authoritative.sql', import.meta.url);

test('manual assignment migration removes reason and recommendation gates while preserving one activities source of truth', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  const assign = sql.slice(sql.indexOf('create or replace function public.assign_activity_instructor('), sql.indexOf('create or replace function public.reassign_locked_course_instructor('));
  const reassign = sql.slice(sql.indexOf('create or replace function public.reassign_locked_course_instructor('));
  assert.doesNotMatch(assign, /scheduling_reason_required|scheduling_course_instructor_violations/);
  assert.doesNotMatch(reassign, /scheduling_reason_required|scheduling_course_instructor_violations/);
  assert.match(sql, /drop trigger if exists activities_validate_direct_assignment_after_write/);
  assert.match(sql, /new\.draft_emp_id := null/);
  assert.match(assign, /update public\.activities[\s\S]*emp_id = p_emp_id[\s\S]*instructor_assignment_status = final_status/);
});
