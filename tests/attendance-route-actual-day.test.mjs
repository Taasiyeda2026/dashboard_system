import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAttendanceDayRouteKilometers,
  applyDashboardRouteKilometers
} from '../frontend/src/screens/attendance-control.js';

function routeCache() {
  return [
    { origin_instructor_emp_id: 1, destination_school_id: 10, distance_km: 100 },
    { origin_instructor_emp_id: 1, destination_school_id: 20, distance_km: 60 },
    { origin_school_id: 10, destination_school_id: 20, distance_km: 30 }
  ];
}

function dashboardRows() {
  return [
    { employeeId: '1', date: '2026-09-01', startTime: '08:00', activityId: 'ACT-A', meetingNo: '1', meetingNumbers: ['1'], schoolId: 10, school: 'בית ספר א', program: 'א', kilometers: null },
    { employeeId: '1', date: '2026-09-03', startTime: '12:00', activityId: 'ACT-B', meetingNo: '1', meetingNumbers: ['1'], schoolId: 20, school: 'בית ספר ב', program: 'ב', kilometers: null }
  ];
}

test('actual attendance day splits home/activity/activity/home route across records', () => {
  const rows = dashboardRows();
  applyDashboardRouteKilometers(rows, routeCache());
  assert.equal(rows[0].kilometers, 200, 'scheduled-day calculation starts as a standalone round trip');
  assert.equal(rows[1].kilometers, 120, 'scheduled-day calculation starts as a standalone round trip');

  applyAttendanceDayRouteKilometers(rows, [
    { employeeId: '1', date: '2026-09-02', startTime: '08:20', activityId: 'ACT-A', meetingNo: '1', activityType: 'קורס', school: 'בית ספר א' },
    { employeeId: '1', date: '2026-09-02', startTime: '12:10', activityId: 'ACT-B', meetingNo: '1', activityType: 'קורס', school: 'בית ספר ב' }
  ], routeCache());

  assert.equal(rows[0].kilometers, 100, 'first record gets home -> first activity only');
  assert.equal(rows[1].kilometers, 90, 'last record gets previous activity -> activity + return home');
});

test('one physical attendance record keeps a full home/activity/home round trip', () => {
  const rows = dashboardRows().slice(0, 1);
  applyAttendanceDayRouteKilometers(rows, [
    { employeeId: '1', date: '2026-09-02', startTime: '08:20', activityId: 'ACT-A', meetingNo: '1', activityType: 'קורס', school: 'בית ספר א' }
  ], routeCache());
  assert.equal(rows[0].kilometers, 200);
});

test('generated travel-time cancellation is not treated as another route stop', () => {
  const rows = dashboardRows().slice(0, 1);
  applyAttendanceDayRouteKilometers(rows, [
    { employeeId: '1', date: '2026-09-02', startTime: '08:20', activityId: 'ACT-A', meetingNo: '1', activityType: 'קורס', school: 'בית ספר א' },
    { employeeId: '1', date: '2026-09-02', startTime: '', activityId: '', activityType: 'ביטול זמן', _source: { generationKind: 'travel_time_cancellation' } }
  ], routeCache());
  assert.equal(rows[0].kilometers, 200);
});

test('an unresolved additional physical stop makes the linked day route unavailable', () => {
  const rows = dashboardRows().slice(0, 1);
  rows[0].kilometers = 200;
  applyAttendanceDayRouteKilometers(rows, [
    { employeeId: '1', date: '2026-09-02', startTime: '08:20', activityId: 'ACT-A', meetingNo: '1', activityType: 'קורס', school: 'בית ספר א' },
    { employeeId: '1', date: '2026-09-02', startTime: '13:00', activityId: '', activityType: 'תפעול', school: 'יעד אחר' }
  ], routeCache());
  assert.equal(rows[0].kilometers, null);
});

test('non-school physical location with a trusted address participates in the day route', () => {
  const rows = [
    { employeeId: '1530', date: '2026-09-15', startTime: '10:00', sourceRecordId: 'training-1', destinationAddress: '6RVR+XM, יקום', destinationEntityKey: 'training:base_training', destinationType: 'location', kilometers: null, __routeOnly: true }
  ];
  const attendance = [{
    employeeId: '1530', date: '2026-09-15', startTime: '10:00', endTime: '15:00',
    recordId: 'training-1', activityType: 'הכשרה', program: 'הכשרת בסיס',
    destinationAddress: '6RVR+XM, יקום', destinationEntityKey: 'training:base_training',
    destinationType: 'location'
  }];
  const cache = [{
    origin_instructor_emp_id: 1530,
    origin_entity_key: 'instructor:1530',
    destination_entity_key: 'training:base_training',
    origin_address: 'בית צפפה 14, ירושלים',
    destination_address: '6RVR+XM, יקום',
    distance_km: 86
  }];

  applyAttendanceDayRouteKilometers(rows, attendance, cache);
  assert.equal(rows[0].kilometers, 172, 'home -> external location -> home is a valid physical route without school_id');
});
