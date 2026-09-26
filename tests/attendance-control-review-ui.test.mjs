import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resultsHtml } from '../frontend/src/screens/attendance-control.js';

const source = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');

test('manager review uses a compact report summary and only relevant comparison rows', () => {
  assert.match(source, /attendance-control__report-card/);
  assert.match(source, /פרטי הדיווח/);
  assert.match(source, /בדיקת ההכשרה מול התכנון/);
  assert.match(source, /השוואה מול נתוני הדשבורד/);
  assert.match(source, /const trainingKeys = new Set/);
  assert.match(source, /const alwaysKeys = new Set/);
});

test('travel details stay visible but are separated from the core comparison', () => {
  assert.match(source, /attendance-control__report-meta/);
  assert.match(source, /<strong>נסיעות<\/strong>/);
  assert.match(source, /key === 'kilometers'\) return optionalNumber\(right\) != null/);
  assert.doesNotMatch(source, /לא ניתן לחשב ק״מ/);
});

test('attendance-only records no longer render a full fake dashboard comparison', () => {
  assert.match(source, /אין מקור מערכת נוסף להשוואה לרשומה זו/);
  assert.match(source, /manualReportTable\(row, \{ entry: item \}\)/);
  assert.doesNotMatch(source, /comparisonTable\(item, \{ attendanceOnly: true \}\)/);
});

test('travel cancellation keeps its dedicated compact review table', () => {
  assert.match(source, /בדיקת ביטול זמן/);
  assert.match(source, /זמן ביטול/);
});

test('planned training renders only the six plan fields plus meaningful report details', () => {
  const html = resultsHtml({
    comparisons: [{
      id: 'training-1',
      managerResolved: null,
      attendance: {
        employeeId: '1533', employeeName: 'שחר זוביב', date: '2026-09-15',
        activityType: 'הכשרה', program: 'הכשרת בסיס',
        school: 'Greenwork', authority: 'יקום',
        startTime: '10:00', endTime: '16:00', workHours: 6,
        kilometers: 130, publicTransport: false, expenses: 0,
        notes: 'הערת מדריך'
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
        kilometers: 130, publicTransport: false, expenses: 0,
        notes: 'הערת מדריך'
      },
      differences: [
        { key: 'endTime', attendance: '16:00', dashboard: '15:00' },
        { key: 'workHours', attendance: 6, dashboard: 5 }
      ],
      unmatched: false
    }],
    notCompared: [],
    dailyKilometers: []
  }, '2026-09');

  assert.match(html, /בדיקת ההכשרה מול התכנון/);
  assert.match(html, /<th>תכנון<\/th>/);
  assert.match(html, /קורס \/ הכשרה/);
  assert.match(html, /130 ק״מ/);
  assert.match(html, /הערת מדריך/);
  assert.doesNotMatch(html, /<th>רשות<\/th>/);
  assert.doesNotMatch(html, /<th>בית ספר<\/th>/);
  assert.doesNotMatch(html, /<th>מספר מפגש<\/th>/);
  assert.doesNotMatch(html, /דיווח בלבד/);
  assert.doesNotMatch(html, /לא ניתן לחשב ק״מ/);
});

test('attendance-only training shows reported facts without repeated not-required rows', () => {
  const html = resultsHtml({
    comparisons: [],
    notCompared: [{
      id: 'training-report-only',
      source: 'attendance_not_compared',
      attendance: {
        employeeId: '1533', employeeName: 'שחר זוביב', date: '2026-09-20',
        activityType: 'הכשרה', program: 'הכשרה אחרת',
        startTime: '10:00', endTime: '12:00', workHours: 2,
        kilometers: 40, publicTransport: false, expenses: 0
      },
      final: {
        employeeId: '1533', date: '2026-09-20',
        activityType: 'הכשרה', program: 'הכשרה אחרת',
        startTime: '10:00', endTime: '12:00', workHours: 2,
        kilometers: 40, publicTransport: false, expenses: 0
      },
      differences: []
    }],
    dailyKilometers: []
  }, '2026-09');

  assert.match(html, /אין מקור מערכת נוסף להשוואה לרשומה זו/);
  assert.match(html, /40 ק״מ/);
  assert.doesNotMatch(html, /לא נדרש/);
  assert.doesNotMatch(html, /דיווח בלבד/);
});
