import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderGroup } from '../frontend/src/screens/edit-requests.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('scheduling approval renders as a compact decision card', () => {
  const html = renderGroup({
    request_id: 'req-1',
    request_type: 'course_assignment_exception',
    source_row_id: 'ACT-long-id-that-should-not-render',
    status: 'pending',
    can_approve: true,
    requested_by_name: 'עידן נחום',
    requested_at: '2026-09-08',
    requested_payload: { exception_reason: 'מרחק 61 ק״מ' },
    activity: {
      activity_type: 'workshop',
      activity_name: 'תמיר - המחזור מתחיל בבית',
      school: 'מרחבים',
      authority: 'פרדס חנה-כרכור',
      activity_manager: 'גיל נאמן',
      date_1: '2026-09-30',
      start_time: '10:00:00',
      end_time: '13:00:00',
      instructor_name: 'הנא אבו אמנה',
      emp_id: '1503'
    },
    fields: [
      { field_name: 'scheduling_selected_instructor', new_value: 'הנא אבו אמנה (1503)' },
      { field_name: 'scheduling_exception_reason', new_value: 'מרחק 61 ק״מ' }
    ]
  }, false);

  for (const value of [
    'אישור חריגה בשיבוץ: תמיר - המחזור מתחיל בבית',
    'סדנה · מרחבים · פרדס חנה-כרכור',
    '30/09/2026',
    '10:00–13:00',
    'הנא אבו אמנה \\(1503\\)',
    'סיבת החריגה:',
    'מרחק 61 ק״מ',
    'עידן נחום'
  ]) assert.match(html, new RegExp(value));

  assert.match(html, /data-action="approve"/);
  assert.match(html, /data-action="reject"/);
  assert.doesNotMatch(html, /ACT-long-id-that-should-not-render/);
  assert.doesNotMatch(html, /מזהה:/);
  assert.doesNotMatch(html, /סוג בקשה:/);
  assert.doesNotMatch(html, /מנהל פעילות:/);
  assert.doesNotMatch(html, /פרטי החריגה/);
  assert.doesNotMatch(html, /<table/);
});

test('edit requests screen removes scheduling approvals from the generic request feed', async () => {
  const source = await read('../frontend/src/screens/edit-requests.js');
  assert.match(source, /baseGroups[\s\S]*filter\([\s\S]*COURSE_ASSIGNMENT_MANAGER_APPROVAL_REQUEST_TYPE/);
  assert.match(source, /groups:\s*\[\.\.\.baseGroups,\s*\.\.\.schedulingGroups\]/);
});

test('scheduling approval RPC list and review are admin-only while operator submit/status flow remains', async () => {
  const migration = await read('../supabase/migrations/20260907232146_scheduling_approvals_admin_only.sql');
  const shared = await read('../frontend/src/screens/shared/course-scheduling-manager-approval.js');
  assert.equal((migration.match(/caller_role is distinct from 'admin'/g) || []).length, 2);
  assert.match(migration, /course_assignment_manager_approval_requests/);
  assert.match(migration, /review_course_assignment_manager_approval/);
  assert.match(shared, /submit_course_assignment_manager_approval/);
  assert.match(shared, /course_assignment_manager_approval_state/);
  assert.match(shared, /נדרש אישור אדמין/);
  assert.match(shared, /נשלח לאדמין לאישור/);
});
