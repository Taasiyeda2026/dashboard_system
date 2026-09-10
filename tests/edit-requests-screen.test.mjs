import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editRequestsScreen, renderGroup } from '../frontend/src/screens/edit-requests.js';

test('edit requests screen hides empty requests and keeps non-empty field rows', () => {
  const html = editRequestsScreen.render({
    canReview: true,
    groups: [
      {
        request_id: 'REQ-EMPTY',
        status: 'pending',
        fields: []
      },
      {
        request_id: 'REQ-OK',
        status: 'pending',
        activity_name: 'סדנת רובוטיקה',
        authority: 'רשות א',
        school: 'בית ספר א',
        fields: [{ field_name: 'notes', old_value: 'ישן', new_value: 'חדש' }]
      }
    ]
  });

  assert.doesNotMatch(html, /REQ-EMPTY/);
  assert.match(html, /data-request-id="REQ-OK"/);
  assert.match(html, /הערות/);
  assert.match(html, /ישן/);
  assert.match(html, /חדש/);
  assert.match(html, /בקשות פתוחות \(1\)/);
  assert.match(html, /מה מבוקש לשנות\?/);
});

test('edit requests screen hides review actions for non-reviewers', () => {
  const html = editRequestsScreen.render({
    canReview: false,
    groups: [
      {
        request_id: 'REQ-MINE',
        status: 'pending',
        fields: [{ field_name: 'notes', old_value: 'ישן', new_value: 'חדש' }]
      }
    ]
  });

  assert.match(html, /בקשות פעילות שהגשת/);
  assert.doesNotMatch(html, /data-action="approve"/);
  assert.doesNotMatch(html, /data-action="reject"/);
});

test('edit_activity card hides technical ids and empty meta dashes', () => {
  const html = renderGroup({
    request_id: 'REQ-EDIT-1',
    request_type: 'edit_activity',
    status: 'pending',
    source_row_id: 'PAI-123e4567-e89b-12d3-a456-426614174000',
    activity_name: 'תוכנית מנהיגות',
    authority: 'חיפה',
    school: '',
    requested_by_name: 'ישראל ישראלי',
    requested_at: '2026-09-10',
    can_approve: true,
    activity: {
      row_id: 'PAI-123e4567-e89b-12d3-a456-426614174000',
      activity_name: 'תוכנית מנהיגות',
      authority: 'חיפה',
      school: '',
      activity_type: 'workshop',
      instructor_name: 'נועה כהן',
      emp_id: '1503',
      start_date: '',
      end_date: '',
      start_time: '',
      end_time: ''
    },
    fields: [
      { field_name: 'notes', old_value: '', new_value: 'הערה חדשה' },
      { field_name: 'emp_id', old_value: '100', new_value: '1503' },
      { field_name: 'row_id', old_value: 'x', new_value: 'y' }
    ]
  }, true);

  assert.match(html, /תוכנית מנהיגות/);
  assert.match(html, /בקשת עריכה/);
  assert.match(html, /רשות:/);
  assert.match(html, /חיפה/);
  assert.match(html, /סוג פעילות:/);
  assert.match(html, /מדריך:/);
  assert.match(html, /נועה כהן/);
  assert.match(html, /מה מבוקש לשנות\?/);
  assert.match(html, /לא הוגדר/);
  assert.match(html, /הערה חדשה/);
  assert.match(html, /נשלח על ידי:/);
  assert.match(html, /ישראל ישראלי/);
  assert.match(html, /תאריך הבקשה:/);
  assert.match(html, /data-request-id="REQ-EDIT-1"/);
  assert.match(html, /data-request-type="edit_activity"/);
  assert.match(html, /data-action="approve"/);
  assert.match(html, /data-action="reject"/);

  assert.doesNotMatch(html, /מזהה:/);
  assert.doesNotMatch(html, /סוג בקשה:/);
  assert.doesNotMatch(html, /PAI-123e4567-e89b-12d3-a456-426614174000/);
  assert.doesNotMatch(html, /1503/);
  assert.doesNotMatch(html, /בית ספר:/);
  assert.doesNotMatch(html, /תאריך:/);
  assert.doesNotMatch(html, /שעות:/);
  assert.doesNotMatch(html, />\s*—\s*</);
  assert.doesNotMatch(html, /emp_id/);
  assert.doesNotMatch(html, /row_id/);
});

test('create_activity card hides technical payload fields and empty values', () => {
  const html = renderGroup({
    request_id: 'REQ-CREATE-1',
    request_type: 'create_activity',
    status: 'pending',
    source_row_id: '',
    activity_name: 'פעילות חדשה',
    authority: 'תל אביב',
    school: 'בי״ס הדוגמה',
    requested_by_name: 'מנהל א',
    requested_at: '2026-09-09',
    can_approve: true,
    requested_payload: {
      activity_name: 'פעילות חדשה',
      authority: 'תל אביב',
      school: 'בי״ס הדוגמה',
      activity_type: 'course',
      notes: 'הערה',
      row_id: 'should-hide',
      emp_id: '999',
      authority_id: '42',
      school_id: '77'
    },
    fields: [
      { field_name: 'activity_name', old_value: '', new_value: 'פעילות חדשה' },
      { field_name: 'authority', old_value: '', new_value: 'תל אביב' },
      { field_name: 'school', old_value: '', new_value: 'בי״ס הדוגמה' },
      { field_name: 'activity_type', old_value: '', new_value: 'course' },
      { field_name: 'notes', old_value: '', new_value: 'הערה' },
      { field_name: 'row_id', old_value: '', new_value: 'should-hide' },
      { field_name: 'emp_id', old_value: '', new_value: '999' },
      { field_name: 'authority_id', old_value: '', new_value: '42' },
      { field_name: 'school_id', old_value: '', new_value: '77' },
      { field_name: 'finance_notes', old_value: '', new_value: '' }
    ]
  }, true);

  assert.match(html, /בקשה להוספת פעילות/);
  assert.match(html, /פעילות חדשה/);
  assert.match(html, /פרטי הפעילות המבוקשת/);
  assert.match(html, /הערות/);
  assert.match(html, /הערה/);
  assert.match(html, /data-request-id="REQ-CREATE-1"/);
  assert.match(html, /data-action="approve"/);

  assert.doesNotMatch(html, /מזהה:/);
  assert.doesNotMatch(html, /should-hide/);
  assert.doesNotMatch(html, /\b999\b/);
  assert.doesNotMatch(html, /authority_id/);
  assert.doesNotMatch(html, /school_id/);
  assert.doesNotMatch(html, /row_id/);
});
