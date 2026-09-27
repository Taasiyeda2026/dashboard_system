import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyAttendanceManualCorrection,
  attendanceTimeRangeIsValid,
  compareAttendanceRows,
  parseDurationHoursInput,
  resultsHtml
} from '../frontend/src/screens/attendance-control.js';

const source = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');

const submittedWorkflow = (employeeId) => ({
  workflowByEmployee: {
    [String(employeeId)]: {
      workflow_status: 'submitted',
      attendance_submission_status: 'submitted'
    }
  }
});

test('review table is parameter-driven and exposes the approved five-column structure', () => {
  assert.match(source, /<th>פרמטר<\/th><th>נוכחות<\/th>/);
  assert.match(source, /<th>סטטוס<\/th><th>פעולות<\/th>/);
  assert.match(source, /רשות \/ יישוב/);
  assert.match(source, /בית ספר \/ מיקום/);
  assert.match(source, /תוכנית \/ קורס/);
  assert.match(source, /תחבורה ציבורית/);
  assert.match(source, /עלות תחבורה ציבורית/);
  assert.match(source, /פירוט הוצאה/);
  assert.match(source, /הערות/);
});

test('differences expose attendance, dashboard and edit actions in the actions column', () => {
  const html = resultsHtml({
    comparisons: [{
      id: 'course-diff',
      managerResolved: null,
      attendance: {
        employeeId: '10', employeeName: 'דנה', date: '2026-09-15',
        activityType: 'קורס', program: 'קורס א', school: 'בית ספר א', authority: 'רשות א',
        meetingNo: '2', startTime: '10:00', endTime: '12:00', workHours: 2,
        kilometers: 20, publicTransport: false, expenses: 0
      },
      dashboard: {
        employeeId: '10', date: '2026-09-15',
        activityType: 'קורס', program: 'קורס א', school: 'בית ספר א', authority: 'רשות א',
        meetingNo: '2', startTime: '10:00', endTime: '11:30', workHours: 1.5,
        kilometers: 20
      },
      final: {
        employeeId: '10', date: '2026-09-15',
        activityType: 'קורס', program: 'קורס א', school: 'בית ספר א', authority: 'רשות א',
        meetingNo: '2', startTime: '10:00', endTime: '12:00', workHours: 2,
        kilometers: 20, publicTransport: false, expenses: 0
      },
      differences: [
        { key: 'endTime', label: 'שעת סיום', type: 'time', attendance: '12:00', dashboard: '11:30', choice: 'attendance', custom: '' }
      ],
      unmatched: false
    }],
    notCompared: [],
    dailyKilometers: []
  }, '2026-09', submittedWorkflow('10'));

  assert.match(html, /אישור נוכחות/);
  assert.match(html, /אישור דשבורד/);
  assert.match(html, />עריכה</);
  assert.match(html, /data-field-key="endTime"/);
  assert.match(html, /סה״כ שעות/);
  assert.match(html, /מחושב אוטומטית/);
  assert.match(html, />1:30</);
  assert.match(html, /data-field-key="workHours"/);
  assert.match(html, /לבדיקה/);
});

test('planned training shows every relevant reported parameter but omits irrelevant blank rows', () => {
  const html = resultsHtml({
    comparisons: [{
      id: 'training-1',
      managerResolved: null,
      attendance: {
        employeeId: '1533', employeeName: 'שחר זוביב', date: '2026-09-15',
        activityType: 'הכשרה', program: 'הכשרת בסיס',
        school: 'Greenwork', authority: 'יקום',
        startTime: '10:00', endTime: '16:00', workHours: 6,
        kilometers: 130, publicTransport: false, expenses: 0
      },
      dashboard: {
        employeeId: '1533', date: '2026-09-15',
        activityType: 'הכשרה', program: 'הכשרת בסיס',
        startTime: '10:00', endTime: '15:00', workHours: 5,
        __trainingSchedule: true
      },
      final: {
        employeeId: '1533', date: '2026-09-15',
        activityType: 'הכשרה', program: 'הכשרת בסיס',
        school: 'Greenwork', authority: 'יקום',
        startTime: '10:00', endTime: '16:00', workHours: 6,
        kilometers: 130, publicTransport: false, expenses: 0
      },
      differences: [
        { key: 'endTime', label: 'שעת סיום', type: 'time', attendance: '16:00', dashboard: '15:00', choice: 'attendance', custom: '' },
        { key: 'workHours', label: 'שעות עבודה', type: 'number', attendance: 6, dashboard: 5, choice: 'attendance', custom: '' }
      ],
      unmatched: false
    }],
    notCompared: [],
    dailyKilometers: []
  }, '2026-09', submittedWorkflow('1533'));

  assert.match(html, /בדיקת ההכשרה מול התכנון/);
  assert.match(html, /<th>תכנון \/ מערכת<\/th>/);
  assert.match(html, /רשות \/ יישוב/);
  assert.match(html, /בית ספר \/ מיקום/);
  assert.match(html, /Greenwork/);
  assert.match(html, /יקום/);
  assert.match(html, /130 ק״מ/);
  assert.match(html, />5:00</);
  assert.match(html, /data-attendance-edit-record="training-1"/);
  assert.match(html, /אישור רשומה/);
  assert.doesNotMatch(html, /מספר מפגש/);
  assert.doesNotMatch(html, /תחבורה ציבורית<\/th>/);
  assert.doesNotMatch(html, /הוצאות<\/th>/);
  assert.doesNotMatch(html, /לא נדרש/);
  assert.doesNotMatch(html, /דיווח בלבד/);
});

