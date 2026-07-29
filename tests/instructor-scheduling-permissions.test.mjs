import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260729170000_instructor_operational_scheduling.sql',import.meta.url),'utf8');
test('assignment RPC checks server-side role',()=>{assert.match(sql,/caller_role <> all\(array\['admin','operation_manager'\]\)/);assert.match(sql,/security definer/);});
test('override and exception decisions require a reason',()=>{assert.match(sql,/scheduling_reason_required/);});
test('audit history is inserted, never replaced',()=>{assert.match(sql,/insert into public\.instructor_assignment_audit/);assert.doesNotMatch(sql,/delete from public\.instructor_assignment_audit/);});
test('RPC uses bigint and checks both instructor slots with empty statuses',()=>{assert.match(sql,/p_emp_id bigint/);assert.match(sql,/a\.emp_id_2::text=p_emp_id::text/);assert.match(sql,/coalesce\(a\.status::text,''\)/);});
test('RPC validates active instructor and canonical name',()=>{assert.match(sql,/instructor_inactive/);assert.match(sql,/instructor_name_mismatch/);});
test('activities screen exposes and applies unassigned filter',()=>{const source=fs.readFileSync(new URL('../frontend/src/screens/activities.js',import.meta.url),'utf8');assert.match(source,/label: 'ללא מדריך'/);assert.match(source,/allActivitiesStatusFilter\) === 'unassigned'/);});
test('workflow does not expose an unusable draft action',()=>{const source=fs.readFileSync(new URL('../frontend/src/screens/instructor-scheduling-workflow.js',import.meta.url),'utf8');assert.doesNotMatch(source,/שמירה כטיוטה|data-save-assignment-draft/);});
