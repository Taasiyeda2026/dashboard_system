import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { readFile } from 'node:fs/promises';
import { buildCorrectedAttendanceWorkbook } from '../frontend/src/screens/attendance-control.js';

test('manager Excel includes distinct daily travel rows, status and approved totals',()=>{
  const book=buildCorrectedAttendanceWorkbook([],[],{dailyTravelReports:[{
    emp_id:1550, travel_date:'2026-11-04',
    legs:[{kind:'outbound',from:'בית',to:'בית ספר א',minutes:70,kilometers:50},
      {kind:'between',from:'בית ספר א',to:'בית ספר ב',minutes:25,kilometers:15},
      {kind:'return',from:'בית ספר ב',to:'בית',minutes:65,kilometers:45}],
    no_travel:false,total_km:110,cancellation_minutes:80,
    approved_km:110,approved_cancellation_minutes:80,review_status:'approved'
  }]});
  assert.ok(book.SheetNames.includes('נסיעות וביטולים'));
  const rows=XLSX.utils.sheet_to_json(book.Sheets['נסיעות וביטולים'],{header:1});
  assert.equal(rows.length,4);
  assert.equal(rows[1][2],'נסיעה ראשונה');
  assert.equal(rows[2][2],'בין פעילויות');
  assert.equal(rows[3][2],'נסיעה אחרונה');
  assert.equal(rows[1][10],110);
  assert.equal(rows[1][11],80);
  assert.equal(rows[1][13],'אושר');
});

test('mobile and desktop offer same independent tabs and accessible navigation',async()=>{
  const screen=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../attendance/src/styles/new-report-screen.css',import.meta.url),'utf8');
  const travel=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
  assert.match(screen,/attendanceTab\.textContent = 'נוכחות'/);
  assert.match(screen,/travelTab\.textContent = 'נסיעות וביטולים'/);
  assert.match(screen,/form\.hidden = !isAttendance/);
 assert.ok(screen.includes('dailyTravel.setDate(dateField.input.value||defaultDate)'));
  assert.match(screen,/tabs\.addEventListener\('keydown'/);
  assert.ok(travel.includes('loadedDate===requestedDay'));
  assert.match(travel,/saveDailyTravel\(saveDate,saveLegs,saveNoTravel\)/);
  assert.match(css,/@media\(max-width:639px\)/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/safe-area-inset-bottom/);
});

test('manager daily-travel review checks missing days and blocks finalization',async()=>{
  const screen=await readFile(new URL('../frontend/src/screens/attendance-control.js',import.meta.url),'utf8');
  assert.match(screen,/data-payroll-pending-travel/);
  assert.match(screen,/דיווח נסיעות חסר/);
  assert.match(screen,/api\.attendanceControlReviewDailyTravel/);
  assert.match(screen,/api\.attendanceControlDailyTravelReports/);
});

test('November travel begins on first of month while historical payroll remains untouched',async()=>{
  const report=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
  const entry=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
  const control=await readFile(new URL('../frontend/src/screens/attendance-control.js',import.meta.url),'utf8');
  const migration=await readFile(new URL('../supabase/migrations/20261104072000_november_daily_travel_cutover.sql',import.meta.url),'utf8');
  assert.match(entry,/DAILY_TRAVEL_START_DATE = '2026-11-01'/);
  assert.match(report,/isLegacyDay=date=>String\(date\|\|''\)<'2026-11-01'/);
  assert.match(report,/historicalTravelDays\(historical.rows,\[\]\)/);
  assert.match(control,/needsDailyTravel = \(date,rows=\[\]\) => date >= '2026-11-01'/);
  assert.match(migration,/november_cutover_existing_payable_requires_reconciliation/);
  assert.match(migration,/av2_november_travel_legacy_conflict/);
});