test('public transport replaces kilometers and only shows cost when relevant', () => {
  const html = resultsHtml({
    comparisons: [],
    notCompared: [{
      id: 'pt-only',
      source: 'attendance_not_compared',
      attendance: {
        employeeId: '10', employeeName: 'דנה', date: '2026-09-20',
        activityType: 'תפעול', startTime: '09:00', endTime: '10:00', workHours: 1,
        publicTransport: true, publicTransportCost: 32, kilometers: 0, expenses: 0
      },
      final: {
        employeeId: '10', date: '2026-09-20',
        activityType: 'תפעול', startTime: '09:00', endTime: '10:00', workHours: 1,
        publicTransport: true, publicTransportCost: 32, kilometers: 0, expenses: 0
      },
      differences: []
    }],
    dailyKilometers: []
  }, '2026-09', submittedWorkflow('10'));

  assert.match(html, /תחבורה ציבורית/);
  assert.match(html, /עלות תחבורה ציבורית/);
  assert.match(html, />32</);
  assert.match(html, /data-attendance-manual-edit="pt-only" data-field-key="publicTransport"/);
  assert.match(html, /data-attendance-manual-edit="pt-only" data-field-key="publicTransportCost"/);
  assert.doesNotMatch(html, /<th>ק״מ<\/th>/);
});

test('expenses, expense detail and notes appear only when there is actual content', () => {
  const html = resultsHtml({
    comparisons: [],
    notCompared: [{
      id: 'expense-only',
      source: 'attendance_not_compared',
      attendance: {
        employeeId: '10', employeeName: 'דנה', date: '2026-09-21',
        activityType: 'תפעול', startTime: '09:00', endTime: '10:00', workHours: 1,
        publicTransport: false, kilometers: 0, expenses: 45,
        expenseDetails: 'חניה', notes: 'אושר מראש'
      },
      final: {
        employeeId: '10', date: '2026-09-21',
        activityType: 'תפעול', startTime: '09:00', endTime: '10:00', workHours: 1,
        publicTransport: false, kilometers: 0, expenses: 45,
        expenseDetails: 'חניה', notes: 'אושר מראש'
      },
      differences: []
    }],
    dailyKilometers: []
  }, '2026-09');

  assert.match(html, /<th>הוצאות<\/th>/);
  assert.match(html, /<th>פירוט הוצאה<\/th>/);
  assert.match(html, /<th>הערות<\/th>/);
  assert.match(html, /חניה/);
  assert.match(html, /אושר מראש/);
});

