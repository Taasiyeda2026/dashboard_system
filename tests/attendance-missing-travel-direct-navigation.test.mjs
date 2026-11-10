import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('monthly missing-travel reminder opens the earliest outstanding day in travel, not attendance', async () => {
  const screen = await read('attendance/src/screens/my-reports-screen.js');
  assert.match(screen,/const missingTravel = travelDays\.filter\(date=>!dailyTravelByDate\.has\(date\)\)/);
  assert.match(screen,/\.map\(row=>row\.report_date\)\)\]\.sort\(\)/);
  assert.match(screen,/action\.textContent='השלמת נסיעות'/);
  assert.match(screen,/action\.addEventListener\('click',\(\)=>onTravelReport\?\.\(missingTravel\[0\]\)\)/);
  assert.doesNotMatch(screen,/action\.addEventListener\('click',\(\)=>onNewReport\?\.\(\)\)/);
  // The independent "add attendance" action stays unchanged.
  assert.match(screen,/addBtn\.addEventListener\('click', \(\) => onNewReport\?\.\(\)\)/);
});

test('travel deep link preserves the chosen date and opens travel tab automatically', async () => {
  const app = await read('attendance/src/app.js');
  const report = await read('attendance/src/screens/new-report-screen.js');
  const travel = await read('attendance/src/screens/daily-travel-tab.js');
  assert.match(app,/onTravelReport: \(date\) => openNewReport\(date,'travel'\)/);
  assert.match(app,/defaultDate: requestedDate \|\| fallbackDate/);
  assert.match(app,/initialTab: requestedTab/);
  assert.match(report,/initialDate: dateField\.input\.value \|\| defaultDate/);
  assert.match(report,/showTab\(initialTab === 'travel' \? 'travel' : 'attendance'\)/);
  assert.match(travel,/const requested=dayOptions\.find\(day=>day\.date===requestedDay\)/);
  assert.match(travel,/daySelect\.value=chosen\.date/);
});
