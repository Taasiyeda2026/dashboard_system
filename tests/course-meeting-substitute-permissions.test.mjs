import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260922073500_course_meeting_substitute_permissions_requests.sql', import.meta.url), 'utf8');
const scheduling = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
const requests = await readFile(new URL('../frontend/src/screens/edit-requests.js', import.meta.url), 'utf8');
const helper = await readFile(new URL('../frontend/src/screens/shared/course-meeting-substitute-requests.js', import.meta.url), 'utf8');

test('direct one-time substitution is server-restricted to Admin and Operations', () => {
  const setFn = migration.split('create or replace function public.set_course_meeting_substitute')[1]
    .split('revoke all on function public.set_course_meeting_substitute')[0];
  const clearFn = migration.split('create or replace function public.clear_course_meeting_substitute')[1]
    .split('revoke all on function public.clear_course_meeting_substitute')[0];
  assert.match(setFn, /public\.app_is_admin_or_operation_manager\(\)/);
  assert.match(clearFn, /public\.app_is_admin_or_operation_manager\(\)/);
  assert.doesNotMatch(setFn, /app_has_permission\('view_operations_scheduling'\)/);
  assert.doesNotMatch(clearFn, /app_has_permission\('view_operations_scheduling'\)/);
  assert.match(migration, /revoke all on function public\.set_course_meeting_substitute\(text,date,bigint\) from public, anon/);
  assert.match(migration, /revoke all on function public\.clear_course_meeting_substitute\(text,date\) from public, anon/);
});

test('other manager roles can only submit a scheduling request', () => {
  const submitFn = migration.split('create or replace function public.submit_course_meeting_substitute_request')[1]
    .split('revoke all on function public.submit_course_meeting_substitute_request')[0];
  for (const role of ['activities_manager','instructor_manager','domain_manager','business_development_manager']) {
    assert.match(submitFn, new RegExp(role));
  }
  assert.match(submitFn, /app_has_permission\('view_operations_scheduling'\)/);
  assert.match(submitFn, /request_type[\s\S]*course_meeting_substitution/);
  assert.match(submitFn, /status[\s\S]*pending/);
  assert.match(submitFn, /expected_current_emp_id/);
});

test('only Admin or Operations can approve a one-time substitution request', () => {
  const reviewFn = migration.split('create or replace function public.review_course_meeting_substitute_request')[1]
    .split('revoke all on function public.review_course_meeting_substitute_request')[0];
  assert.match(reviewFn, /public\.app_is_admin_or_operation_manager\(\)/);
  assert.match(reviewFn, /perform public\.set_course_meeting_substitute/);
  assert.match(reviewFn, /perform public\.clear_course_meeting_substitute/);
  assert.match(reviewFn, /status='conflict'/);
  assert.match(reviewFn, /שיבוץ המפגש השתנה לאחר שליחת הבקשה/);
});

test('course scheduling UI separates direct changes from manager requests', () => {
  assert.match(scheduling, /DIRECT_SINGLE_SUBSTITUTE_ROLES = new Set\(\['admin', 'operation_manager'\]\)/);
  assert.match(scheduling, /REQUEST_SINGLE_SUBSTITUTE_ROLES/);
  assert.match(scheduling, /בקשת החלפה חד־פעמית/);
  assert.match(scheduling, /נדרש אישור אדמין או תפעול/);
  assert.match(scheduling, /שלח בקשה לעדכון/);
  assert.match(scheduling, /submitCourseMeetingSubstituteRequest/);
  assert.match(scheduling, /הבקשה לעדכון נשלחה לאישור אדמין או תפעול/);
  assert.match(scheduling, /הבקשה לביטול ההחלפה נשלחה לאישור אדמין או תפעול/);
});

test('edit requests screen loads and reviews one-time substitution requests separately', () => {
  assert.match(helper, /COURSE_MEETING_SUBSTITUTE_REQUEST_TYPE = 'course_meeting_substitution'/);
  assert.match(helper, /course_meeting_substitute_requests/);
  assert.match(helper, /review_course_meeting_substitute_request/);
  assert.match(requests, /COURSE_MEETING_SUBSTITUTE_REQUEST_TYPE/);
  assert.match(requests, /בקשת החלפה חד־פעמית/);
  assert.match(requests, /מדריך נוכחי/);
  assert.match(requests, /עדכון מבוקש/);
  assert.match(requests, /reviewCourseMeetingSubstituteRequest/);
});
