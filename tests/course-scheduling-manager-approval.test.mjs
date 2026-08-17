import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('manual scheduling exception is sent only by explicit manager-approval click', async () => {
  const source = await read('../frontend/src/screens/shared/course-scheduling-manager-approval.js');
  const clickIndex = source.indexOf("sendButton.addEventListener('click'");
  const submitIndex = source.indexOf("submit_course_assignment_manager_approval");
  const stateIndex = source.indexOf("course_assignment_manager_approval_state");

  assert.ok(clickIndex >= 0, 'explicit send button handler is required');
  assert.ok(submitIndex > clickIndex, 'approval submission must happen only inside the explicit click path');
  assert.ok(stateIndex >= 0 && stateIndex !== submitIndex, 'render may read approval state without submitting');
  assert.equal((source.match(/submit_course_assignment_manager_approval/g) || []).length, 1);
  assert.match(source, /שלח למנהל לאישור/);
  assert.doesNotMatch(source, /לאדמין|אדמין/);
});

test('existing approvals screen renders and reviews scheduling exception requests', async () => {
  const source = await read('../frontend/src/screens/edit-requests.js');

  assert.match(source, /COURSE_ASSIGNMENT_MANAGER_APPROVAL_REQUEST_TYPE/);
  assert.match(source, /loadCourseAssignmentManagerApprovalGroups/);
  assert.match(source, /reviewCourseAssignmentManagerApproval/);
  assert.match(source, /אישור חריגה בשיבוץ/);
  assert.match(source, /סיבת החריגה/);
  assert.match(source, /מדריך שנבחר/);
  assert.match(source, /הבקשה אושרה\. ניתן להשלים את השיבוץ\./);
  assert.doesNotMatch(source, /לאדמין|אדמין/);
});

test('manager approval reuses edit_requests and is bound to the exact saved draft', async () => {
  const sql = await read('../supabase/migrations/20260817223000_course_scheduling_manager_approval.sql');

  assert.match(sql, /insert into public\.edit_requests/);
  assert.match(sql, /request_type='course_assignment_exception'/);
  assert.doesNotMatch(sql, /create\s+table/i, 'no parallel approval table should be created');
  assert.match(sql, /draft_emp_id/);
  assert.match(sql, /draft_created_at/);
  assert.match(sql, /status='approved'/);
  assert.match(sql, /scheduling_manager_approval_required/);
  assert.match(sql, /scheduling_manual_assignment_hard_violations/);
});

test('manual draft stays a draft until explicitly sent and approved', async () => {
  const sql = await read('../supabase/migrations/20260817223000_course_scheduling_manager_approval.sql');

  assert.match(sql, /normalized_reason := case[\s\S]*then 'בחירה ידנית'[\s\S]*else 'בחירה ידנית: '/);
  assert.match(sql, /btrim\(coalesce\(manual_reason, ''\)\)<>'בחירה ידנית'/);
  assert.match(sql, /submit_course_assignment_manager_approval/);
  assert.match(sql, /review_course_assignment_manager_approval/);
  assert.match(sql, /trg_scheduling_guard_manual_exception_approval/);
});

test('changing or cancelling a draft invalidates a pending manager approval', async () => {
  const sql = await read('../supabase/migrations/20260817223000_course_scheduling_manager_approval.sql');

  assert.match(sql, /scheduling_invalidate_pending_manager_approval/);
  assert.match(sql, /old\.draft_emp_id is distinct from new\.draft_emp_id/);
  assert.match(sql, /old\.draft_proposed_meetings is distinct from new\.draft_proposed_meetings/);
  assert.match(sql, /set status='conflict'/);
  assert.match(sql, /הטיוטה השתנתה או בוטלה לאחר שליחת הבקשה/);
});

test('scheduling workspace wires approval state without replacing the existing draft flow', async () => {
  const source = await read('../frontend/src/screens/shared/instructors-workspace-nav.js');

  assert.match(source, /ensureCourseSchedulingManualPickerAccess/);
  assert.match(source, /ensureCourseSchedulingManagerApproval/);
  assert.match(source, /void ensureCourseSchedulingManagerApproval\(root, \{ state \}\)/);
});

test('manager approval deployment bumps the service-worker cache', async () => {
  const source = await read('../frontend/sw.js');
  assert.match(source, /const CACHE_VERSION = 1527;/);
});
