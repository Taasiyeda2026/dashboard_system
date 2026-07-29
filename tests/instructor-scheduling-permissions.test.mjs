import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260729170000_instructor_operational_scheduling.sql',import.meta.url),'utf8');
test('assignment RPC checks server-side role',()=>{assert.match(sql,/current_role <> all\(array\['admin','operation_manager'\]\)/);assert.match(sql,/security definer/);});
test('override and exception decisions require a reason',()=>{assert.match(sql,/scheduling_reason_required/);});
test('audit history is inserted, never replaced',()=>{assert.match(sql,/insert into public\.instructor_assignment_audit/);assert.doesNotMatch(sql,/delete from public\.instructor_assignment_audit/);});
