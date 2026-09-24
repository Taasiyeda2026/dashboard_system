import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlanningWorkbook,
  planningExportFilename,
  planningWorkbookRows
} from '../frontend/src/screens/course-scheduling-planning-export.js';

const rows = [{
  courseId: 'c1',
  courseName: 'ביומימיקרי',
  activityType: 'קורס',
  authority: 'ראשון לציון',
  school: 'בית ספר א',
  status: 'מועד מומלץ לבית הספר',
  sessions: 2,
  kind: 'proposal',
  instructorEmpId: '10',
  instructorName: 'מדריכה א',
  startDate: '2026-10-11',
  endDate: '2026-10-18',
  startTime: '08:00',
  endTime: '09:30',
  meetings: [
    { date: '2026-10-11', start_time: '08:00', end_time: '09:30' },
    { date: '2026-10-18', start_time: '08:00', end_time: '09:30' }
  ],
  reason: 'רצף עבודה',
  options: [
    {
      instructorEmpId: '10',
      instructorName: 'מדריכה א',
      startDate: '2026-10-11',
      endDate: '2026-10-18',
      startTime: '08:00',
      endTime: '09:30',
      meetings: [
        { date: '2026-10-11', start_time: '08:00', end_time: '09:30' },
        { date: '2026-10-18', start_time: '08:00', end_time: '09:30' }
      ],
      reason: 'רצף עבודה'
    },
    {
      instructorEmpId: '11',
      instructorName: 'מדריך ב',
      startDate: '2026-10-12',
      endDate: '2026-10-19',
      startTime: '10:00',
      endTime: '11:30',
      meetings: [
        { date: '2026-10-12', start_time: '10:00', end_time: '11:30' },
        { date: '2026-10-19', start_time: '10:00', end_time: '11:30' }
      ],
      reason: 'חלופה'
    }
  ]
}];

test('Planning Excel rows include primary date and all possible instructors', () => {
  const result = planningWorkbookRows(rows);
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0]['תאריך התחלה מוצע'], '11/10/2026');
  assert.equal(result.activities[0]['מדריך מוצע'], 'מדריכה א');
  assert.equal(result.activities[0]['מדריכים אפשריים'], 'מדריכה א | מדריך ב');
  assert.match(result.activities[0]['חלופות נוספות'], /12\/10\/2026 10:00–11:30 — מדריך ב/);
  assert.equal(result.options.length, 2);
  assert.equal(result.instructorMeetings.length, 2);
});

test('Planning Excel workbook exposes work schedule, options and instructor sheets', () => {
  const workbook = buildPlanningWorkbook(rows);
  assert.deepEqual(workbook.SheetNames, ['סידור עבודה', 'אפשרויות תכנון', 'מערכת לפי מדריך']);
  assert.ok(workbook.Sheets['סידור עבודה']);
  assert.ok(workbook.Sheets['אפשרויות תכנון']);
  assert.ok(workbook.Sheets['מערכת לפי מדריך']);
});

test('Planning Excel filename is deterministic for a supplied date', () => {
  assert.equal(
    planningExportFilename(new Date('2026-09-24T07:00:00.000Z')),
    'סידור_עבודה_תכנון_2026-09-24.xlsx'
  );
});
