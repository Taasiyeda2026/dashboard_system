import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('instructor travel entry opens from dedicated tab or my-reports link, not attendance form',async()=>{
 const app=await readFile(new URL('../attendance/src/app.js',import.meta.url),'utf8');
 const screen=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
 assert.match(app,/onTravelReport: \(date\) => openNewReport\(date,'travel'\)/);
 assert.match(app,/initialTab: requestedTab/);
 assert.doesNotMatch(screen,/travelText\.textContent='מילוי נסיעות'/);
 assert.ok(screen.includes('dailyTravel.setDate(dateField.input.value||defaultDate)'));
 assert.match(screen,/showTab\('travel'\)/);
});

test('my reports offers a tiny travel shortcut on physical attendance rows',async()=>{
 const s=await readFile(new URL('../attendance/src/screens/my-reports-screen.js',import.meta.url),'utf8');
 assert.match(s,/av2-rr__travel-shortcut/);
 assert.match(s,/onTravelReport\(record\.report_date\)/);
 assert.match(s,/record\.activity_type !== 'ביטול זמן'/);
});
