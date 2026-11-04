import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('instructor travel entry opens from attendance shortcut or my-reports link',async()=>{
 const app=await readFile(new URL('../attendance/src/app.js',import.meta.url),'utf8');
 const screen=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
 assert.match(app,/onTravelReport: \(date\) => openNewReport\(date,'travel'\)/);
 assert.match(app,/initialTab: requestedTab/);
 assert.match(screen,/travelShortcut\.append\(createIcon\('map-pin'\), document\.createTextNode\('מילוי נסיעות'\)\)/);
 assert.ok(screen.includes('dailyTravel.setDate(dateField.input.value||defaultDate)'));
 assert.match(screen,/travelShortcut\.addEventListener\('click',[\s\S]*?showTab\('travel'\)/);
});

test('my reports offers a tiny travel shortcut on physical attendance rows',async()=>{
 const s=await readFile(new URL('../attendance/src/screens/my-reports-screen.js',import.meta.url),'utf8');
 assert.match(s,/av2-rr__travel-shortcut/);
 assert.match(s,/onTravelReport\(record\.report_date\)/);
 assert.match(s,/record\.activity_type !== 'ביטול זמן'/);
});
