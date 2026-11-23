/**
 * Work-day chrome: shared day header, date sync across tabs, post-save travel CTA,
 * and My Reports missing-travel shortcut. Frontend-only; no migration/payroll.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('report screen exposes work-day chrome and post-save travel CTA', async () => {
  const screen = await read('attendance/src/screens/new-report-screen.js');
  const expenses = await read('attendance/src/screens/expenses-tab.js');
  assert.match(screen, /className = 'av2-workday'/);
  assert.match(screen, /יום עבודה/);
  assert.match(screen, /השלם נסיעות ליום זה/);
  assert.match(screen, /openTravelForDate/);
  assert.match(screen, /syncWorkDayTabs/);
  assert.match(screen, /travelTab\.textContent = 'נסיעות'/);
  assert.doesNotMatch(screen, /travelTab\.textContent = 'נסיעות וביטולים'/);
  assert.match(screen, /השלם נסיעות/);
  assert.match(screen, /dailyTravel\.setDate\(workDate\)/);
  assert.match(expenses, /function setDate\(/);
  assert.match(expenses, /return \{panel,load:refresh,setDate,dateInput:date\.input\}/);
});

test('My Reports day strip offers travel CTA when modern travel is missing', async () => {
  const detail = await read('attendance/src/components/my-reports-day-detail.js');
  assert.match(detail, /av2-day-detail__travel-cta/);
  assert.match(detail, /modern && !model\.hasReport && typeof onTravelReport==='function'/);
  assert.match(detail, /onTravelReport\(date\)/);
  assert.match(detail, /השלם נסיעות/);
});

test('work-day cache markers bumped above previous release', async () => {
  const sw = await read('attendance/sw.js');
  const index = await read('attendance/index.html');
  const frontendSw = await read('frontend/sw.js');
  const config = await read('frontend/src/config.js');
  assert.match(sw, /const CACHE_VERSION = 184/);
  assert.match(index, /\?v=184/);
  assert.doesNotMatch(index, /\?v=183/);
  assert.match(frontendSw, /const CACHE_VERSION = 2130/);
  assert.match(config, /attendance-workday-chrome-20261123-v1/);
});
