import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('instructor travel entry opens from attendance shortcut or my-reports link',async()=>{
 const app=await readFile(new URL('../attendance/src/app.js',import.meta.url),'utf8');
 const screen=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
 assert.match(app,/onTravelReport: \(date\) => openNewReport\(date,'travel'\)/);
 assert.match(app,/initialTab: requestedTab/);
 assert.match(screen,/travelShortcut\.append\(createIcon\('map-pin'\), document\.createTextNode\('השלם נסיעות'\)\)/);
 assert.match(screen,/השלם נסיעות ליום זה/);
 assert.match(screen,/openTravelForDate\(/);
 assert.match(screen,/travelShortcut\.addEventListener\('click',[\s\S]*?openTravelForDate\(/);
});

test('my reports offers day-level travel and activity actions instead of per-row travel pins',async()=>{
 const s=await readFile(new URL('../attendance/src/screens/my-reports-screen.js',import.meta.url),'utf8');
 const detail=await readFile(new URL('../attendance/src/components/my-reports-day-detail.js',import.meta.url),'utf8');
 assert.doesNotMatch(s,/av2-rr__travel-shortcut/);
 assert.match(s,/onNewReport,\s*\n\s*onTravelReport/);
 assert.match(detail,/הוסף פעילות/);
 assert.match(detail,/av2-day-detail__day-cta/);
 assert.match(detail,/av2-day-detail__travel-cta/);
 assert.match(detail,/onTravelReport\(date\)/);
});
