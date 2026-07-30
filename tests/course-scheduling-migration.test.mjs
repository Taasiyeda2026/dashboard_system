import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl=new URL('../supabase/migrations/20260730120000_course_scheduling_2027_permission_rls_fix.sql',import.meta.url);

test('RPC rejects NULL and unauthorized roles while retaining authorized roles and safety checks',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  assert.match(sql,/caller_role is null or caller_role not in \('admin','operation_manager'\)/);
  assert.match(sql,/auth_user_id = auth\.uid\(\).*is_active is true/);
  for(const guard of ['instructor_inactive','scheduling_activity_not_school_2027','scheduling_activity_not_course','scheduling_activity_not_open','scheduling_assignment_locked','scheduling_conflict_detected','scheduling_reason_required'])assert.match(sql,new RegExp(guard));
});

test('corrective migration drops legacy open policy names before role-scoped policies',async()=>{
  const sql=await readFile(migrationUrl,'utf8');
  assert.match(sql,/drop policy if exists instructor_assignment_audit_read/);assert.match(sql,/drop policy if exists scheduling_travel_cache_read/);
  assert.doesNotMatch(sql,/using\s*\(\s*true\s*\)/i);
  assert.equal((sql.match(/app_current_role\(\) = any/g)||[]).length,2);
});
