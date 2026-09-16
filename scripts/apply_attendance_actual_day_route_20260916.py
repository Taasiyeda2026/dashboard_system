from pathlib import Path

path = Path('frontend/src/screens/attendance-control.js')
text = path.read_text(encoding='utf-8')

marker = "\nexport function applyDashboardExpenses(rows = [], expenses = []) {"
assert text.count(marker) == 1, f'expected one expenses marker, found {text.count(marker)}'

insertion = r'''

function nearestAttendanceRouteDashboardRow(attendance, rows = []) {
  const employeeId = txt(attendance?.employeeId);
  const activityId = txt(attendance?.activityId);
  if (!employeeId || !activityId) return null;

  let candidates = rows.filter((row) => !row?.__profile
    && txt(row.employeeId) === employeeId
    && txt(row.activityId) === activityId);
  if (!candidates.length) return null;

  const expectedMeetings = parseMeetingNumberList(attendance?.meetingNo);
  if (expectedMeetings.length) {
    const byMeeting = candidates.filter((row) => {
      const actualMeetings = dashboardMeetingNumbers(row);
      return expectedMeetings.every((meetingNo) => actualMeetings.includes(meetingNo));
    });
    if (byMeeting.length) candidates = byMeeting;
  }
  if (candidates.length === 1) return candidates[0];

  const targetTime = Date.parse(`${txt(attendance?.date)}T00:00:00Z`);
  return [...candidates].sort((left, right) => {
    const leftTime = Date.parse(`${txt(left?.date)}T00:00:00Z`);
    const rightTime = Date.parse(`${txt(right?.date)}T00:00:00Z`);
    const leftDistance = Number.isFinite(targetTime) && Number.isFinite(leftTime) ? Math.abs(leftTime - targetTime) : Number.MAX_SAFE_INTEGER;
    const rightDistance = Number.isFinite(targetTime) && Number.isFinite(rightTime) ? Math.abs(rightTime - targetTime) : Number.MAX_SAFE_INTEGER;
    return leftDistance - rightDistance || timeText(left?.startTime).localeCompare(timeText(right?.startTime));
  })[0] || null;
}

// Attendance can be reported on a different date from the scheduled meeting.
// Kilometer validation must therefore follow the instructor's ACTUAL workday sequence:
// home -> first physical activity -> next physical activity -> ... -> home.
// Each attendance record receives only the route segment(s) that belong to it.
export function applyAttendanceDayRouteKilometers(rows = [], attendanceRows = [], travelCache = []) {
  const groups = new Map();

  for (const attendance of attendanceRows || []) {
    if (!attendance?.employeeId || !attendance?.date) continue;
    if (isAttendanceTravelTimeCancellation(attendance)
      || normalizeAttendanceName(attendance?.activityType).includes('ביטולזמן')) continue;

    const isZoom = /zoom|זום/u.test(normalizeAttendanceName(`${attendance?.school || ''} ${attendance?.program || ''} ${attendance?.activityType || ''}`));
    const dashboard = nearestAttendanceRouteDashboardRow(attendance, rows);
    const key = `${txt(attendance.employeeId)}|${txt(attendance.date)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ attendance, dashboard, isZoom });
  }

  for (const stops of groups.values()) {
    const physicalStops = stops.filter((stop) => !stop.isZoom);
    stops.filter((stop) => stop.isZoom && stop.dashboard).forEach((stop) => { stop.dashboard.kilometers = 0; });
    if (!physicalStops.length) continue;

    const linkedRows = [...new Set(physicalStops.map((stop) => stop.dashboard).filter(Boolean))];
    linkedRows.forEach((row) => { row.kilometers = null; });

    // If the employee reported another physical stop that cannot be resolved to a
    // dashboard destination, the complete route is unknown. Do not show a misleading
    // partial distance for the rows that did resolve.
    if (physicalStops.some((stop) => !stop.dashboard || stop.dashboard.schoolId == null)) continue;

    physicalStops.sort((left, right) => timeText(left.attendance?.startTime).localeCompare(timeText(right.attendance?.startTime)));
    let routeUnavailable = false;
    physicalStops.forEach((stop, index) => {
      const employeeId = txt(stop.attendance.employeeId);
      const schoolId = stop.dashboard.schoolId;
      const incoming = index === 0
        ? instructorSchoolDistance(travelCache, employeeId, schoolId)
        : schoolSchoolDistance(travelCache, physicalStops[index - 1].dashboard.schoolId, schoolId);
      const returnHome = index === physicalStops.length - 1
        ? instructorSchoolDistance(travelCache, employeeId, schoolId)
        : 0;
      if (incoming == null || returnHome == null) {
        routeUnavailable = true;
        return;
      }
      stop.dashboard.kilometers = Math.round((incoming + returnHome) * 100) / 100;
    });

    if (routeUnavailable) linkedRows.forEach((row) => { row.kilometers = null; });
  }
  return rows;
}
'''

text = text.replace(marker, insertion + marker, 1)

old = """  applyDashboardRouteKilometers(rows, sources.travelCache || []);\n  applyDashboardExpenses(rows, sources.expenses || []);"""
new = """  applyDashboardRouteKilometers(rows, sources.travelCache || []);\n  applyAttendanceDayRouteKilometers(rows, attendanceRows, sources.travelCache || []);\n  applyDashboardExpenses(rows, sources.expenses || []);"""
assert text.count(old) == 1, f'expected one route loader block, found {text.count(old)}'
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')

test_path = Path('tests/attendance-route-actual-day.test.mjs')
test_path.write_text(r'''import test from 'node:test';
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
''', encoding='utf-8')