test('generated long-travel cancellation is folded into its source attendance record', () => {
  const sourceEntry = {
    id: 'attendance-only-0',
    source: 'attendance_not_compared',
    attendance: {
      employeeId: '1533', employeeName: 'שחר זוביב', date: '2026-09-06',
      recordId: 'source-1', activityType: 'תפעול', program: 'הרמת כוסית',
      startTime: '11:00', endTime: '11:05', workHours: 5 / 60,
      kilometers: 80, publicTransport: false, expenses: 0,
      _source: {
        ID: 'source-1',
        recordId: 'source-1',
        travelCalculationStatus: 'resolved',
        outboundTravelMinutes: 40,
        returnTravelMinutes: 38,
        calculatedCancellationMinutes: 11,
        finalCancellationMinutes: 11,
        sourceAttendanceRecordId: 'source-1'
      }
    },
    final: {
      employeeId: '1533', employeeName: 'שחר זוביב', date: '2026-09-06',
      recordId: 'source-1', activityType: 'תפעול', program: 'הרמת כוסית',
      startTime: '11:00', endTime: '11:05', workHours: 5 / 60,
      kilometers: 80, publicTransport: false, expenses: 0
    },
    differences: [],
    managerResolved: null
  };
  const cancellationEntry = {
    id: 'attendance-only-1',
    source: 'attendance_not_compared',
    attendance: {
      employeeId: '1533', employeeName: 'שחר זוביב', date: '2026-09-06',
      recordId: 'cancel-1', activityType: 'ביטול זמן', program: 'ביטול זמן מחושב',
      startTime: '', endTime: '', workHours: 11 / 60,
      kilometers: 0, publicTransport: false, expenses: 0,
      _source: {
        ID: 'cancel-1',
        recordId: 'cancel-1',
        generationKind: 'travel_time_cancellation',
        sourceAttendanceRecordId: 'source-1',
        travelCalculationStatus: 'resolved',
        calculatedCancellationMinutes: 11,
        finalCancellationMinutes: 11,
        manuallyOverridden: false
      }
    },
    final: {
      employeeId: '1533', employeeName: 'שחר זוביב', date: '2026-09-06',
      recordId: 'cancel-1', activityType: 'ביטול זמן', workHours: 11 / 60
    },
    differences: [],
    managerResolved: 'auto_ok'
  };
  const html = resultsHtml({
    comparisons: [],
    notCompared: [sourceEntry, cancellationEntry],
    dailyKilometers: []
  }, '2026-09');

  assert.match(html, /ביטול זמן נסיעה/);
  assert.match(html, />0:11</);
  assert.match(html, /זמן נסיעה הלוך: 0:40/);
  assert.match(html, /זמן נסיעה חזור: 0:38/);
  assert.doesNotMatch(html, /—–— \| ביטול זמן/);
  assert.equal((html.match(/class="attendance-control__report"/g) || []).length, 1);
});

test('system-generated travel cancellation is auto-resolved when calculation is unchanged', () => {
  const sourceRow = {
    employeeId: '1533', employeeName: 'שחר זוביב', date: '2026-09-06',
    recordId: 'source-1', activityType: 'תפעול', program: 'הרמת כוסית',
    startTime: '11:00', endTime: '11:05', workHours: 5 / 60,
    kilometers: 80, publicTransport: false, expenses: 0,
    _source: { ID: 'source-1', recordId: 'source-1' }
  };
  const cancellationRow = {
    employeeId: '1533', employeeName: 'שחר זוביב', date: '2026-09-06',
    recordId: 'cancel-1', activityType: 'ביטול זמן', program: 'ביטול זמן מחושב',
    startTime: '', endTime: '', workHours: 11 / 60,
    kilometers: 0, publicTransport: false, expenses: 0,
    _source: {
      ID: 'cancel-1',
      recordId: 'cancel-1',
      generationKind: 'travel_time_cancellation',
      sourceAttendanceRecordId: 'source-1',
      travelCalculationStatus: 'resolved',
      calculatedCancellationMinutes: 11,
      finalCancellationMinutes: 11,
      manuallyOverridden: false
    }
  };
  const result = compareAttendanceRows([sourceRow, cancellationRow], []);
  const cancellation = result.notCompared.find((entry) => entry.attendance.recordId === 'cancel-1');
  assert.equal(cancellation?.managerResolved, 'auto_ok');
});


