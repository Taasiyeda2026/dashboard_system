import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('historical travel report loader is imported and compact layout is constrained',async()=>{
 const ui=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
 const service=await readFile(new URL('../attendance/src/services/daily-travel.service.js',import.meta.url),'utf8');
 const css=await readFile(new URL('../attendance/src/styles/new-report-final-alignment.css',import.meta.url),'utf8');
 assert.match(ui,/getDailyTravelActivityLegs, getDailyTravelReport, getDailyTravelReports, getAssignedTravelDays, saveDailyTravel/);
 assert.match(ui,/getDailyTravelReports\(empId,selectedMonth\)/);
 assert.match(service,/export async function getDailyTravelReports\(/);
 assert.match(css,/\.av2-report__travel-tab\{[\s\S]*?max-width:480px/);
 assert.match(css,/\.av2-report__travel-tab>\.av2-report__actions>\.av2-btn\{[\s\S]*?width:118px/);
});

test('travel has one distinct heading and uses expenses-style compact report card',async()=>{
 const ui=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
 const css=await readFile(new URL('../attendance/src/styles/new-report-final-alignment.css',import.meta.url),'utf8');
 assert.match(ui,/title\.textContent = 'דיווח נסיעות'/);
 assert.doesNotMatch(ui,/title\.textContent = 'נסיעות וביטולים'/);
 assert.match(ui,/reportCard\.className='av2-daily-travel__report-card'/);
 assert.match(ui,/reportCard\.append\(monthWrap,daysWrap,dateField\.wrap,status,historicalEdit,legsArea,noTravelLabel,summary,savedCard,actions\)/);
 assert.match(css,/\.av2-daily-travel__report-card\{[\s\S]*?max-width:480px/);
 assert.match(css,/\.av2-daily-travel__report-card>\.av2-report__actions>\.av2-btn\{[\s\S]*?width:110px/);
 assert.match(css,/\.av2-daily-travel__saved\{/);
});
