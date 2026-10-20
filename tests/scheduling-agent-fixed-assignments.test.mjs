import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProtectedAgentRows, assertNoUnlocatedCourseAssignments } from '../services/scheduling-agent/compute-plan.mjs';
import { officialMeetings, validatePlanWithRoutes } from '../frontend/src/screens/scheduling-core/constraints.js';

const assigned = { row_id: 'fixed-a', activity_season: 'school_2027', activity_type: 'קורס',
  status: 'פתוח', emp_id: 1507, instructor_assignment_locked: true,
  start_time: '08:15', end_time: '09:45', date_1: '2026-11-04',
  school_id: '10', school_address: 'school', instruction_language: 'he' };
function live(activity = assigned) {
  return { courseId: activity.row_id, kind: 'live', instructorEmpId: String(activity.emp_id || activity.emp_id_2),
    meetings: officialMeetings(activity), options: [], packingOptions: [], scheduleOptions: [],
    additionalInstructorEmpIds: activity.emp_id && activity.emp_id_2 ? [String(activity.emp_id_2)] : [] };
}
test('agent retains the exact assigned instructor dates times and secondary instructor', () => {
  const a = { ...assigned, emp_id_2: '1510' };
  assert.deepEqual(assertProtectedAgentRows([live(a)], [a]), ['fixed-a']);
});

test('agent rejects instructor date time kind option and coteacher changes to a fixed assignment', () => {
  for (const mutate of [
    row => { row.instructorEmpId = '9999'; },
    row => { row.meetings[0].date = '2026-11-11'; },
    row => { row.meetings[0].start_time = '09:00'; },
    row => { row.kind = 'proposal'; },
    row => { row.options = [{ instructorEmpId: '9999' }]; },
    row => { row.additionalInstructorEmpIds = ['9999']; },
    row => { row.meetings[0].substituteEmpId = '9999'; }
  ]) {
    const row = live(); mutate(row);
    assert.throws(() => assertProtectedAgentRows([row], [assigned]), /protected_assignment_changed/);
  }
});

test('agent preserves a fixed meeting substitution', () => {
  const a = { ...assigned, meeting_instructor_overrides: [{ meeting_date: '2026-11-04', emp_id: '1510' }] };
  assert.deepEqual(assertProtectedAgentRows([live(a)], [a]), ['fixed-a']);
  const changed = live(a); changed.meetings[0].substituteEmpId = '1507';
  assert.throws(() => assertProtectedAgentRows([changed], [a]), /protected_assignment_changed/);
});

test('an existing fixed assignment with an unknown school location remains an anchor', () => {
  const row = live();
  const ids = assertProtectedAgentRows([row], [assigned]);
  assert.doesNotThrow(() => assertNoUnlocatedCourseAssignments([row], ['fixed-a'], ids));
  assert.throws(() => assertNoUnlocatedCourseAssignments([{ ...row, courseId: 'unassigned' }],
    ['unassigned'], ids), /unlocated_school_assignment_forbidden/);
});

test('fixed anchors do not request routes again during final validation', async () => {
  let requests = 0;
  const routeClient = { peek: () => null, request: async () => { requests++; return null; } };
  const result = await validatePlanWithRoutes({ activities: [assigned], rows: [live()],
    instructors: [{ emp_id: 1507, address: 'home', active: 'yes' }],
    profiles: {}, rules: {}, exceptions: {}, schoolCalendar: [], routeClient });
  assert.equal(requests, 0);
  assert.equal(result.valid, true);
});

test('unassigned proposals still request the routes needed for their own validation', async () => {
  let requests = 0;
  const a = { ...assigned, emp_id: null, instructor_assignment_locked: false };
  await validatePlanWithRoutes({ activities: [a], rows: [{ ...live(), kind: 'fixed-proposal' }],
    instructors: [{ emp_id: 1507, address: 'home', active: 'yes' }],
    profiles: {}, rules: {}, exceptions: {}, schoolCalendar: [],
    routeClient: { peek: () => null, request: async () => { requests++; return null; } } });
  assert.ok(requests > 0);
});
