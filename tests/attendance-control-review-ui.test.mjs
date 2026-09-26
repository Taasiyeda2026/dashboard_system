import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resultsHtml } from '../frontend/src/screens/attendance-control.js';

const source = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');

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
        { key: 'endTime', label: 'שעת סיום', type: 'time', attendance: '12:00', dashboard: '11:30', choice: 'attendance', custom: '' },
        { key: 'workHours', label: 'שעות עבודה', type: 'number', attendance: 2, dashboard: 1.5, choice: 'attendance', custom: '' }
      ],
      unmatched: false
    }],
    notCompared: [],
    dailyKilometers: []
  }, '2026-09');

  assert.match(html, /אישור נוכחות/);
  assert.match(html, /אישור דשבורד/);
  assert.match(html, />עריכה</);
  assert.match(html, /data-field-key="endTime"/);
  assert.match(html, /data-field-key="workHours"/);
  assert.match(html, /⚠ לבדיקה/);
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
  }, '2026-09');

  assert.match(html, /בדיקת ההכשרה מול התכנון/);
  assert.match(html, /<th>תכנון<\/th>/);
  assert.match(html, /רשות \/ יישוב/);
  assert.match(html, /בית ספר \/ מיקום/);
  assert.match(html, /Greenwork/);
  assert.match(html, /יקום/);
  assert.match(html, /130 ק״מ/);
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
  }, '2026-09');

  assert.match(html, /תחבורה ציבורית/);
  assert.match(html, /עלות תחבורה ציבורית/);
  assert.match(html, />32</);
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

test('travel cancellation keeps a dedicated five-column calculation table', () => {
  assert.match(source, /בדיקת ביטול זמן/);
  assert.match(source, /<th>חישוב מערכת<\/th><th>סטטוס<\/th><th>פעולות<\/th>/);
  assert.match(source, /מחושב אוטומטית לפי זמן הנסיעה/);
});
