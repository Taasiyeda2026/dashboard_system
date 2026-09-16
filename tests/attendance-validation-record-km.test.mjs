import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceEntryIsResolved,
  compareAttendanceRows,
  normalizeAttendanceApiRows,
  resultsHtml
} from '../frontend/src/screens/attendance-control.js';

test('attendance API preserves the stable activity row id used by the dashboard', () => {
  const [row] = normalizeAttendanceApiRows([{
    employeeId: '1503', employeeName: 'הנאא אבו אמנה', attendanceDate: '2026-09-02',
    startTime: '08:20', endTime: '10:10', workHours: 1.83, activityType: 'קורס',
    schoolName: 'מקיף אבו גוש', municipality: 'אבו גוש', programName: 'ביומימיקרי',
    sessionNumber: '1', kilometers: 95,
    activityRowId: 'ACT-df3ab86a-092a-41a5-907c-41f3ea67f1a0'
  }]);
  assert.equal(row.activityId, 'ACT-df3ab86a-092a-41a5-907c-41f3ea67f1a0');
});

test('stable activity id and meeting number match even when dashboard date differs', () => {
  const attendance = [{
    employeeId: '1503', employeeName: 'הנאא אבו אמנה', date: '2026-09-02',
    startTime: '08:20', endTime: '10:10', workHours: 1.83, activityType: 'קורס',
    school: 'מקיף אבו גוש', authority: 'אבו גוש', program: 'ביומימיקרי', meetingNo: '1',
    kilometers: 95, activityId: 'ACT-1'
  }];
  const dashboard = [{
    employeeId: '1503', employeeName: 'הנאא אבו אמנה', date: '2026-09-01',
    startTime: '08:20', endTime: '10:10', workHours: 1.83, activityType: 'קורס',
    school: 'מקיף אבו גוש', authority: 'אבו גוש', program: 'ביומימיקרי', meetingNo: '1',
    kilometers: 80, activityId: 'ACT-1'
  }];
  const result = compareAttendanceRows(attendance, dashboard);
  const entry = result.comparisons[0];
  assert.equal(entry.unmatched, false);
  assert.equal(entry.dashboard.activityId, 'ACT-1');
  assert.ok(entry.differences.some((difference) => difference.key === 'kilometers'));
  assert.equal(attendanceEntryIsResolved(entry), false);
  const html = resultsHtml(result);
  assert.match(html, /קילומטרים[\s\S]*95[\s\S]*80[\s\S]*לבדיקה/);
  assert.doesNotMatch(html, /ק״מ ליום|ק״מ מדווח:/);
});

test('kilometer tolerance is evaluated per matched record', () => {
  const base = {
    employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00',
    workHours: 1, activityType: 'סדנה', school: 'א', authority: 'א', program: 'א',
    meetingNo: '1', activityId: 'ACT-10'
  };
  const dashboard = [{ ...base, kilometers: 40 }];
  const within = compareAttendanceRows([{ ...base, kilometers: 45 }], dashboard);
  const outside = compareAttendanceRows([{ ...base, kilometers: 46 }], dashboard);
  assert.equal(within.comparisons[0].differences.some((difference) => difference.key === 'kilometers'), false);
  assert.equal(outside.comparisons[0].differences.some((difference) => difference.key === 'kilometers'), true);
});

test('generated travel-time cancellation still requires manager approval', () => {
  const result = compareAttendanceRows([{
    employeeId: '1503', employeeName: 'הנאא אבו אמנה', date: '2026-09-02',
    startTime: '06:30', endTime: '08:15', workHours: 1.75,
    activityType: 'ביטול זמן', school: 'מקיף אבו גוש', authority: 'אבו גוש',
    program: 'ביטול זמן מחושב', kilometers: 0,
    _source: { generationKind: 'travel_time_cancellation' }
  }], []);
  assert.equal(result.notCompared.length, 1);
  assert.equal(attendanceEntryIsResolved(result.notCompared[0]), false);
  assert.match(resultsHtml(result), /ביטול זמן[\s\S]*⚠ לבדיקה/);
});
