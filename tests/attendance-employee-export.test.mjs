import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  buildCorrectedAttendanceWorkbook,
  DAILY_HEADERS,
  DETAIL_HEADERS,
  MONTHLY_HEADERS
} from '../frontend/src/screens/attendance-control.js';

function sheetRows(workbook, name) {
  return XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 });
}

test('employee workbook uses curated columns, H:MM hours and a populated daily sheet for all employment types', () => {
  const comparisons = [
    { final: { employeeId: '10', employeeName: 'דנה', date: '2026-08-01', startTime: '08:00', endTime: '10:00', activityType: 'ביטול זמן', kilometers: 12, expenses: 5, expenseDetails: 'חניה' } },
    { final: { employeeId: '10', employeeName: 'דנה', date: '2026-08-02', startTime: '09:00', endTime: '10:00', activityType: 'הכשרה' } },
    { final: { employeeId: '11', employeeName: 'נועם', date: '2026-08-02', startTime: '09:00', endTime: '10:00', activityType: 'תפעול', authority: 'חיפה' } }
  ];
  const workbook = buildCorrectedAttendanceWorkbook(comparisons, [
    { employeeId: '10', employmentType: 'תעשיידע' },
    { employeeId: '11', employmentType: 'כוח אדם' }
  ]);

  assert.deepEqual(workbook.SheetNames, ['פירוט מלא', 'סיכום חודשי', 'תצוגה יומית']);
  const detail = sheetRows(workbook, 'פירוט מלא');
  const monthly = sheetRows(workbook, 'סיכום חודשי');
  const daily = sheetRows(workbook, 'תצוגה יומית');

  assert.deepEqual(detail[0], DETAIL_HEADERS);
  assert.deepEqual(monthly[0], MONTHLY_HEADERS);
  assert.deepEqual(daily[0], DAILY_HEADERS);
  assert.equal(detail[0].includes('recordId'), false);
  assert.equal(detail[0].includes('generationKind'), false);
  assert.equal(detail[1][5], '2:00');
  assert.equal(monthly[1][2], '2:00');
  assert.equal(monthly[1][3], '1:00');
  assert.equal(daily.length - 1, 3);
  assert.deepEqual(new Set(daily.slice(1).map((row) => row[3])), new Set(['ביטול זמן', 'הכשרה', 'תפעול']));
});

test('generated travel cancellation is folded into the source activity and retained in monthly totals', () => {
  const comparisons = [
    {
      source: 'attendance_not_compared',
      attendance: {
        employeeId: '1538', employeeName: 'מוחמד סוילם', date: '2026-09-15',
        recordId: 'source-1', activityType: 'הכשרה', program: 'הכשרת בסיס',
        authority: 'יקום', startTime: '10:00', endTime: '15:00', workHours: 5,
        kilometers: 267.5,
        _source: {
          recordId: 'source-1', ID: 'source-1', employeeId: '1538', employeeName: 'מוחמד סוילם',
          attendanceDate: '2026-09-15', activityType: 'הכשרה', programName: 'הכשרת בסיס',
          municipality: 'יקום', startTime: '10:00', endTime: '15:00', workHours: 5, kilometers: 267.5
        }
      },
      final: {
        employeeId: '1538', employeeName: 'מוחמד סוילם', date: '2026-09-15',
        recordId: 'source-1', activityType: 'הכשרה', program: 'הכשרת בסיס',
        authority: 'יקום', startTime: '10:00', endTime: '15:00', workHours: 5,
        kilometers: 267.5
      }
    },
    {
      source: 'attendance_not_compared',
      attendance: {
        employeeId: '1538', employeeName: 'מוחמד סוילם', date: '2026-09-15',
        recordId: 'cancel-1', activityType: 'ביטול זמן', workHours: 1.3,
        _source: {
          recordId: 'cancel-1', ID: 'cancel-1', employeeId: '1538', employeeName: 'מוחמד סוילם',
          attendanceDate: '2026-09-15', activityType: 'ביטול זמן', workHours: 1.3,
          generationKind: 'travel_time_cancellation', sourceAttendanceRecordId: 'source-1',
          finalCancellationMinutes: 78
        }
      },
      final: {
        employeeId: '1538', employeeName: 'מוחמד סוילם', date: '2026-09-15',
        recordId: 'cancel-1', activityType: 'ביטול זמן', workHours: 1.3
      }
    }
  ];

  const workbook = buildCorrectedAttendanceWorkbook(comparisons, [{ employeeId: '1538', employmentType: 'תעשיידע' }]);
  const detail = sheetRows(workbook, 'פירוט מלא');
  const daily = sheetRows(workbook, 'תצוגה יומית');
  const monthly = sheetRows(workbook, 'סיכום חודשי');

  assert.equal(detail.length, 2, 'generated cancellation must not become a second detail row');
  assert.equal(detail[1][5], '5:00');
  assert.equal(detail[1][6], '1:18');
  assert.equal(detail[1][7], 'הכשרה');
  assert.equal(daily.length, 2);
  assert.equal(daily[1][7], '5:00');
  assert.equal(daily[1][8], '1:18');
  assert.equal(monthly[1][2], '1:18');
  assert.equal(monthly[1][3], '5:00');
});

test('source-backed corrected date and time are exported instead of stale raw values', () => {
  const comparison = {
    attendance: {
      _source: {
        employeeId: '10', employeeName: 'דנה', attendanceDate: '2026-08-01',
        startTime: '08:00', endTime: '09:00', workHours: 1,
        activityType: 'קורס', attachmentsNames: 'scan.pdf', status: 'approved'
      }
    },
    final: {
      employeeId: '10', employeeName: 'דנה', date: '2026-08-02',
      startTime: '08:15', endTime: '09:00', workHours: 1, activityType: 'קורס'
    }
  };
  const workbook = buildCorrectedAttendanceWorkbook([comparison], []);
  const detail = sheetRows(workbook, 'פירוט מלא');
  assert.equal(detail[1][2], '2026-08-02');
  assert.equal(detail[1][3], '08:15');
  assert.equal(detail[1][18], 'scan.pdf');
});

test('unknown payroll hours stay blank instead of becoming 0:00', () => {
  const row = {
    employeeId: '10', employeeName: 'דנה', date: '2026-05-12',
    startTime: '08:00', endTime: '09:25', payrollHoursRequireReview: true,
    workHours: null, activityType: 'סדנה', school: 'א'
  };
  const workbook = buildCorrectedAttendanceWorkbook([{ final: row }], []);
  const detail = sheetRows(workbook, 'פירוט מלא');
  assert.equal(detail[1][5], '');
});
