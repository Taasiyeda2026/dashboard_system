import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260804120000_remove_scheduling_age_and_legacy_gates.sql', import.meta.url), 'utf8');
const assignmentSql = fs.readFileSync(new URL('../supabase/migrations/20260729180000_school_2027_scheduling_workspace.sql', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../frontend/src/screens/instructor-scheduling-workflow.js', import.meta.url), 'utf8');
const detailHtml = fs.readFileSync(new URL('../frontend/src/screens/shared/activity-detail-html.js', import.meta.url), 'utf8');
const edgeFunction = fs.readFileSync(new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url), 'utf8');

test('requirements RPC checks server-side role', () => {
  assert.match(sql, /caller_role <> all\(array\['admin', 'operation_manager'\]\)/);
  assert.match(sql, /security definer/);
});

test('assignment and requirement RPCs enforce canonical 2027 season and open status', () => {
  assert.match(sql, /scheduling_activity_not_school_2027/);
  assert.match(sql, /scheduling_activity_not_open/);
  assert.match(sql, /save_activity_scheduling_requirements/);
  assert.match(assignmentSql, /scheduling_activity_not_school_2027/);
  assert.match(assignmentSql, /scheduling_activity_not_open/);
});

test('requirements RPC saves only gender and language', () => {
  const saveRpc = sql.slice(sql.indexOf('create or replace function public.save_activity_scheduling_requirements'), sql.indexOf('create or replace function public.scheduling_course_instructor_violations'));
  assert.doesNotMatch(saveRpc, /p_education_level text/);
  assert.doesNotMatch(saveRpc, /education_level = normalized_education/);
  assert.doesNotMatch(saveRpc, /blocked_instructor_ids\s*=/);
  assert.doesNotMatch(saveRpc, /allowed_instructor_ids\s*=/);
  assert.doesNotMatch(saveRpc, /scheduling_note\s*=/);
  assert.doesNotMatch(saveRpc, /emp_id\s*=/);
});

test('client never writes activities.emp_id directly and does not assign from requirements modal', () => {
  assert.doesNotMatch(workflow, /from\('activities'\)\.update\([^)]*emp_id/);
  assert.doesNotMatch(workflow, /rpc\('assign_activity_instructor'/);
  assert.match(workflow, /rpc\('save_activity_scheduling_requirements'/);
});

test('override and exception decisions require a reason', () => {
  assert.match(assignmentSql, /scheduling_reason_required/);
});

test('audit history is inserted, never replaced', () => {
  assert.match(assignmentSql, /insert into public\.instructor_assignment_audit/);
  assert.doesNotMatch(assignmentSql, /delete from public\.instructor_assignment_audit/);
});

test('RPC uses bigint and checks both instructor slots with empty statuses', () => {
  assert.match(assignmentSql, /p_emp_id bigint/);
  assert.match(assignmentSql, /a\.emp_id_2::text=p_emp_id::text/);
  assert.match(assignmentSql, /coalesce\(a\.status::text,''\)/);
});

test('RPC validates active instructor and canonical name', () => {
  assert.match(assignmentSql, /instructor_inactive/);
  assert.match(assignmentSql, /instructor_name_mismatch/);
});

test('activities screen exposes assignment filter independently of removed all-activities mode', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.match(source, /label: 'ללא מדריך'/);
  assert.match(source, /function activityInstructorStatusFilterHtml/);
  assert.doesNotMatch(source, /function activityInstructorStatusFilterHtml[\s\S]{0,160}isAllActivitiesMode/);
  assert.match(source, /data-activities-instructor-status-filter/);
});

test('unassigned filter requires both primary id and name to be empty', async () => {
  const { activityMatchesInstructorStatusFilter } = await import('../frontend/src/screens/shared/activity-instructor-filter.js');
  assert.equal(activityMatchesInstructorStatusFilter({ emp_id: '', instructor_name: '' }, 'unassigned'), true);
  assert.equal(activityMatchesInstructorStatusFilter({ emp_id: '1500', instructor_name: '' }, 'unassigned'), false);
  assert.equal(activityMatchesInstructorStatusFilter({ emp_id: '', instructor_name: 'נועה' }, 'unassigned'), false);
  assert.equal(activityMatchesInstructorStatusFilter({ emp_id: '1500', instructor_name: 'נועה' }, 'all'), true);
});

test('clearing activity filters restores assignment filter to all', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.match(source, /onClear: \(\) => \{[\s\S]*state\.allActivitiesStatusFilter = 'all'/);
});

test('scheduling requirements remain ordinary edit fields without a separate drawer action', () => {
  assert.match(workflow, /דרישות שיבוץ/);
  assert.match(workflow, /שמירת דרישות השיבוץ/);
  assert.match(workflow, /data-save-scheduling-requirements/);
  assert.match(detailHtml, /data-scheduling-fields/);
  assert.match(detailHtml, /name="required_instructor_gender"/);
  assert.match(detailHtml, /name="instruction_language"/);
  assert.doesNotMatch(detailHtml, /data-find-instructor/);
  assert.doesNotMatch(detailHtml, /ניהול שיבוץ/);
  assert.doesNotMatch(workflow, /שמירה כטיוטה|data-save-assignment-draft/);
  assert.doesNotMatch(workflow, /מדריכים חסומים|מדריכים מותרים בלבד|הערת שיבוץ פנימית/);
  assert.doesNotMatch(workflow, /איתור מדריכים מתאימים|מומלצים|מתאימים עם חריגה|לא מתאימים|אישור ושיבוץ/);
  assert.doesNotMatch(workflow, /rankInstructors|scheduling-route|assign_activity_instructor|data-run-scheduling/);
});

test('route function handles browser CORS and validates application role', () => {
  assert.match(edgeFunction, /req\.method === 'OPTIONS'/);
  assert.match(edgeFunction, /Access-Control-Allow-Headers/);
  assert.match(edgeFunction, /auth\.getUser\(token\)/);
  assert.match(edgeFunction, /\['admin', 'operation_manager'\]/);
});

test('route function keeps Google key server-side and has safe missing-key fallback', () => {
  assert.match(edgeFunction, /Deno\.env\.get\('GOOGLE_MAPS_API_KEY'\)/);
  assert.match(edgeFunction, /google_key_not_configured/);
  assert.doesNotMatch(edgeFunction, /AIza[0-9A-Za-z_-]+/);
});
