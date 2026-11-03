import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as XLSX from 'xlsx';
import {buildCorrectedAttendanceWorkbook} from '../frontend/src/screens/attendance-control.js';

test('travel day can only be chosen from assigned activities; no free calendar',async()=>{
 const tab=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
 const api=await readFile(new URL('../attendance/src/services/daily-travel.service.js',import.meta.url),'utf8');
 assert.ok(tab.includes('getAssignedTravelDays()'));
 assert.ok(tab.includes("daySelect.id='av2-travel-day-selector'"));
 assert.ok(tab.includes("type:'hidden'"));
 assert.ok(!tab.includes("type:'date'"));
 assert.ok(tab.includes("day.ready"));
 assert.ok(api.includes("av2_list_instructor_travel_days"));
});

test('public transit fare is captured for each travel leg, never on attendance',async()=>{
 const travel=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
 const attendance=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
 assert.ok(travel.includes("mode.value==='public_transport'"));
 assert.ok(travel.includes("leg.transportCost="));
 assert.ok(attendance.includes("publicTransportToggleEl.hidden = online || isDailyTravelDate()"));
 assert.ok(attendance.includes("payload.public_transport_cost = 0"));
});

test('manager Excel shows public transport modes and authorized fare per day',()=>{
 const book=buildCorrectedAttendanceWorkbook([],[],{dailyTravelReports:[{
  emp_id:1503,travel_date:'2026-11-04',review_status:'approved',
  total_km:50,public_transport_cost:20,approved_km:50,
  approved_public_transport_cost:20,cancellation_minutes:40,
  approved_cancellation_minutes:40,
  legs:[{kind:'outbound',from:'בית',to:'א',minutes:50,kilometers:30,mode:'car'},
    {kind:'between',from:'א',to:'ב',minutes:25,kilometers:0,mode:'public_transport',transportCost:20},
    {kind:'return',from:'ב',to:'בית',minutes:45,kilometers:20,mode:'car'}]
 }]});
 const rows=XLSX.utils.sheet_to_json(book.Sheets['נסיעות וביטולים'],{header:1});
 const h=rows[0];const m=rows[2];
 assert.equal(m[h.indexOf('אמצעי נסיעה')],'תחבורה ציבורית');
 assert.equal(m[h.indexOf('עלות תחבורה ציבורית')],20);
 assert.equal(m[h.indexOf('תחבורה ציבורית מאושרת')],20);
});