test('attendance-only rows expose inline correction instead of empty action cells', () => {
  const html = resultsHtml({
    comparisons: [],
    notCompared: [{
      id: 'attendance-only-edit',
      source: 'attendance_not_compared',
      attendance: {
        employeeId: '1533', employeeName: 'שחר זוביב', date: '2026-09-06',
        recordId: 'source-edit', activityType: 'תפעול', program: 'הרמת כוסית',
        authority: 'יקום', school: 'Greenwork',
        startTime: '11:00', endTime: '11:05', workHours: 5 / 60,
        kilometers: 80, publicTransport: false, expenses: 0,
        _source: { ID: 'source-edit', recordId: 'source-edit' }
      },
      final: {
        employeeId: '1533', employeeName: 'שחר זוביב', date: '2026-09-06',
        recordId: 'source-edit', activityType: 'תפעול', program: 'הרמת כוסית',
        authority: 'יקום', school: 'Greenwork',
        startTime: '11:00', endTime: '11:05', workHours: 5 / 60,
        kilometers: 80, publicTransport: false, expenses: 0
      },
      differences: [],
      managerResolved: null
    }],
    dailyKilometers: []
  }, '2026-09', submittedWorkflow('1533'));

  assert.match(html, /data-attendance-manual-edit="attendance-only-edit" data-field-key="date"/);
  assert.match(html, /data-attendance-manual-edit="attendance-only-edit" data-field-key="startTime"/);
  assert.match(html, /data-attendance-manual-edit="attendance-only-edit" data-field-key="endTime"/);
  assert.match(html, /data-attendance-manual-edit="attendance-only-edit" data-field-key="workHours"/);
  assert.match(html, /מחושב אוטומטית/);
  assert.match(html, /data-attendance-manual-edit="attendance-only-edit" data-field-key="program"/);
  assert.match(html, /data-attendance-manual-edit="attendance-only-edit" data-field-key="kilometers"/);
  assert.doesNotMatch(html, /data-attendance-focus-travel="attendance-only-edit"/);
  assert.doesNotMatch(html, /אשר כפי שדווח/);
  assert.doesNotMatch(html, /שמור תיקון נסיעה/);
  assert.doesNotMatch(html, /שעות שכר מתוקנות/);
});


test('manager can override work hours and reversed attendance times are rejected', () => {
  const entry = {
    attendance: {
      employeeId: '1507', startTime: '11:00', endTime: '11:05', workHours: 5 / 60,
      activityType: 'תפעול'
    },
    final: {
      employeeId: '1507', startTime: '11:00', endTime: '11:05', workHours: 5 / 60,
      activityType: 'תפעול'
    },
    differences: []
  };

  assert.equal(parseDurationHoursInput('1:30'), 1.5);
  assert.equal(parseDurationHoursInput('0:05'), 5 / 60);
  assert.equal(parseDurationHoursInput('1:75'), null);
  applyAttendanceManualCorrection(entry, { workHours: 1.5 });
  assert.equal(entry.final.workHours, 1.5);
  assert.equal(attendanceTimeRangeIsValid('11:00', '11:05'), true);
  assert.equal(attendanceTimeRangeIsValid('13:16', '11:05'), false);
  assert.equal(attendanceTimeRangeIsValid('11:05', '11:05'), false);
});

test('planned training mileage is shown as a system comparison with mileage actions', () => {
  const html = resultsHtml({
    comparisons: [{
      id: 'training-km',
      managerResolved: null,
      attendance: {
        employeeId: '1538', employeeName: 'מוחמד סוילם', date: '2026-09-15',
        activityType: 'הכשרה', program: 'הכשרת בסיס',
        startTime: '10:00', endTime: '15:00', workHours: 5,
        kilometers: 285, publicTransport: false, expenses: 0
      },
      dashboard: {
        employeeId: '1538', date: '2026-09-15',
        activityType: 'הכשרה', program: 'הכשרת בסיס',
        startTime: '10:00', endTime: '15:00', workHours: 5,
        kilometers: 267.5, __trainingSchedule: true
      },
      final: {
        employeeId: '1538', date: '2026-09-15',
        activityType: 'הכשרה', program: 'הכשרת בסיס',
        startTime: '10:00', endTime: '15:00', workHours: 5,
        kilometers: 285, publicTransport: false, expenses: 0
      },
      differences: [
        { key: 'kilometers', label: 'קילומטרים', type: 'number', attendance: 285, dashboard: 267.5, choice: 'attendance', custom: '' }
      ],
      unmatched: false
    }],
    notCompared: [],
    dailyKilometers: []
  }, '2026-09', submittedWorkflow('1538'));

  assert.match(html, /<th>תכנון \/ מערכת<\/th>/);
  assert.match(html, /<th>ק״מ<\/th>/);
  assert.match(html, />285<\/td>/);
  assert.match(html, />267\.5<\/td>/);
  assert.match(html, /אישור חישוב מערכת/);
  assert.match(html, /לבדיקה/);
});


test('attendance review errors use red text only with no yellow or brown warning bubbles', () => {
  assert.doesNotMatch(source, /#a85c00|#b45309|#fff1cf|#fff8e7/i);
  assert.match(source, /attendance-control__status-pill--issue\{color:#b91c1c;background:transparent;min-width:0;padding:0;border-radius:0\}/);
  assert.match(source, /attendance-control__comparison-row--issue th,.attendance-control__comparison-row--issue td\{background:transparent\}/);
  assert.doesNotMatch(source, /⚠ לבדיקה|⚠ לאישור/);
});
