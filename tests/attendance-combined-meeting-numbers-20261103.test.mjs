import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAttendanceRows, resultsHtml } from '../frontend/src/screens/attendance-control.js';

test('combined school report shows distinct dashboard meeting numbers instead of a dash', () => {
  const attendance = [{
    employeeId: '1528', employeeName: 'מדריך', date: '2026-10-21',
    activityType: 'קורס', program: 'טכנולוגיות החלל', school: 'רמבם מד-נהריה',
    authority: 'נהרייה', startTime: '08:20', endTime: '11:45',
    workHours: 4, meetingNo: '1, 2', kilometers: 56
  }];
  const dashboard = [
    { employeeId: '1528', date: '2026-10-21', activityId: 'ACT-1',
      activityType: 'course', program: 'טכנולוגיות החלל', school: 'רמבם מד-נהריה',
      authority: 'נהרייה', startTime: '08:20', endTime: '09:45',
      workHours: 2, meetingNo: 1, kilometers: 55.46 },
    { employeeId: '1528', date: '2026-10-21', activityId: 'ACT-2',
      activityType: 'course', program: 'טכנולוגיות החלל', school: 'רמבם מד-נהריה',
      authority: 'נהרייה', startTime: '10:15', endTime: '11:45',
      workHours: 2, meetingNo: 2, kilometers: null }
  ];
  const result = compareAttendanceRows(attendance, dashboard);
  assert.equal(result.comparisons.length, 1);
  assert.equal(result.comparisons[0].dashboard.meetingNo, '1, 2');
  assert.deepEqual(result.comparisons[0].dashboard.meetingNumbers, ['1','2']);
  assert.ok(!result.comparisons[0].differences.some(d => d.key === 'meetingNo'));
  const html = resultsHtml(result);
  assert.match(html, /מספר מפגש/);
  assert.doesNotMatch(html, /מספר מפגש שונה/);
});
