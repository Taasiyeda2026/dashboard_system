import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAttendanceDayRouteKilometers,
  applyDashboardRouteKilometers,
  compareAttendanceRows
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

test('an unresolved additional physical stop preserves earlier verified inbound mileage', () => {
  const rows = dashboardRows().slice(0, 1);
  rows[0].kilometers = 200;
  applyAttendanceDayRouteKilometers(rows, [
    { employeeId: '1', date: '2026-09-02', startTime: '08:20', activityId: 'ACT-A', meetingNo: '1', activityType: 'קורס', school: 'בית ספר א' },
    { employeeId: '1', date: '2026-09-02', startTime: '13:00', activityId: '', activityType: 'תפעול', school: 'יעד אחר' }
  ], routeCache());
  assert.equal(rows[0].kilometers, 100, 'only the independently verified home-to-first leg is shown');
});

test('non-school physical location with a trusted address participates in the day route', () => {
  const rows = [
    { employeeId: '1530', date: '2026-09-15', startTime: '10:00', sourceRecordId: 'training-1', destinationAddress: '6RVR+XM, יקום', destinationEntityKey: 'training:base_training', destinationType: 'location', kilometers: null, __routeOnly: true }
  ];
  const attendance = [{
    employeeId: '1530', date: '2026-09-15', startTime: '10:00', endTime: '15:00',
    recordId: 'training-1', activityType: 'הכשרה', trainingMode: 'physical', program: 'הכשרת בסיס',
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

test('legacy address-only cache route is valid for a non-school physical destination', () => {
  const rows = [
    { employeeId: '1530', date: '2026-09-15', startTime: '10:00', sourceRecordId: 'training-legacy', originAddress: 'בית צפפה 14, ירושלים', destinationAddress: '6RVR+XM, יקום', destinationEntityKey: 'training:base_training', destinationType: 'location', kilometers: null, __routeOnly: true }
  ];
  const attendance = [{
    employeeId: '1530', date: '2026-09-15', startTime: '10:00', endTime: '15:00',
    recordId: 'training-legacy', activityType: 'הכשרה', trainingMode: 'physical', program: 'הכשרת בסיס',
    originAddress: 'בית צפפה 14, ירושלים',
    destinationAddress: '6RVR+XM, יקום', destinationEntityKey: 'training:base_training',
    destinationType: 'location'
  }];
  const cache = [{
    origin_address: 'בית צפפה 14, ירושלים',
    destination_address: '6RVR+XM, יקום',
    distance_km: 87.385
  }];

  applyAttendanceDayRouteKilometers(rows, attendance, cache);
  assert.equal(rows[0].kilometers, 174.77);
});


test('planned base training uses directional Google route mileage and surfaces a reported-km discrepancy', () => {
  const rows = [{
    employeeId: '1538',
    date: '2026-09-15',
    startTime: '10:00',
    endTime: '15:00',
    activityType: 'הכשרה',
    program: 'הכשרת בסיס',
    kilometers: null,
    __trainingSchedule: true
  }, {
    employeeId: '1538',
    date: '2026-09-15',
    startTime: '10:00',
    sourceRecordId: 'training-mohammad',
    destinationAddress: '6RVR+XM, יקום',
    destinationEntityKey: 'training:base_training',
    destinationType: 'location',
    kilometers: null,
    __routeOnly: true
  }];
  const attendance = [{
    employeeId: '1538',
    employeeName: 'מוחמד סוילם',
    date: '2026-09-15',
    recordId: 'training-mohammad',
    activityType: 'הכשרה',
    trainingMode: 'physical',
    program: 'הכשרת בסיס',
    startTime: '10:00',
    endTime: '15:00',
    workHours: 5,
    kilometers: 285,
    publicTransport: false,
    originAddress: 'זית 6, מיתר',
    destinationAddress: '6RVR+XM, יקום',
    destinationEntityKey: 'training:base_training',
    destinationType: 'location'
  }];
  const cache = [{
    origin_address: 'זית 6, מיתר',
    destination_address: '6RVR+XM, יקום',
    distance_km: 132.462
  }, {
    origin_address: '6RVR+XM, יקום',
    destination_address: 'זית 6, מיתר',
    distance_km: 135.041
  }];

  applyAttendanceDayRouteKilometers(rows, attendance, cache);

  assert.equal(rows[0].kilometers, 267.5, 'training plan receives the calculated round-trip mileage');
  assert.equal(rows[1].kilometers, null, 'route-only helper is not the review source when a training plan exists');

  const result = compareAttendanceRows(attendance, rows);
  assert.equal(result.comparisons.length, 1);
  const kmDiff = result.comparisons[0].differences.find((diff) => diff.key === 'kilometers');
  assert.ok(kmDiff, '285 reported km must be compared to the route calculation');
  assert.equal(kmDiff.attendance, 285);
  assert.equal(kmDiff.dashboard, 267.5);
});


test('severe outbound/return mismatch is sent to manager review instead of showing misleading km', () => {
  const rows = [{
    employeeId: '1550', date: '2026-10-25', startTime: '13:00',
    sourceRecordId: 'liron-bialik', destinationAddress: 'שבזי 9',
    destinationEntityKey: 'school_id:2561', destinationType: 'school',
    kilometers: null, __routeOnly: true
  }];
  const attendance = [{
    employeeId: '1550', date: '2026-10-25', startTime: '13:00',
    recordId: 'liron-bialik', activityType: 'קורס',
    originAddress: 'עוזיאל 48 , רמת גן', destinationAddress: 'שבזי 9',
    destinationEntityKey: 'school_id:2561', destinationType: 'school'
  }];
  const cache = [
    { origin_instructor_emp_id: 1550, origin_address: 'עוזיאל 48 , רמת גן',
      destination_address: 'שבזי 9', destination_entity_key: 'school_id:2561', distance_km: 29.522 },
    { origin_address: 'שבזי 9', origin_entity_key: 'school_id:2561',
      destination_address: 'עוזיאל 48 , רמת גן', distance_km: 12.339 }
  ];
  applyAttendanceDayRouteKilometers(rows, attendance, cache);
  assert.equal(rows[0].kilometers, null, 'inconsistent cached route must require review');
  assert.equal(attendance[0].kilometers, undefined, 'reported attendance stays untouched');
});

test('moderate directed differences remain calculated without altering attendance', () => {
  const rows = [{
    employeeId: '1550', date: '2026-10-25', startTime: '13:00',
    sourceRecordId: 'moderate', destinationAddress: 'שבזי 9',
    destinationEntityKey: 'school_id:2561', destinationType: 'school',
    kilometers: null, __routeOnly: true
  }];
  const attendance = [{
    employeeId: '1550', date: '2026-10-25', startTime: '13:00',
    recordId: 'moderate', activityType: 'קורס',
    originAddress: 'עוזיאל 48 , רמת גן', destinationAddress: 'שבזי 9',
    destinationEntityKey: 'school_id:2561', destinationType: 'school'
  }];
  const cache = [
    { origin_instructor_emp_id: 1550, origin_address: 'עוזיאל 48 , רמת גן',
      destination_address: 'שבזי 9', destination_entity_key: 'school_id:2561', distance_km: 29.522 },
    { origin_address: 'שבזי 9', origin_entity_key: 'school_id:2561',
      destination_address: 'עוזיאל 48 , רמת גן', distance_km: 26.339 }
  ];
  applyAttendanceDayRouteKilometers(rows, attendance, cache);
  assert.equal(rows[0].kilometers, 55.86);
});
