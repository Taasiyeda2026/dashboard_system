import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');

test('manager review uses report summary card and comparison table hierarchy', () => {
  assert.match(source, /attendance-control__report-card/);
  assert.match(source, /דיווח נבחר לבדיקה/);
  assert.match(source, /השוואת נתוני הרשומה/);
  assert.match(source, /<th>פרמטר<\/th><th>דיווח מדריך<\/th><th>נתוני דשבורד<\/th><th>סטטוס<\/th>/);
});

test('review UI keeps actions below the comparison table and highlights only issue rows', () => {
  assert.match(source, /attendance-control__comparison-row--issue/);
  assert.match(source, /attendance-control__status-pill--issue/);
  assert.match(source, /attachmentsHtml\(current\)\}\$\{managerActionsHtml\(comparison\)\}/);
});

test('travel cancellation has a compact dedicated review table', () => {
  assert.match(source, /בדיקת ביטול זמן/);
  assert.match(source, /זמן ביטול/);
  assert.doesNotMatch(source, /autoCancellation \? \[\]/);
});

test('manager duration display is H:MM', () => {
  assert.match(source, /function formatDurationHours\(value\)/);
  assert.match(source, /\$\{formatDurationHours\(hours\)\} שעות/);
});


test('every attendance record field is shown against dashboard data', () => {
  for (const label of ['סוג פעילות','תאריך','רשות','בית ספר','שם תכנית / פעילות','מספר מפגש','שעת התחלה','שעת סיום','סה״כ שעות','תחבורה ציבורית','עלות תחבורה ציבורית','קילומטרים','הוצאות','פירוט הוצאה','הערות']) {
    assert.ok(source.includes(label), `missing ${label}`);
  }
  assert.match(source, /const rows = definitions\.map/);
  assert.match(source, /comparisonTable\(item, \{ attendanceOnly: true \}\)/);
  assert.match(source, /לא נמצאה פעילות תואמת בדשבורד/);
  assert.match(source, /דיווח בלבד/);
});
