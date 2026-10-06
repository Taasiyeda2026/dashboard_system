import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../attendance/src/app.js', import.meta.url), 'utf8');
const service = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');
const home = await readFile(new URL('../attendance/src/screens/home-screen.js', import.meta.url), 'utf8');

test('reopened attendance month takes focus when instructor enters the app', () => {
  assert.match(service, /export async function getLatestReopenedMonth\(empId\)/);
  assert.match(service, /\.eq\('status', 'reopened'\)/);
  assert.match(service, /\.order\('month_key', \{ ascending: false \}\)/);
  assert.match(app, /import \{ getLatestReopenedMonth \} from '\.\/services\/attendance\.service\.js';/);
  assert.match(app, /async function focusLatestReopenedMonth\(\)/);
  assert.match(app, /await getLatestReopenedMonth\(state\.instructor\.empId\)/);
  assert.equal(
    (app.match(/await focusLatestReopenedMonth\(\);/g) || []).length,
    2,
    'reopened month focus must run after both fresh login and session restore'
  );
});

test('reopened month submit action names the exact month', () => {
  assert.match(home, /status === 'reopened'[\s\S]*הגשה מחדש · \$\{formatMonthLabel\(year, month\)\}/);
});
