/**
 * Work-day chrome: shared day header, date sync across tabs, post-save travel CTA,
 * and My Reports day-surface actions. Frontend-only; no migration/payroll.
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
  assert.match(screen, /dailyTravel\.setDate\(workDate, \{openInEdit: true\}\)/);
  assert.match(expenses, /function setDate\(/);
  assert.match(expenses, /return \{panel,load:refresh,setDate,dateInput:date\.input\}/);
});

test('My Reports day strip summarizes activities and offers day CTAs', async () => {
  const detail = await read('attendance/src/components/my-reports-day-detail.js');
  assert.match(detail, /activityHours/);
  assert.match(detail, /activityCount/);
  assert.match(detail, /av2-day-detail__travel-cta/);
  assert.match(detail, /av2-day-detail__day-cta/);
  assert.match(detail, /הוסף פעילות/);
  assert.match(detail, /השלם נסיעות/);
  assert.match(detail, /onTravelReport\(date\)/);
  assert.match(detail, /onNewReport\(date\)/);
  assert.match(detail, /modern\)\{/);
});

test('work-day day-surface cache markers bumped above previous release', async () => {
  const sw = await read('attendance/sw.js');
  const index = await read('attendance/index.html');
  assert.match(sw, /const CACHE_VERSION = 187/);
  assert.match(index, /\?v=187/);
  assert.doesNotMatch(index, /\?v=185/);
});
