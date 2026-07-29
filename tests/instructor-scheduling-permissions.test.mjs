import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/migrations/20260729180000_school_2027_scheduling_workspace.sql',import.meta.url),'utf8');
const workflow=fs.readFileSync(new URL('../frontend/src/screens/instructor-scheduling-workflow.js',import.meta.url),'utf8');
const edgeFunction=fs.readFileSync(new URL('../supabase/functions/scheduling-route/index.ts',import.meta.url),'utf8');

test('assignment RPC checks server-side role',()=>{assert.match(sql,/caller_role <> all\(array\['admin','operation_manager'\]\)/);assert.match(sql,/security definer/);});
test('assignment and requirement RPCs enforce canonical 2027 season and open status',()=>{assert.match(sql,/scheduling_activity_not_school_2027/g);assert.match(sql,/scheduling_activity_not_open/g);assert.match(sql,/save_activity_scheduling_requirements/);});
test('client never writes activities.emp_id directly',()=>{assert.doesNotMatch(workflow,/from\('activities'\)\.update\([^)]*emp_id/);assert.match(workflow,/rpc\('assign_activity_instructor'/);});
test('override and exception decisions require a reason',()=>{assert.match(sql,/scheduling_reason_required/);});
test('audit history is inserted, never replaced',()=>{assert.match(sql,/insert into public\.instructor_assignment_audit/);assert.doesNotMatch(sql,/delete from public\.instructor_assignment_audit/);});
test('RPC uses bigint and checks both instructor slots with empty statuses',()=>{assert.match(sql,/p_emp_id bigint/);assert.match(sql,/a\.emp_id_2::text=p_emp_id::text/);assert.match(sql,/coalesce\(a\.status::text,''\)/);});
test('RPC validates active instructor and canonical name',()=>{assert.match(sql,/instructor_inactive/);assert.match(sql,/instructor_name_mismatch/);});
test('activities screen exposes assignment filter independently of removed all-activities mode',()=>{const source=fs.readFileSync(new URL('../frontend/src/screens/activities.js',import.meta.url),'utf8');assert.match(source,/label: 'ללא מדריך'/);assert.match(source,/function activityInstructorStatusFilterHtml/);assert.doesNotMatch(source,/function activityInstructorStatusFilterHtml[\s\S]{0,160}isAllActivitiesMode/);assert.match(source,/data-activities-instructor-status-filter/);});
test('unassigned filter requires both primary id and name to be empty',async()=>{const {activityMatchesInstructorStatusFilter}=await import('../frontend/src/screens/shared/activity-instructor-filter.js');assert.equal(activityMatchesInstructorStatusFilter({emp_id:'',instructor_name:''},'unassigned'),true);assert.equal(activityMatchesInstructorStatusFilter({emp_id:'1500',instructor_name:''},'unassigned'),false);assert.equal(activityMatchesInstructorStatusFilter({emp_id:'',instructor_name:'נועה'},'unassigned'),false);assert.equal(activityMatchesInstructorStatusFilter({emp_id:'1500',instructor_name:'נועה'},'all'),true);});
test('clearing activity filters restores assignment filter to all',()=>{const source=fs.readFileSync(new URL('../frontend/src/screens/activities.js',import.meta.url),'utf8');assert.match(source,/onClear: \(\) => \{[\s\S]*state\.allActivitiesStatusFilter = 'all'/);});
test('workflow does not expose an unusable draft action',()=>{assert.doesNotMatch(workflow,/שמירה כטיוטה|data-save-assignment-draft/);});
test('workflow applies hard filters before route calculations',()=>{assert.match(workflow,/const preliminary = rankInstructors/);assert.match(workflow,/preliminary\.recommended/);});
test('route function handles browser CORS and validates application role',()=>{assert.match(edgeFunction,/req\.method === 'OPTIONS'/);assert.match(edgeFunction,/Access-Control-Allow-Headers/);assert.match(edgeFunction,/auth\.getUser\(token\)/);assert.match(edgeFunction,/\['admin', 'operation_manager'\]/);});
test('route function keeps Google key server-side and has safe missing-key fallback',()=>{assert.match(edgeFunction,/Deno\.env\.get\('GOOGLE_MAPS_API_KEY'\)/);assert.match(edgeFunction,/google_key_not_configured/);assert.doesNotMatch(edgeFunction,/AIza[0-9A-Za-z_-]+/);});
