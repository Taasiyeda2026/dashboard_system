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

test('decorated attendance program label is not a mismatch when stable activity id matches', () => {
  const attendance = [{
    employeeId: '1503', date: '2026-09-02', startTime: '08:20', endTime: '10:10',
    workHours: 1.83, activityType: 'קורס', school: 'מקיף אבו גוש', authority: 'אבו גוש',
    program: 'ביומימיקרי — מקיף אבו גוש — אבו גוש', meetingNo: '1', kilometers: 95, activityId: 'ACT-1'
  }];
  const dashboard = [{
    employeeId: '1503', date: '2026-09-01', startTime: '08:20', endTime: '10:10',
    workHours: 1.83, activityType: 'קורס', school: 'מקיף אבו גוש', authority: 'אבו גוש',
    program: 'ביומימיקרי', meetingNo: '1', kilometers: 95, activityId: 'ACT-1'
  }];
  const entry = compareAttendanceRows(attendance, dashboard).comparisons[0];
  assert.equal(entry.differences.some((difference) => difference.key === 'program'), false);
});

test('comparison UI hides empty zero-value rows but keeps real kilometer differences', () => {
  const base = {
    employeeId: '10', employeeName: 'מדריך', date: '2026-09-02', startTime: '08:00', endTime: '09:00',
    workHours: 1, activityType: 'קורס', school: 'בית ספר', authority: 'רשות', program: 'תכנית',
    meetingNo: '1', activityId: 'ACT-10', publicTransport: false, publicTransportCost: 0, expenses: 0
  };
  const result = compareAttendanceRows([{ ...base, kilometers: 95 }], [{ ...base, kilometers: 120 }]);
  const html = resultsHtml(result);
  assert.doesNotMatch(html, /<th>הוצאות<\/th>/);
  assert.doesNotMatch(html, /<th>תחבורה ציבורית<\/th>/);
  assert.doesNotMatch(html, /<th>עלות תחבורה ציבורית<\/th>/);
  assert.match(html, /<th>קילומטרים<\/th>[\s\S]*95[\s\S]*120/);
});

test('generated cancellation review is compact and does not show irrelevant zero travel or expense fields', () => {
  const result = compareAttendanceRows([{
    employeeId: '1503', employeeName: 'הנאא אבו אמנה', date: '2026-09-02',
    startTime: '06:30', endTime: '08:15', workHours: 1.75,
    activityType: 'ביטול זמן', school: 'מקיף אבו גוש', authority: 'אבו גוש',
    program: 'ביטול זמן מחושב', kilometers: 0, publicTransport: false, publicTransportCost: 0,
    expenses: 0,
    _source: { generationKind: 'travel_time_cancellation', finalCancellationMinutes: 105 }
  }], []);
  const html = resultsHtml(result);
  assert.match(html, /ביטול זמן: 1:45/);
  assert.match(html, /אשר כפי שדווח/);
  assert.doesNotMatch(html, /<th>ק״מ<\/th>/);
  assert.doesNotMatch(html, /<th>תחבורה ציבורית<\/th>/);
  assert.doesNotMatch(html, /<th>הוצאות<\/th>/);
  assert.doesNotMatch(html, /מקיף אבו גוש \| אבו גוש/);
});

