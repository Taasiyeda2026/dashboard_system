import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../attendance/src/app.js', import.meta.url), 'utf8');
const service = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');
const home = await readFile(new URL('../attendance/src/screens/home-screen.js', import.meta.url), 'utf8');
const gate = await readFile(new URL('../attendance/src/services/month-gate.service.js', import.meta.url), 'utf8');

test('login keeps current calendar month and does not auto-focus reopened months', () => {
  assert.match(service, /export async function getLatestReopenedMonth\(empId\)/);
  assert.match(service, /\.eq\('status', 'reopened'\)/);
  assert.doesNotMatch(app, /getLatestReopenedMonth/);
  assert.match(app, /async function applyNotificationMonthFocus\(\)/);
  assert.match(app, /notification_month/);
  assert.doesNotMatch(app, /focusLatestReopenedMonth/);
  assert.equal(
    (app.match(/await applyNotificationMonthFocus\(\);/g) || []).length,
    2,
    'notification deep-link may run after login and session restore'
  );
  assert.match(app, /state\.currentYear\s*=\s*now\.getFullYear\(\)/);
  assert.match(app, /state\.currentMonth\s*=\s*now\.getMonth\(\)\s*\+\s*1/);
});

test('submitted months stay fully locked until an explicit reopen', () => {
  assert.match(gate, /if \(status === 'submitted'\) return false;/);
  assert.match(gate, /החודש כבר הוגש ונעול לעריכה \(כולל נסיעות והוצאות\)/);
  assert.match(gate, /השלמה אפשרית רק אחרי שהמנהל יפתח את החודש מחדש/);
});

test('reopened month submit action names the exact month', () => {
  assert.match(home, /status === 'reopened'[\s\S]*הגשה מחדש · \$\{formatMonthLabel\(year, month\)\}/);
});
