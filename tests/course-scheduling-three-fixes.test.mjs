import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  closeManualCandidateConfirmation,
  consumeManualCandidateConfirmation,
  manualCandidateConfirmationHtml,
  openManualCandidateConfirmation
} from '../frontend/src/screens/course-scheduling.js';
import {
  homeDistanceRequiresManagerApproval,
  MANAGER_APPROVAL_DISTANCE_KM,
  MAX_HOME_DISTANCE_KM
} from '../frontend/src/screens/instructor-matching-engine.js';
import { renderGroup } from '../frontend/src/screens/edit-requests.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('manual selection uses the internal modal and renders every computed reason', async () => {
  const html = manualCandidateConfirmationHtml({ reasons: ['מרחק', 'זמינות', 'שפה', 'מגדר', 'זמן מעבר'] });
  assert.match(html, /course-scheduling-overlay/);
  assert.match(html, /course-scheduling-modal/);
  assert.match(html, /בחירת מדריך ידנית/);
  for (const reason of ['מרחק', 'זמינות', 'שפה', 'מגדר', 'זמן מעבר']) assert.match(html, new RegExp(`<li>${reason}<\\/li>`));
  assert.match(html, /data-cancel-manual-candidate>חזרה/);
  assert.match(html, /data-confirm-manual-candidate>המשך בבחירה ידנית/);
  const source = await read('../frontend/src/screens/course-scheduling.js');
  assert.doesNotMatch(source, /window\.confirm\('המדריך אינו עומד בכל תנאי ההתאמה/);
});

test('manual selection modal cancellation closes without a candidate', () => {
  const state = {};
  openManualCandidateConfirmation(state, { instructor: { emp_id: '17' }, failures: ['שפה'] });
  closeManualCandidateConfirmation(state);
  assert.equal(state.courseSchedulingManualConfirmation, null);
});

test('manual selection modal continuation consumes the same candidate and closes', () => {
  const state = {};
  const candidate = { instructor: { emp_id: '17' }, failures: ['שפה'] };
  openManualCandidateConfirmation(state, candidate);
  assert.equal(consumeManualCandidateConfirmation(state, [candidate]), candidate);
  assert.equal(state.courseSchedulingManualConfirmation, null);
});

test('approval request card uses activity source details, date_1 fallback, hours and warning reason', () => {
  const html = renderGroup({
    request_id: 'req-1', request_type: 'course_assignment_exception', source_row_id: 'activity-1',
    status: 'pending', activity_name: 'stale name', requested_payload: {},
    activity: {
      row_id: 'activity-1', activity_type: 'workshop', activity_name: 'סדנת רובוטיקה',
      school: 'בית ספר א', authority: 'רשות א', activity_manager: 'מנהלת א',
      date_1: '2026-10-12', start_time: '10:00', end_time: '12:00',
      instructor_name: 'מדריכה א', emp_id: '17'
    },
    fields: [
      { field_name: 'scheduling_selected_instructor', new_value: 'מדריכה א (17)' },
      { field_name: 'scheduling_exception_reason', new_value: 'מרחק 61 ק״מ' }
    ]
  }, true);
  for (const value of ['סדנה', 'סדנת רובוטיקה', 'בית ספר א', 'רשות א', 'מנהלת א', '12/10/2026', '10:00–12:00', 'מדריכה א']) {
    assert.match(html, new RegExp(value));
  }
  assert.match(html, /ds-er-exception-warning[^>]*>מרחק 61 ק״מ/);
  assert.doesNotMatch(html, /ds-er-new[^>]*>מרחק 61 ק״מ/);
});

test('approval loader reads current activity details by source_row_id', async () => {
  const source = await read('../frontend/src/screens/shared/course-scheduling-manager-approval.js');
  assert.match(source, /from\('activities'\)[\s\S]*\.in\('row_id', activityIds\)/);
  assert.match(source, /activity_type[\s\S]*date_1[\s\S]*start_time,end_time/);
});

test('40 km matching limit and 60 km manager-approval threshold are distinct and inclusive', () => {
  assert.equal(MAX_HOME_DISTANCE_KM, 40);
  assert.equal(MANAGER_APPROVAL_DISTANCE_KM, 60);
  assert.equal(homeDistanceRequiresManagerApproval(39), false);
  assert.equal(homeDistanceRequiresManagerApproval(40), false);
  assert.equal(homeDistanceRequiresManagerApproval(49), false);
  assert.equal(homeDistanceRequiresManagerApproval(59.9), false);
  assert.equal(homeDistanceRequiresManagerApproval(60), true);
  assert.equal(homeDistanceRequiresManagerApproval(61), true);
  assert.equal(homeDistanceRequiresManagerApproval(75), true);
});

test('server enforces the 60 km approval threshold while preserving the 40 km matching gate', async () => {
  const migration = await read('../supabase/migrations/20260907213000_manual_distance_manager_approval_threshold.sql');
  const matching = await read('../supabase/migrations/20260817054536_course_scheduling_transition_rules.sql');
  assert.match(migration, /home_km\s+is\s+null\s+or\s+home_km\s+>=\s+60/);
  assert.match(migration, /has_non_distance_exception[\s\S]*return true/);
  assert.match(migration, /course_assignment_manager_approval_state/);
  assert.match(migration, /submit_course_assignment_manager_approval/);
  assert.match(migration, /scheduling_guard_manual_exception_approval/);
  assert.match(matching, /if home_km > 40 then raise exception 'scheduling_home_distance_exceeded'/);
});
