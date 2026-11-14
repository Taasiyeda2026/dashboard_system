import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20261114223000_management_course_instructors_admin_approval.sql', import.meta.url), 'utf8');
const source = readFileSync(new URL('../services/scheduling-agent/manual-operations.sql', import.meta.url), 'utf8');

test('manager instructor identities come from active existing users, not instructor onboarding', () => {
  assert.match(migration, /create or replace function public\.scheduling_management_employee_directory\(/i);
  assert.match(migration, /where u\.emp_id ~ '\^\[0-9\]\+\$'/);
  assert.match(migration, /u\.is_active/);
  assert.match(migration, /create or replace function scheduling_manual_private\.canonical_instructor_name\(/i);
  assert.doesNotMatch(migration, /insert into public\.contacts_instructors/i);
});

test('management selections are checked by a server-side trigger for every finalization path', () => {
  assert.match(migration, /create trigger trg_scheduling_management_instructor_admin_only/i);
  assert.match(migration, /before insert or update of emp_id,emp_id_2,instructor_assignment_locked on public\.activities/i);
  assert.match(migration, /u\.auth_user_id=auth\.uid\(\) and u\.is_active and u\.role='admin'/);
  assert.match(migration, /scheduling_manager_instructor_admin_approval_required/);
  assert.match(migration, /'managementInstructor'/);
  assert.match(migration, /p_action='confirm' and scheduling_manual_private\.is_management_employee/);
});

test('manual scheduling source includes the same management safeguards without duplicating main functions', () => {
  assert.match(source, /create or replace function scheduling_manual_private\.resolve_instructor\(/i);
  assert.match(source, /create or replace function scheduling_manual_private\.guard_management_instructor_approval\(/i);
  assert.equal((source.match(/create or replace function scheduling_manual_private\.checks\(/gi)||[]).length, 1);
  assert.equal((source.match(/create or replace function scheduling_manual_private\.prepare\(/gi)||[]).length, 1);
});
