import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('new report opens on the current local date irrespective of browsed month',async()=>{
 const app=await readFile(new URL('../attendance/src/app.js',import.meta.url),'utf8');
 assert.match(app,/const fallbackDate = `\$\{now\.getFullYear\(\)\}-\$\{String\(now\.getMonth\(\)\+1\)/);
 assert.match(app,/defaultDate: requestedDate \|\| fallbackDate/);
 assert.doesNotMatch(app,/const fallbackDate = sameMonth/);
});

test('calendar-selected date and duplicate record are preserved',async()=>{
 const app=await readFile(new URL('../attendance/src/app.js',import.meta.url),'utf8');
 const newReport=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
 assert.match(app,/const requestedDate = state\.newReportDate/);
 assert.match(app,/prefillRecord: prefill/);
 assert.match(newReport,/value: prefill\?\.report_date \|\| preservedDate \|\| defaultDate/);
});
